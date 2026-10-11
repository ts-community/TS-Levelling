const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, ModalBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle } = require("discord.js")
const Drops = require("../../classes/Drops.js")

// Emoji de XP del servidor (igual que /rank y /records).
const XP_EMOJI = "<:XP:1467192533812645939>"

const fmtInt = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
// Miles con punto siempre (igual que commafy en las respuestas).

// XP con equivalencia visible; monedas en neutro (cada economía tiene su
// escala: la guía de XP no vale para monedas).
const xpChoices = Drops.AMOUNT_PRESETS
    .map(p => ({ name: `${p.name} - ${fmtInt(p.xp)} (${Drops.presetEquiv(p.xp)})`, value: p.xp }))
    .concat([{ name: "Personalizada… (usa xp_extra)", value: Drops.CUSTOM_AMOUNT }])
const coinChoices = Drops.COIN_PRESETS
    .map(p => ({ name: `${p.name} - ${fmtInt(p.coins)}`, value: p.coins }))
    .concat([{ name: "Personalizada… (usa monedas_extra)", value: Drops.CUSTOM_AMOUNT }])

const durationChoices = Drops.DURATION_PRESETS.map(d => ({ name: d.label, value: String(d.minutes) }))

// Cantidad de un premio (xp o monedas): ausente = 0 (sin premio),
// Personalizada = usa su extra (error si falta).
function resolvePrizeAmount(int, name, extraName) {
    const choice = int.options.get(name)?.value
    if (choice === undefined || choice === null) return { amount: 0 }
    if (choice === Drops.CUSTOM_AMOUNT) {
        const extra = int.options.get(extraName)?.value
        if (!Number.isFinite(Number(extra))) return { error: `elegiste Personalizada en ${name}: pon ${extraName}.` }
        return { amount: Math.round(Number(extra)) }
    }
    return { amount: Math.round(Number(choice)) }
}

// "<:XP:> 5.000 XP + 🪙 1.000 monedas + 🎭 <@&rol> + 📦 2× Y".
function describePrizes(prizes, tools, maxParts = Infinity) {
    const parts = []
    if (prizes.xp > 0) parts.push(`${XP_EMOJI} ${tools.commafy(prizes.xp)} XP`)
    if (prizes.coins > 0) parts.push(`🪙 ${tools.commafy(prizes.coins)} monedas`)
    for (const r of prizes.roles) parts.push(`🎭 <@&${r.id}>`)
    for (const it of prizes.items) parts.push(`📦 ${tools.commafy(it.qty)}× ${it.name || "objeto"}`)
    // En la lista solo caben 2 premios por línea; el resto se resume.
    if (parts.length > maxParts) parts.splice(maxParts, parts.length - maxParts, `+${parts.length - maxParts} más`)
    return parts.join(" + ")
}

// Texto corto del premio para lista y detalle (vale para packs y sueltos).
// En la lista, como mucho maxParts premios y el resto resumido.
function dropPrizeText(drop, tools, maxParts = Infinity) {
    if (drop.kind === "bundle") return describePrizes(Drops.normalizePrizes(drop.prizes), tools, maxParts)
    if (drop.kind === "role") return `🎭 rol ${drop.roleName || `<@&${drop.roleId}>`}`
    if (drop.kind === "item") return `📦 ${tools.commafy(drop.amount)}× ${drop.itemName || "objeto"}`
    return `${Drops.kindEmoji(drop.kind)} ${tools.commafy(drop.amount)} ${Drops.kindName(drop.kind)}`
}

const MENU_ID = "dropinspect"
const BACK_VALUE = "__back"
// Botones del detalle: "drop:<accion>:<CODE>". Los de cantidad/tiempo abren
// un modal ("dropm:<accion>:<CODE>") para pedir el número exacto.
const BTN_PREFIX = "drop"
const MODAL_PREFIX = "dropm"
const BTN_DEL = "del"
const BTN_USES = "uses"
const BTN_TIME = "time"
const MAX_MENU_OPTIONS = 25
const USES_BOUNDS = { min: 1, max: Drops.LIMITS.usesMax }
const HOURS_BOUNDS = { min: 1, max: 720 }

function parseModalAmount(text, { min, max }) {
    const clean = String(text || "").trim()
    if (!/^\d+$/.test(clean)) return { ok: false }
    const value = Number(clean)
    if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false }
    return { ok: true, value }
}

function buildUsesModal(code) {
    return new ModalBuilder()
        .setCustomId(`${MODAL_PREFIX}:${BTN_USES}:${code}`)
        .setTitle(`Añadir usos a ${code}`)
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("amount")
                .setLabel("¿Cuántos usos añades?")
                .setPlaceholder("Ej: 25")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(4),
        ))
}

function buildTimeModal(code) {
    return new ModalBuilder()
        .setCustomId(`${MODAL_PREFIX}:${BTN_TIME}:${code}`)
        .setTitle(`Añadir tiempo a ${code}`)
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("amount")
                .setLabel("¿Cuántas horas añades?")
                .setPlaceholder("Ej: 48")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(3),
        ))
}

const sepBuilder = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)

function dropListLine(row, base, guildId, tools) {
    const { code, drop, left } = row
    const claimed = Math.max(0, Number(drop.maxClaims) - left)
    const url = `${base}${Drops.dropPath(guildId, code)}`
    const head = left <= 0 ? `~~[\`${code}\`](${url})~~` : `[\`${code}\`](${url})`
    return `- ${head} (${tools.commafy(claimed)}/${tools.commafy(drop.maxClaims)}) - ${dropPrizeText(drop, tools, 2)}`
}

function buildInspectMenu(rows, selectedCode) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(MENU_ID)
            .setPlaceholder(selectedCode ? "Viendo un drop - cambia o vuelve" : "Elige un drop para verlo en detalle")
    for (const { code, drop, left } of rows.slice(0, MAX_MENU_OPTIONS)) {
        const claimed = Math.max(0, Number(drop.maxClaims) - left)
        menu.addOptions(new StringSelectMenuOptionBuilder()
            .setLabel(`${code} (${claimed}/${drop.maxClaims})`)
            .setValue(code)
            .setDescription(String(drop.name || "Drop").slice(0, 100))
            .setDefault(code === selectedCode))
    }
    if (selectedCode) {
        menu.addOptions(new StringSelectMenuOptionBuilder()
            .setLabel("⬅ Volver a la lista")
            .setValue(BACK_VALUE)
            .setDescription("Ver todos los drops"))
    }
    return menu
}

function buildDropsListContainer(rows, base, guildId, tools) {
    const container = new ContainerBuilder().setAccentColor(0x87f3ff)
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎁 Drops del servidor`))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `Reparte XP, monedas, objetos y roles con enlaces: crea uno con \`/drop crear\` y comparte su link. Cada persona reclama una vez hasta agotar usos o que caduque.`,
    ))
    container.addSeparatorComponents(sepBuilder())
    if (!rows.length) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# No hay drops activos ahora mismo. Los caducados no salen aquí.`))
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            rows.slice(0, MAX_MENU_OPTIONS).map(row => dropListLine(row, base, guildId, tools)).join("\n")
            + (rows.length > MAX_MENU_OPTIONS ? `\n-# +${rows.length - MAX_MENU_OPTIONS} más (borra viejos para verlos)` : ""),
        ))
    }
    container.addSeparatorComponents(sepBuilder())
    if (rows.length) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(buildInspectMenu(rows, null)))
    }
    return container
}

function buildDropDetailContainer(rows, row, base, guildId, tools) {
    const { code, drop, left } = row
    const claimed = Math.max(0, Number(drop.maxClaims) - left)
    const url = `${base}${Drops.dropPath(guildId, code)}`
    const container = new ContainerBuilder().setAccentColor(0x87f3ff)
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎁 Drop \`${code}\``))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `- 🧾 **Nombre:** ${drop.name || "Drop"}`,
        `- 🎁 **Premio por persona:** ${dropPrizeText(drop, tools)}`,
        `- 📊 **Reclamados:** ${tools.commafy(claimed)}/${tools.commafy(drop.maxClaims)}`,
        `- 👤 **Creado por:** <@${drop.createdBy || "?"}>`,
        `- ⏳ **Caduca:** <t:${Math.floor(Number(drop.expiresAt) / 1000)}:F> (<t:${Math.floor(Number(drop.expiresAt) / 1000)}:R>)`,
        `- 🔗 **Enlace:** ${url}`,
    ].join("\n")))
    container.addSeparatorComponents(sepBuilder())
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_DEL}:${code}`).setLabel("Eliminar").setStyle(ButtonStyle.Danger).setEmoji("🗑️"),
            new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_USES}:${code}`).setLabel("Añadir usos").setStyle(ButtonStyle.Secondary).setEmoji("➕"),
            new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_TIME}:${code}`).setLabel("Añadir tiempo").setStyle(ButtonStyle.Secondary).setEmoji("⏳"),
        ))
    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildInspectMenu(rows, code)))
    return container
}

module.exports = {
metadata: {
    permission: "ManageGuild",
    name: "drop",
    description: "Crea drops reclamables por web (XP, monedas, objetos, rol).",
    args: [
        { type: "subcommand", name: "crear", description: "Crea un drop con enlace para reclamar", args: [
            { type: "integer", name: "xp", description: "XP por reclamo (vacío = sin XP)", required: false, choices: xpChoices },
            { type: "integer", name: "xp_extra", description: "Si elegiste Personalizada en xp", min: Drops.LIMITS.amountMin, max: Drops.LIMITS.amountMax, required: false },
            { type: "integer", name: "monedas", description: "Monedas por reclamo (vacío = sin monedas)", required: false, choices: coinChoices },
            { type: "integer", name: "monedas_extra", description: "Si elegiste Personalizada en monedas", min: Drops.LIMITS.coinMin, max: Drops.LIMITS.coinMax, required: false },
            { type: "string", name: "objeto", description: "Objeto 1 de la tienda (escribe su nombre)", required: false, autocomplete: true },
            { type: "string", name: "objeto2", description: "Objeto 2 de la tienda (opcional)", required: false, autocomplete: true },
            { type: "string", name: "objeto3", description: "Objeto 3 de la tienda (opcional)", required: false, autocomplete: true },
            { type: "integer", name: "cantidad", description: "Cuántos de cada objeto (por defecto 1)", min: Drops.LIMITS.qtyMin, max: Drops.LIMITS.qtyMax, required: false },
            { type: "role", name: "rol", description: "Rol que se dará al reclamar (opcional)", required: false },
            { type: "integer", name: "usos", description: "Cuántas personas pueden reclamarlo", min: Drops.LIMITS.usesMin, max: Drops.LIMITS.usesMax, required: false },
            { type: "string", name: "duracion", description: "Cuánto tiempo se puede reclamar", required: false, choices: durationChoices },
            { type: "string", name: "nombre", description: "Nombre del drop (se ve en la web)", required: false },
        ]},
        { type: "subcommand", name: "lista", description: "Ver los drops del servidor", args: [] },
        { type: "subcommand", name: "borrar", description: "Borra un drop por su código", args: [
            { type: "string", name: "codigo", description: "Código del drop (6 letras del enlace)", required: true },
        ]},
        { type: "subcommand", name: "permiso", description: "Roles que pueden usar /drop (solo gestores)", args: [
            { type: "role", name: "rol", description: "Rol a añadir (sin rol: ver la lista)", required: false },
            { type: "bool", name: "quitar", description: "Quitar el rol en vez de añadirlo", required: false },
        ]},
    ]
},

async run(client, int, tools) {
    let db = await tools.fetchSettings(int.user?.id)
    if (!db) return tools.warn("*noData")
    const isManager = tools.canManageServer(int.member, db.settings.manualPerms)
    const sub = int.options.getSubcommand(false)
    // Permiso solo para gestores (aunque tengas rol de drops, los permisos
    // los tocan solo ellos). Todo lo demás: gestores o roles de la DB.
    if (sub === "permiso") {
        if (!isManager) return tools.warn("*notMod")
    } else {
        const canUse = isManager || Drops.canUseDrops({ isManager: false, memberRoles: int.member?.roles?.cache, settings: db.settings })
        if (!canUse) return tools.warn("*notMod")
    }
    if (!db.settings.enabled) return tools.warn("*xpDisabled")

    if (sub === "lista") return module.exports.runList(client, int, tools)
    if (sub === "borrar") return module.exports.runDelete(client, int, tools)
    if (sub === "permiso") return module.exports.runPermiso(client, int, tools)
    return module.exports.runCreate(client, int, tools, db)
},

async runCreate(client, int, tools, db) {
    const maxClaims = int.options.get("usos")?.value ?? 25
    const durationMin = Number(int.options.get("duracion")?.value ?? 1440)
    const name = int.options.get("nombre")?.value || "Drop"

    const xpResolved = resolvePrizeAmount(int, "xp", "xp_extra")
    if (xpResolved.error) return tools.warn(xpResolved.error)
    const coinsResolved = resolvePrizeAmount(int, "monedas", "monedas_extra")
    if (coinsResolved.error) return tools.warn(coinsResolved.error)

    const cantidad = int.options.get("cantidad")?.value ?? 1
    const itemTexts = ["objeto", "objeto2", "objeto3"]
        .map(n => int.options.get(n)?.value)
        .filter(t => String(t || "").trim())
    const items = []
    for (const text of itemTexts) {
        let item = null
        try {
            item = await Drops.resolveBoatItem(int.guild.id, text)
        } catch {
            return tools.warn("No pude leer la tienda de UnbelievaBoat. Revisa el token e inténtalo de nuevo.")
        }
        if (!item) return tools.warn(`"${text}" no está en la tienda: escríbelo y elige uno de la lista.`)
        items.push({ id: item.id, name: item.name, qty: cantidad })
    }

    const roles = []
    const role = int.options.getRole("rol")
    if (role) {
        if (role.id === int.guild.id) return tools.warn("Elige un rol válido (no @everyone).")
        if (role.managed) return tools.warn("Ese rol lo gestiona una integración y no se puede dar.")
        let editable = false
        try {
            editable = !!role.editable
        } catch {
            return tools.warn("No puedo comprobar ese rol ahora mismo.")
        }
        if (!editable) return tools.warn("No puedo dar ese rol: debe estar por debajo de mi rol más alto y necesito gestionar roles.")
        if (Drops.roleIsDangerous(role)) return tools.warn("Ese rol tiene permisos peligrosos (administración, moderación, baneos…) y no se puede repartir en un drop.")
        const isOwner = int.user.id === int.guild.ownerId
        let creatorTop = null
        try {
            creatorTop = int.member?.roles?.highest?.position
        } catch {}
        if (!Drops.creatorCanGiveRole({ isOwner, creatorTopPos: creatorTop, rolePos: role.position })) {
            return tools.warn("Ese rol está a tu altura o por encima: no puedes repartir roles superiores al tuyo.")
        }
        roles.push({ id: role.id, name: role.name })
    }

    const prizes = { xp: xpResolved.amount, coins: coinsResolved.amount, roles, items }
    if (Drops.prizesCount(prizes) === 0) {
        return tools.warn("El drop debe tener al menos un premio: XP, monedas, objeto o rol.")
    }

    const created = await Drops.createDrop(client, int.guild.id, {
        maxClaims, durationMin, name, createdBy: int.user.id, kind: "bundle", prizes,
    })
    if (!created.ok) return tools.warn(`No se pudo crear el drop: ${created.errors.join("; ")}.`)
    const { code, drop } = created

    const url = `${Drops.dropsBaseUrl(tools.WEBSITE)}${Drops.dropPath(int.guild.id, code)}`
    const expires = `<t:${Math.floor(drop.expiresAt / 1000)}:R>`
    const scale = drop.prizes.xp > 0 && !drop.prizes.coins && drop.prizes.roles.length === 0 && drop.prizes.items.length === 0
        ? ` (${Drops.balanceHint(drop.prizes.xp, xp => tools.getLevel(Number(xp) || 0, db.settings))}, ≈ nivel ${tools.commafy(tools.getLevel(Number(drop.prizes.xp) || 0, db.settings))})`
        : ""

    return int.reply(
        `🎁 **Drop creado: ${drop.name}** (${code})\n` +
        `${describePrizes(drop.prizes, tools)} por persona${scale}\n` +
        `👥 ${tools.commafy(drop.maxClaims)} usos - ⏳ caduca ${expires}\n` +
        `🔗 ${url}\n` +
        `-# Compártelo donde quieras: cada persona reclama una vez hasta agotar usos o que caduque.`
    )
},

async runList(client, int, tools) {
    const base = `${Drops.dropsBaseUrl(tools.WEBSITE)}`
    const guildId = int.guild.id
    const authorId = int.user.id

    const fetchRows = async () => {
        const doc = await client.db.fetch(guildId, ["drops"]).exec().catch(() => null)
        // Solo los que aún no han expirado; los agotados salen tachados.
        return Drops.listDrops(doc).filter(r => !r.expired)
    }
    // El menú y los botones trabajan sobre la foto más fresca (los usos y
    // la caducidad cambian con +10/+24h o al reclamar).
    let currentRows = await fetchRows()
    let selected = null
    const render = () => {
        const current = selected ? currentRows.find(r => r.code === selected) : null
        if (selected && !current) selected = null
        const fresh = selected ? currentRows.find(r => r.code === selected) : null
        return fresh
            ? buildDropDetailContainer(currentRows, fresh, base, guildId, tools)
            : buildDropsListContainer(currentRows, base, guildId, tools)
    }

    await int.reply({
        components: [render()],
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        allowedMentions: { parse: [] },
    })
    const message = await int.fetchReply().catch(() => null)
    if (!message) return

    let busy = false
    const refresh = async editor => {
        currentRows = await fetchRows()
        await editor.editReply({
            components: [render()],
            flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
            allowedMentions: { parse: [] },
        })
    }
    // Botones de cantidad/tiempo: abren un modal efímero para el número
    // exacto y al confirmar refrescan el mensaje de arriba.
    const openAmountModal = async (buttonInt, action, code) => {
        const isUses = action === BTN_USES
        const modalId = `${MODAL_PREFIX}:${action}:${code}`
        try {
            await buttonInt.showModal(isUses ? buildUsesModal(code) : buildTimeModal(code))
        } catch { return }
        let submitted = null
        try {
            submitted = await buttonInt.awaitModalSubmit({
                filter: i => i.customId === modalId && i.user.id === authorId,
                time: 120000,
            })
        } catch { submitted = null }
        if (!submitted) return
        let raw = ""
        try {
            raw = submitted.fields.getTextInputValue("amount")
        } catch { raw = "" }
        const parsed = parseModalAmount(raw, isUses ? USES_BOUNDS : HOURS_BOUNDS)
        if (!parsed.ok) {
            return submitted.reply({
                content: isUses
                    ? `Pon un número de usos entre ${USES_BOUNDS.min} y ${USES_BOUNDS.max}.`
                    : `Pon un número de horas entre ${HOURS_BOUNDS.min} y ${HOURS_BOUNDS.max}.`,
                ephemeral: true,
            }).catch(() => {})
        }
        try {
            await submitted.deferUpdate()
            const doc = await client.db.fetch(guildId, [`drops.${code}`]).exec().catch(() => null)
            const drop = doc?.drops?.[code]
            if (!drop) {
                return submitted.followUp({ content: "Ese drop ya no existe. Reabre `/drop lista`.", ephemeral: true }).catch(() => {})
            }
            if (isUses) {
                const total = Number(drop.maxClaims) + parsed.value
                if (total > Drops.LIMITS.usesMax) {
                    return submitted.followUp({ content: `Se pasaría del máximo (${tools.commafy(Drops.LIMITS.usesMax)} usos).`, ephemeral: true }).catch(() => {})
                }
                await client.db.update(guildId, { $set: { [`drops.${code}.maxClaims`]: total } }).exec()
            } else {
                await client.db.update(guildId, { $set: { [`drops.${code}.expiresAt`]: Number(drop.expiresAt) + parsed.value * 3600 * 1000 } }).exec()
            }
            currentRows = await fetchRows()
            selected = code
            await buttonInt.editReply({
                components: [render()],
                flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
                allowedMentions: { parse: [] },
            })
            await submitted.followUp({
                content: isUses ? `✅ +${tools.commafy(parsed.value)} usos a \`${code}\`.` : `✅ +${tools.commafy(parsed.value)} h a \`${code}\`.`,
                ephemeral: true,
            }).catch(() => {})
        } catch {
            try { await submitted.followUp({ content: "No se pudo actualizar. Reabre `/drop lista`.", ephemeral: true }) } catch {}
        }
    }
    const collector = message.createMessageComponentCollector({ time: 24 * 60 * 60 * 1000 })
    collector.on("collect", async interaction => {
        if (!interaction.isStringSelectMenu() && !interaction.isButton()) return
        if (interaction.user.id !== authorId) {
            return interaction.reply({
                content: `Este menú es de otra persona. Usa ${tools.commandTag("drop")} para abrir el tuyo.`,
                ephemeral: true,
            }).catch(() => {})
        }
        if (interaction.isButton()) {
            const [prefix, action, code] = String(interaction.customId || "").split(":")
            if (prefix === BTN_PREFIX && (action === BTN_USES || action === BTN_TIME)) {
                await openAmountModal(interaction, action, code)
                return
            }
        }
        if (busy) return
        busy = true
        try {
            await interaction.deferUpdate()
            const id = interaction.customId || ""
            if (interaction.isStringSelectMenu() && id === MENU_ID) {
                const picked = interaction.values?.[0]
                selected = picked === BACK_VALUE ? null : picked
                await refresh(interaction)
            } else if (interaction.isButton()) {
                const [prefix, action, code] = id.split(":")
                if (prefix === BTN_PREFIX && action === BTN_DEL) {
                    await Drops.deleteDrop(client, guildId, code)
                    selected = null
                    await refresh(interaction)
                }
            }
        } catch {
            try {
                await interaction.followUp({ content: "No se pudo actualizar. Reabre `/drop lista`.", ephemeral: true })
            } catch {}
        } finally {
            busy = false
        }
    })
    collector.on("end", async () => {
        try {
            const container = render()
            for (const row of container.components) {
                for (const comp of (row.components || [])) {
                    if (typeof comp.setDisabled === "function") comp.setDisabled(true)
                }
            }
            await message.edit({
                components: [container],
                flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
                allowedMentions: { parse: [] },
            })
        } catch {}
    })
},

async runDelete(client, int, tools) {
    const code = int.options.get("codigo")?.value
    const deleted = await Drops.deleteDrop(client, int.guild.id, code)
    if (!deleted.ok) return tools.warn("No existe ningún drop con ese código.")
    return int.reply({ content: `🗑️ Drop \`${String(code).toUpperCase()}\` borrado.`, ephemeral: true })
},

// Permisos de /drop (solo gestores, ver run): roles en settings.dropRoles.
async runPermiso(client, int, tools) {
    const role = int.options.getRole("rol")
    if (!role) {
        const doc = await client.db.fetch(int.guild.id, ["settings.dropRoles"]).exec().catch(() => null)
        const roles = Array.isArray(doc?.settings?.dropRoles) ? doc.settings.dropRoles : []
        if (!roles.length) {
            return int.reply({
                content: "Nadie extra puede usar `/drop`: solo quienes gestionan el servidor.\nAñade un rol con `/drop permiso rol:@Staff`.",
                ephemeral: true,
            })
        }
        return int.reply({
            content: `**Roles con permiso de /drop** (además de gestores):\n${roles.map(r => `- <@&${r.id}>`).join("\n")}`,
            ephemeral: true,
        })
    }
    if (role.id === int.guild.id) return tools.warn("Elige un rol válido (no @everyone).")

    if (int.options.get("quitar")?.value) {
        await client.db.update(int.guild.id, { $pull: { "settings.dropRoles": { id: role.id } } }).exec()
        return int.reply({ content: `🗑️ <@&${role.id}> ya no puede usar \`/drop\`.`, ephemeral: true })
    }

    await client.db.update(int.guild.id, { $addToSet: { "settings.dropRoles": { id: role.id } } }).exec()
    return int.reply({ content: `✅ <@&${role.id}> ya puede usar \`/drop\` (crear, ver y borrar drops).`, ephemeral: true })
},

// Autocompletado de objeto/objeto2/objeto3: sugiere items de la tienda por
// nombre (el valor es el ID). Sin economía o sin items, lista vacía.
async autocomplete(client, int) {
    try {
        const focused = int.options.getFocused(true)
        if (!focused || !String(focused.name || "").startsWith("objeto")) return int.respond([])
        const guildId = int.guildId || int.guild?.id
        if (!guildId) return int.respond([])
        const items = await Drops.suggestBoatItems(guildId, focused.value).catch(() => [])
        return int.respond(items.slice(0, 25).map(it => ({
            name: `${it.emoji ? `${it.emoji} ` : ""}${it.name}`.slice(0, 100),
            value: it.id,
        })))
    } catch {
        try { await int.respond([]) } catch {}
    }
},
}

// Para tests (el loader solo usa .metadata y .run).
module.exports.buildDropsListContainer = buildDropsListContainer
module.exports.buildDropDetailContainer = buildDropDetailContainer
module.exports.buildInspectMenu = buildInspectMenu
module.exports.dropListLine = dropListLine
module.exports.dropPrizeText = dropPrizeText
module.exports.MENU_ID = MENU_ID
module.exports.BACK_VALUE = BACK_VALUE
module.exports.BTN_DEL = BTN_DEL
module.exports.BTN_USES = BTN_USES
module.exports.BTN_TIME = BTN_TIME
module.exports.BTN_PREFIX = BTN_PREFIX
module.exports.MODAL_PREFIX = MODAL_PREFIX
module.exports.USES_BOUNDS = USES_BOUNDS
module.exports.HOURS_BOUNDS = HOURS_BOUNDS
module.exports.parseModalAmount = parseModalAmount
module.exports.buildUsesModal = buildUsesModal
module.exports.buildTimeModal = buildTimeModal
module.exports.MAX_MENU_OPTIONS = MAX_MENU_OPTIONS
