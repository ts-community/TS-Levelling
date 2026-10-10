const Drops = require("../../classes/Drops.js")

const fmtInt = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
// Miles con punto siempre (igual que commafy en las respuestas).

// XP con equivalencia visible; monedas en neutro (cada economía tiene su
// escala: la guía de XP no vale para monedas).
const xpChoices = Drops.AMOUNT_PRESETS
    .map(p => ({ name: `${p.name} · ${fmtInt(p.xp)} (${Drops.presetEquiv(p.xp)})`, value: p.xp }))
    .concat([{ name: "Personalizada… (usa xp_extra)", value: Drops.CUSTOM_AMOUNT }])
const coinChoices = Drops.COIN_PRESETS
    .map(p => ({ name: `${p.name} · ${fmtInt(p.coins)}`, value: p.coins }))
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

// "💰 5.000 XP + 🪙 1.000 monedas + 🎭 <@&rol> + 📦 2× Y".
function describePrizes(prizes, tools) {
    const parts = []
    if (prizes.xp > 0) parts.push(`💰 ${tools.commafy(prizes.xp)} XP`)
    if (prizes.coins > 0) parts.push(`🪙 ${tools.commafy(prizes.coins)} monedas`)
    for (const r of prizes.roles) parts.push(`🎭 <@&${r.id}>`)
    for (const it of prizes.items) parts.push(`📦 ${tools.commafy(it.qty)}× ${it.name || "objeto"}`)
    return parts.join(" + ")
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
        `👥 ${tools.commafy(drop.maxClaims)} usos · ⏳ caduca ${expires}\n` +
        `🔗 ${url}\n` +
        `-# Compártelo donde quieras: cada persona reclama una vez hasta agotar usos o que caduque.`
    )
},

async runList(client, int, tools) {
    const doc = await client.db.fetch(int.guild.id, ["drops"]).exec().catch(() => null)
    const rows = Drops.listDrops(doc)
    if (!rows.length) return int.reply({ content: "No hay drops en este servidor.", ephemeral: true })
    const lines = rows.map(({ code, drop, left, expired }) => {
        const prize = drop.kind === "bundle"
            ? describePrizes(Drops.normalizePrizes(drop.prizes), tools)
            : drop.kind === "role"
                ? `🎭 rol ${drop.roleName || `<@&${drop.roleId}>`}`
                : drop.kind === "item"
                    ? `📦 ${tools.commafy(drop.amount)}× ${drop.itemName || "objeto"}`
                    : `${Drops.kindEmoji(drop.kind)} ${tools.commafy(drop.amount)} ${Drops.kindName(drop.kind)}`
        const status = expired ? "⏳ caducado" : left <= 0 ? "🚫 agotado" : `✅ ${tools.commafy(left)} usos libres`
        return `\`${code}\` **${drop.name}** — ${prize} (${status}, caduca <t:${Math.floor(drop.expiresAt / 1000)}:R>)`
    })
    return int.reply({ content: `🎁 **Drops del servidor**\n${lines.join("\n")}`, ephemeral: true })
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
