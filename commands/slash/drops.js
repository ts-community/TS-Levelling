const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, ModalBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } = require("discord.js")
const Drops = require("../../classes/Drops.js")

// Emoji de XP del servidor (igual que /rank y /records).
const XP_EMOJI = "<:XP:1467192533812645939>"

const fmtInt = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
// Miles con punto siempre (igual que commafy en las respuestas).

const sepBuilder = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
const textBuilder = content => new TextDisplayBuilder().setContent(content)

// Fecha corta: solo lo relevante ("in 3 horas"), sin fecha completa.
const shortDate = ts => `<t:${Math.floor(Number(ts) / 1000)}:R>`

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
// un modal ("dropm:<accion>:<CODE>") para pedir el número exacto. "Reservar"
// abre una pestaña larga para pegar IDs/menciones; "Abrir a todos" y el menú
// "Quitar" solo salen cuando el drop ya tiene reservas.
const BTN_PREFIX = "drop"
const MODAL_PREFIX = "dropm"
const BTN_DEL = "del"
const BTN_USES = "uses"
const BTN_TIME = "time"
const BTN_SOLO = "solo"
const BTN_OPEN = "open"
const QUIT_PREFIX = "drop:quit:"
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

// Línea de un drop en la lista: link con (reclamados/total) y su premio.
// Tachado cuando se agotó; candado si solo pueden reclamar reservados.
function dropListLine(row, base, guildId, tools) {
    const { code, drop, left } = row
    const claimed = Math.max(0, Number(drop.maxClaims) - left)
    const url = `${base}${Drops.dropPath(guildId, code)}`
    const head = left <= 0 ? `~~[\`${code}\`](${url})~~` : `[\`${code}\`](${url})`
    const lock = drop.allow?.length ? " 🔒" : ""
    return `- ${head}${lock} (${tools.commafy(claimed)}/${tools.commafy(drop.maxClaims)}) - ${dropPrizeText(drop, tools, 2)}`
}

// Menú de drops. Con una vista abierta, la primera opción es "Volver atrás"
// (con ⬅️) para ir a la lista; debajo, los demás drops para saltar entre
// ellos sin cerrar.
function buildInspectMenu(rows, selectedCode, { deleteMode = false } = {}) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(MENU_ID)
        .setPlaceholder(deleteMode ? "Elige el drop a eliminar" : "Elige un drop para verlo en detalle")
    if (selectedCode) {
        menu.addOptions(new StringSelectMenuOptionBuilder()
            .setLabel("⬅️ Volver atrás")
            .setValue(BACK_VALUE)
            .setDescription("Ver todos los drops"))
    }
    const maxOptions = MAX_MENU_OPTIONS - (selectedCode ? 1 : 0)
    for (const { code, drop, left } of rows.filter(r => r.code !== selectedCode).slice(0, maxOptions)) {
        const claimed = Math.max(0, Number(drop.maxClaims) - left)
        menu.addOptions(new StringSelectMenuOptionBuilder()
            .setLabel(String(drop.name || `Drop ${code}`).slice(0, 100))
            .setValue(code)
            .setDescription(`${code} — ${fmtInt(claimed)}/${fmtInt(drop.maxClaims)} usos`))
    }
    return menu
}

// Lista: título, una línea por drop y el menú debajo. Vacío = una nota y
// nada más (sin separador de más ni menú sin opciones).
function buildDropsListContainer(rows, base, guildId, tools, { deleteMode = false } = {}) {
    const container = new ContainerBuilder().setAccentColor(0x87f3ff)
    container.addTextDisplayComponents(textBuilder(deleteMode ? `## 🗑️ Eliminar un drop` : `## 🎁 Drops del servidor`))
    container.addSeparatorComponents(sepBuilder())
    if (!rows.length) {
        container.addTextDisplayComponents(textBuilder(
            deleteMode
                ? `-# No hay ningún drop que eliminar: no queda ninguno activo.`
                : `-# No hay ningún drop activo. Crea el primero con \`/drops crear\` y saldrá aquí.`,
        ))
        return container
    }
    container.addTextDisplayComponents(textBuilder(
        rows.slice(0, MAX_MENU_OPTIONS).map(row => dropListLine(row, base, guildId, tools)).join("\n")
        + (rows.length > MAX_MENU_OPTIONS ? `\n-# +${rows.length - MAX_MENU_OPTIONS} más (elimina viejos para verlos)` : ""),
    ))
    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildInspectMenu(rows, null, { deleteMode })))
    return container
}

// Detalle de un drop: lo esencial en pocas líneas, botones de gestión,
// menú para quitar reservados (si los hay) y el menú con "Volver atrás"
// como primera opción.
function buildDropDetailContainer(rows, row, base, guildId, tools, { deleteMode = false } = {}) {
    const { code, drop, left } = row
    const claimed = Math.max(0, Number(drop.maxClaims) - left)
    const url = `${base}${Drops.dropPath(guildId, code)}`
    const allowed = Array.isArray(drop?.allow) ? drop.allow : []
    const container = new ContainerBuilder().setAccentColor(0x87f3ff)
    container.addTextDisplayComponents(textBuilder(`## 🎁 ${drop.name || "Drop"} \`${code}\``))
    container.addSeparatorComponents(sepBuilder())
    const info = [
        `- 🎁 **Premio por persona:** ${dropPrizeText(drop, tools)}`,
        `- 📊 **Reclamados:** ${tools.commafy(claimed)}/${tools.commafy(drop.maxClaims)}`,
        `- ⏳ **Caduca:** ${shortDate(drop.expiresAt)}`,
        `- 🔗 **Enlace:** ${url}`,
    ]
    if (allowed.length) {
        info.push(`- 🔒 **Reservado:** ${allowed.map(u => `<@${u.id}>`).join(" ")}`)
    }
    container.addTextDisplayComponents(textBuilder(info.join("\n")))
    container.addSeparatorComponents(sepBuilder())
    const buttons = [
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_DEL}:${code}`).setLabel("Eliminar").setStyle(ButtonStyle.Danger).setEmoji("🗑️"),
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_USES}:${code}`).setLabel("Añadir usos").setStyle(ButtonStyle.Secondary).setEmoji("➕"),
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_TIME}:${code}`).setLabel("Añadir tiempo").setStyle(ButtonStyle.Secondary).setEmoji("⏳"),
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_SOLO}:${code}`).setLabel("Reservar").setStyle(ButtonStyle.Secondary).setEmoji("🔒"),
    ]
    if (allowed.length) {
        buttons.push(new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_OPEN}:${code}`).setLabel("Abrir a todos").setStyle(ButtonStyle.Success).setEmoji("🌍"))
    }
    container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons))
    if (allowed.length) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`${BTN_PREFIX}:quit:${code}`)
                .setPlaceholder("Quitar a un reservado")
                // En el menú caben 25; el resto se arregla publicando de nuevo.
                .addOptions(allowed.slice(0, MAX_MENU_OPTIONS).map(u =>
                    new StringSelectMenuOptionBuilder()
                        .setValue(String(u.id))
                        .setLabel(String(u.name || `usuario ${u.id}`).slice(0, 100)),
                )),
        ))
    }
    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildInspectMenu(rows, code, { deleteMode })))
    return container
}

// Todas las respuestas van en Componentes V2 y visibles (sin efímero).
const V2 = { components: c => ({ components: [c], flags: [MessageFlags.IsComponentsV2], allowedMentions: { parse: [] } }) }
const V2_EPHEMERAL = { components: c => ({ components: [c], flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral], allowedMentions: { parse: [] } }) }
const say = (int, container) => int.editReply(V2.components(container))

// Drops nuevos nunca llevan roles como premio (quitar roles de reparto:
// jerarquía/permisos de staff = riesgo).

// ─── Asistente /drops crear: borrador y helpers ───────────────────────────
// Panel raíz: resumen (usos, caducidad, privado/público) + menú de premios +
// menú de reservados + botones de nombre/usos/caducidad y Crear/Cancelar.
// La eleccion de cantidad sale en un panel EFÍMERO y al elegir se edita
// el mensaje original. Nada toca la BD hasta pulsar "Crear".
const MK = {
    MENU: "wizmk:reward",
    USERS: "wizmk:users",
    NAME: "wizmk:name",
    USES: "wizmk:uses",
    DUR: "wizmk:dur",
    CREATE: "wizmk:create",
    CANCEL: "wizmk:cancel",
    XP: "wizmk:xp",
    COINS: "wizmk:coins",
    ITEM: "wizmk:item",
    RITEM: "wizmk:ritem",
    DONE: "wizmk:done",
}

function makeDraft(name, { maxClaims = 10, durationMin = 1440 } = {}) {
    return {
        name: String(name || "").trim() || "Drop",
        maxClaims: Math.max(1, Math.min(Drops.LIMITS.usesMax, Math.round(Number(maxClaims) || 10))),
        durationMin: Math.max(Drops.LIMITS.durationMin, Math.min(Drops.LIMITS.durationMax, Math.round(Number(durationMin) || 1440))),
        xp: 0,
        coins: 0,
        items: [],
        allow: [],
    }
}

function draftPrizes(d) {
    return {
        xp: Math.max(0, Math.round(Number(d?.xp) || 0)),
        coins: Math.max(0, Math.round(Number(d?.coins) || 0)),
        roles: [],
        items: (Array.isArray(d?.items) ? d.items : []).map(it => ({ id: String(it.id), name: String(it.name), qty: Number(it.qty) })),
    }
}

// Objetos: se agrupan por id; máximo 3 distintos; cantidad con tope.
function draftAddItem(d, item, qty) {
    const n = Math.min(Drops.LIMITS.qtyMax, Math.round(Number(qty) || 0))
    if (!item?.id || n < 1) return false
    const existing = d.items.find(it => it.id === String(item.id))
    if (existing) {
        existing.qty = Math.min(Drops.LIMITS.qtyMax, existing.qty + n)
        return true
    }
    if (d.items.length >= 3) return false
    d.items.push({ id: String(item.id), name: String(item.name || "objeto").slice(0, 100), qty: n })
    return true
}

function draftRemoveItem(d, id) {
    d.items = d.items.filter(it => it.id !== String(id))
}

// Reservas: fusiona, limpia y recorta al tope (sin duplicados). Con
// reservas, el drop queda privado y los usos se igualan automáticamente a
// la cantidad de usuarios reservados (cada uno reclama una vez).
function draftAddAllow(d, picks) {
    d.allow = Drops.normalizeAllowedUsers([...(d.allow || []), ...(Array.isArray(picks) ? picks : [])])
    if (d.allow.length) d.maxClaims = d.allow.length
    return d.allow
}

function draftRemoveAllow(d, id) {
    d.allow = d.allow.filter(u => String(u?.id) !== String(id))
    if (!d.allow.length) return
    d.maxClaims = Math.max(d.maxClaims, d.allow.length)
}

// Duración: etiqueta del preset si existe; minutos en crudo si no.
function durationLabel(min) {
    const m = Math.round(Number(min) || 0)
    const hit = Drops.DURATION_PRESETS.find(p => p.minutes === m)
    return hit ? hit.label : `${fmtInt(m)} minutos`
}

// "🌍 Público" o "🔒 Privado: Nombre (<@id>), ...".
function describeAllow(allow) {
    const people = Array.isArray(allow) ? allow : []
    if (!people.length) return "🌍 **Público:** cualquiera puede reclamar"
    const list = people.map(u => `${u.name} (<@${u.id}>)`)
    return `🔒 **Privado:** ${list.join(", ")}${people.length > 10 ? ` (+${people.length - 10} más)` : ""}`
}

const presetOption = (label, value, description) =>
    new StringSelectMenuOptionBuilder().setLabel(String(label).slice(0, 100)).setValue(String(value)).setDescription(String(description).slice(0, 100))

// Resumen de premios del borrador para confirmaciones: "🆙 10.000 XP + 📦 3× X".
function prizeSummary(d, tools) {
    const parts = []
    if (d.xp > 0) parts.push(`🆙 ${tools.commafy(d.xp)} XP`)
    if (d.coins > 0) parts.push(`🪙 ${tools.commafy(d.coins)} monedas`)
    for (const it of d.items) parts.push(`📦 ${tools.commafy(it.qty)}× ${it.name}`)
    return parts.join(" + ")
}

// Panel raíz del asistente. Estructura:
// título / sep / usos+caducidad+privado / sep / "Premio por persona" /
// sep / lista de premios / sep / menús / sep / botones config / sep / crear.
function buildMakeContainer(draft, { tools = { commafy: fmtInt }, boat = false, storeItems = null } = {}) {
    const container = new ContainerBuilder().setAccentColor(0x87f3ff)

    container.addTextDisplayComponents(textBuilder(`## 📋 Crear drop: ${draft.name}`))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder([
        `👥 **Usos:** ${tools.commafy(draft.maxClaims)}`,
        `📅 **Caducidad:** ${durationLabel(draft.durationMin)}`,
        describeAllow(draft.allow),
    ].join("\n")))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder(`💰 **Premio por persona:**`))
    container.addSeparatorComponents(sepBuilder())
    const parts = prizeSummary(draft, tools)
    container.addTextDisplayComponents(textBuilder(parts ? parts.split(" + ").map(p => `- ${p}`).join("\n") : "-# nada todavía"))
    container.addSeparatorComponents(sepBuilder())

    const rewardOptions = [
        presetOption("🆙 XP", "xp", "Elegir/recambiar la XP por persona"),
        boat && presetOption("🪙 Monedas", "coins", "Elegir/cambiar las monedas"),
        boat && presetOption("📦 Objeto", "item", "Añadir/quitar objetos de tienda"),
    ].filter(Boolean)
    const reward = new StringSelectMenuBuilder()
        .setCustomId(MK.MENU)
        .setPlaceholder("Elige un tipo de premio")
        .addOptions(...rewardOptions)
    container.addActionRowComponents(new ActionRowBuilder().addComponents(reward))

    const users = new UserSelectMenuBuilder()
        .setCustomId(MK.USERS)
        .setPlaceholder("Añadir usuarios → drop privado")
        .setMinValues(1)
        .setMaxValues(25)
    container.addActionRowComponents(new ActionRowBuilder().addComponents(users))

    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(MK.NAME).setLabel("Nombre").setStyle(ButtonStyle.Secondary).setEmoji("🏷️"),
        new ButtonBuilder().setCustomId(MK.USES).setLabel("Usos").setStyle(ButtonStyle.Secondary).setEmoji("👥"),
        new ButtonBuilder().setCustomId(MK.DUR).setLabel("Caducidad").setStyle(ButtonStyle.Secondary).setEmoji("📅"),
    ))
    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(MK.CREATE).setLabel("Crear").setStyle(ButtonStyle.Success)
            .setDisabled(!(draft.xp > 0 || draft.coins > 0 || draft.items.length > 0)),
        new ButtonBuilder().setCustomId(MK.CANCEL).setLabel("Cancelar").setStyle(ButtonStyle.Danger).setEmoji("🚫"),
    ))
    return container
}

// Panel EFÍMERO para elegir cantidad de un tipo de premio. Al elegir, se
// edita el mensaje original y este panel muestra la confirmación.
function buildPickContainer(kind, { tools = { commafy: fmtInt }, boat = false, storeItems = null, draft = null } = {}) {
    const container = new ContainerBuilder().setAccentColor(0x87f3ff)
    const titles = { xp: "🆙 XP por reclamo", coins: "🪙 Monedas por reclamo", item: "📦 Objeto del premio" }
    container.addTextDisplayComponents(textBuilder(`## ${titles[kind] || "Premio"}`))
    container.addSeparatorComponents(sepBuilder())

    if (kind === "xp" || kind === "coins") {
        const actual = kind === "xp" ? draft?.xp : draft?.coins
        if (actual > 0) container.addTextDisplayComponents(textBuilder(`-# Actual: ${tools.commafy(actual)} ${kind === "xp" ? "XP" : "monedas"}`))
        const presets = kind === "xp" ? Drops.AMOUNT_PRESETS : Drops.COIN_PRESETS
        const menu = new StringSelectMenuBuilder()
            .setCustomId(kind === "xp" ? MK.XP : MK.COINS)
            .setPlaceholder(kind === "xp" ? "Elige la XP por persona" : "Elige las monedas por persona")
        for (const p of presets) {
            const amount = kind === "xp" ? p.xp : p.coins
            menu.addOptions(presetOption(
                `${p.name} · ${fmtInt(amount)} ${kind === "xp" ? "XP" : "monedas"}`, amount,
                kind === "xp" ? Drops.presetEquiv(p.xp) : "Escala de la economía",
            ))
        }
        menu.addOptions(presetOption("✏️ Personalizada…", "custom", "Escribe la cantidad exacta"))
        menu.addOptions(presetOption("🗑️ Quitar este premio", "none", "Dejarlo sin este premio"))
        container.addActionRowComponents(new ActionRowBuilder().addComponents(menu))
        container.addTextDisplayComponents(textBuilder(kind === "xp"
            ? "-# Presets de récords: el equivalente sale en cada opción."
            : "-# Cada economía tiene su escala: tú decides lo razonable."))
    } else if (kind === "item") {
        if (draft?.items?.length) {
            container.addTextDisplayComponents(textBuilder(draft.items.map(it => `- 📦 **${tools.commafy(it.qty)}× ${it.name}**`).join("\n")))
            container.addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(MK.RITEM)
                    .setPlaceholder("Quitar un objeto del premio")
                    .addOptions(draft.items.map(it => presetOption(`${it.qty}× ${it.name}`, it.id, "Quitar del premio"))),
            ))
        }
        const menu = new StringSelectMenuBuilder()
            .setCustomId(MK.ITEM)
            .setPlaceholder("Elige un objeto de la tienda")
        for (const it of (storeItems || []).slice(0, MAX_MENU_OPTIONS)) {
            menu.addOptions(presetOption(
                `${it.emoji ? it.emoji + " " : ""}${it.name}`, it.id,
                Number(it.price) ? `${tools.commafy(it.price)} monedas` : "Gratis",
            ))
        }
        container.addActionRowComponents(new ActionRowBuilder().addComponents(menu))
        container.addTextDisplayComponents(textBuilder("-# Máximo 3 objetos distintos y 100 unidades por objeto."))
    }

    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(MK.DONE).setLabel("Cerrar").setStyle(ButtonStyle.Secondary).setEmoji("⬅️"),
    ))
    return container
}

// Confirmación efímera compacta.
function buildConfirmContainer(text) {
    return new ContainerBuilder().setAccentColor(0x87f3ff)
        .addTextDisplayComponents(textBuilder(text))
        .addSeparatorComponents(sepBuilder())
        .addTextDisplayComponents(textBuilder("-# Hecho: el panel principal está actualizado."))
}

// Pantalla de cancelado del asistente.
function buildCancelledContainer() {
    return new ContainerBuilder().setAccentColor(0x87f3ff)
        .addTextDisplayComponents(textBuilder("## 🚫 Cancelado"))
        .addTextDisplayComponents(textBuilder("-# El asistente se cerró: no se ha creado ningún drop."))
}

// Mensaje final del drop creado. Solo texto: el enlace es lo importante.
function buildCreatedContainer(drop, code, url, tools = { commafy: fmtInt }, allow = null) {
    const container = new ContainerBuilder().setAccentColor(0x87f3ff)
    container.addTextDisplayComponents(textBuilder(`## 🎁 Drop creado: ${drop.name || "Drop"} \`${code}\``))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder(`💰 **Premio por persona:**`))
    container.addSeparatorComponents(sepBuilder())
    const prizes = Drops.normalizePrizes(drop.prizes || { xp: drop.xp, coins: drop.coins, roles: [], items: drop.items || [] })
    const prizeParts = [
        prizes.xp > 0 && `- 🆙 ${tools.commafy(prizes.xp)} XP`,
        prizes.coins > 0 && `- 🪙 ${tools.commafy(prizes.coins)} monedas`,
        ...prizes.roles.map(r => `- 🎭 <@&${r.id}>`),
        ...prizes.items.map(it => `- 📦 ${tools.commafy(it.qty)}× ${it.name || "objeto"}`),
    ].filter(Boolean)
    container.addTextDisplayComponents(textBuilder(prizeParts.length ? prizeParts.join("\n") : "-# nada todavía"))
    container.addSeparatorComponents(sepBuilder())
    const people = (Array.isArray(allow) ? allow : []).filter(Boolean).length ? allow : (Array.isArray(drop?.allow) ? drop.allow : [])
    const shown = people.slice(0, 10)
    const lines = [
        `- 👥 **Usos:** ${tools.commafy(drop.maxClaims)}`,
        `- ⏳ **Caduca:** ${shortDate(drop.expiresAt)}`,
        people.length ? `- 🔒 **Privado:** ${shown.map(u => (u.name ? `${u.name} (<@${u.id}>)` : `<@${u.id}>`)).join(", ")}${people.length > 10 ? ` (+${people.length - 10} más)` : ""}` : "",
    ].filter(Boolean)
    container.addTextDisplayComponents(textBuilder(lines.join("\n")))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder(`🔗 **Enlace:** ${url}`))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder("-# Comparte el enlace: cada persona lo reclama una vez, hasta agotar usos o que caduque."))
    return container
}

// Modales del asistente. Todos pican el campo "value" (los tests fijan
// ese contract; los prefills opcionales rellenan el valor actual).
function makeTextInput(prefill, opts) {
    const input = new TextInputBuilder()
        .setCustomId("value")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setLabel(opts.label)
        .setPlaceholder(opts.placeholder)
        .setMaxLength(opts.max)
    if (prefill !== undefined && prefill !== null && String(prefill).length) input.setValue(String(prefill).slice(0, opts.max))
    return input
}

function buildMakeNameModal(prefill = "") {
    return new ModalBuilder()
        .setCustomId("dropw:name")
        .setTitle("Nombre del drop")
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput(prefill, { label: "Nombre", placeholder: "Ej: Premio del 1v1", max: 40 })))
}

function buildMakeUsesModal(prefill = "") {
    return new ModalBuilder()
        .setCustomId("dropw:uses")
        .setTitle("Usos del drop")
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput(prefill, { label: "Cuántas personas pueden reclamarlo", placeholder: "Ej: 10", max: 4 })))
}

function buildMakeDurModal(prefill = "") {
    return new ModalBuilder()
        .setCustomId("dropw:dur")
        .setTitle("Caducidad del drop")
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput(prefill, { label: `Minutos (${fmtInt(Drops.LIMITS.durationMin)}-${fmtInt(Drops.LIMITS.durationMax)})`, placeholder: "1440 = 24 horas", max: 5 })))
}

function buildMakeXpModal(prefill = "") {
    return new ModalBuilder()
        .setCustomId("dropw:xp")
        .setTitle("XP por reclamo")
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput(prefill, { label: "Cuánto XP por persona", placeholder: "Ej: 5000", max: 7 })))
}

function buildMakeCoinsModal(prefill = "") {
    return new ModalBuilder()
        .setCustomId("dropw:coins")
        .setTitle("Monedas por reclamo")
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput(prefill, { label: "Cuántas monedas por persona", placeholder: "Ej: 10000", max: 10 })))
}

function buildMakeQtyModal(item) {
    return new ModalBuilder()
        .setCustomId(`dropw:qty:${item.id}`)
        .setTitle(`Unidades: ${item.name}`.slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput("", { label: "Unidades por reclamo", placeholder: "1", max: 3 })))
}

// Modal del detalle "/drops mostrar": pegar IDs o menciones para privar.
function buildReserveModal(code) {
    return new ModalBuilder()
        .setCustomId(`dropw:solo:${code}`)
        .setTitle(`Privar ${code}`)
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("value")
                .setLabel("IDs o menciones de usuarios")
                .setPlaceholder("<@123…>, 123… (varios, uno tras otro)")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(2000)))
}

// Extrae las menciones <@…> y los IDs crudos (17-20 dígitos) de un texto
// (o de una lista), sin duplicados y con el tope de reservas.
function parseAllowedInput(input) {
    const text = Array.isArray(input) ? input.join(" ") : String(input || "")
    const found = []
    const seen = new Set()
    const push = id => { if (/^\d{17,20}$/.test(id) && !seen.has(id)) { seen.add(id); found.push(id) } }
    for (const m of text.matchAll(/<@(\d{17,20})>/g)) push(m[1])
    for (const m of text.replace(/<@\d{17,20}>/g, " ").matchAll(/\b\d{17,20}\b/g)) push(m[0])
    return found.slice(0, Drops.LIMITS.allowedMax)
}

// Añade privados (y sube usos si hacen falta: cada privado necesita su
// usado, además de los usos ya gastados por ajenos). Devuelve
// { ok, added, total, bump }.
async function applyReserve(client, guildId, code, users) {
    const doc = await client.db.fetch(guildId, ["drops"]).exec().catch(() => null)
    const drop = doc?.drops?.[code]
    if (!drop) return { ok: false }
    const before = Array.isArray(drop.allow) ? drop.allow : []
    const clean = Drops.normalizeAllowedUsers([...before, ...(Array.isArray(users) ? users : [])])
    const foreign = (drop.claims || []).filter(c => !clean.some(u => String(u.id) === String(c))).length
    const bump = Math.max(Number(drop.maxClaims) || 0, clean.length + foreign)
    await client.db.update(guildId, { $set: { [`drops.${code}.allow`]: clean, [`drops.${code}.maxClaims`]: bump } }).exec()
    return { ok: true, added: clean.length - before.length, total: clean.length, bump }
}

// Quita a un usuario de los privados (devuelve la lista final o null).
async function applyAllowRemove(client, guildId, code, userId) {
    const doc = await client.db.fetch(guildId, ["drops"]).exec().catch(() => null)
    const drop = doc?.drops?.[code]
    if (!drop) return null
    const allow = (Array.isArray(drop.allow) ? drop.allow : []).filter(u => String(u?.id) !== String(userId))
    await client.db.update(guildId, { $set: { [`drops.${code}.allow`]: allow } }).exec()
    return allow
}

// Hace el drop público de nuevo (borra los privados).
async function applyOpenAll(client, guildId, code) {
    await client.db.update(guildId, { $set: { [`drops.${code}.allow`]: [] } }).exec()
    return true
}

module.exports = {
    metadata: {
        permission: "ManageGuild",
        name: "drops",
        description: "Drops reclamables por web (XP, monedas, objetos).",
        args: [
            { type: "subcommand", name: "crear", description: "Crea un drop con enlace para reclamar (asistente interactivo)", args: [
                { type: "string", name: "nombre", description: "Nombre del drop (opcional: uso Drop #N)", required: false },
            ]},
            { type: "subcommand", name: "mostrar", description: "Ver los drops activos del servidor", args: [] },
            { type: "subcommand", name: "eliminar", description: "Eliminar un drop con un menú", args: [] },
            { type: "subcommand", name: "permiso", description: "Roles que pueden usar /drops (solo gestores)", args: [
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

        // Defer del tirón: las validaciones y las llamadas a la API de
        // UnbelievaBoat tardan; sin defer, Discord "no responde" aunque todo
        // salga bien. A partir de aquí, warn() cae en el edit del defer.
        await int.deferReply().catch(() => {})
        if (sub === "mostrar") return module.exports.runList(client, int, tools, {})
        if (sub === "eliminar") return module.exports.runList(client, int, tools, { deleteMode: true })
        if (sub === "permiso") return module.exports.runPermiso(client, int, tools)
        return module.exports.runCreate(client, int, tools, db)
    },

    async runCreate(client, int, tools, db) {
        // ─── Asistente interactivo /drops crear ───
        // El comando solo pide el nombre (opcional); el resto se configura
        // en el mensaje con menús y botones V2. Mensaje público (sin efímero);
        // las elecciones de cantidad van en un panel efímero aparte.
        const guildId = int.guild.id
        const authorId = int.user.id
        const boat = Drops.boatEnabled()

        // Contador para nombre automático.
        let dropSeq = 0
        try {
            const doc = await client.db.fetch(guildId, ["settings.dropSeq"]).exec().catch(() => null)
            dropSeq = (Number(doc?.settings?.dropSeq) || 0) + 1
        } catch {}

        const draft = makeDraft(String(int.options.get("nombre")?.value || "").trim() || `Drop #${dropSeq}`)

        // Tienda de UnbelievaBoat: carga bajo demanda.
        let storeItems = null, storeError = false
        const ensureStore = async () => {
            if (storeItems || storeError) return
            try { storeItems = await Drops.fetchBoatStore(guildId) }
            catch { storeError = true }
        }

        const toolsLite = { commafy: (...a) => tools.commafy(...a) }
        const render = () => buildMakeContainer(draft, { tools: toolsLite, boat, storeItems })

        // Modal + espera de envío: showModal ya reconoce el componente, y el
        // modal submit se procesa aquí mismo (los errores van efímeros).
        const askModal = async (i, modalId, modal) => {
            try { await i.showModal(modal) } catch { return null }
            try { return await i.awaitModalSubmit({ filter: s => s.customId === modalId && s.user.id === authorId, time: 120000 }) }
            catch { return null }
        }

        // Mensaje inicial (no efímero): editReply devuelve el mensaje.
        const sent = await int.editReply(V2.components(render())).catch(() => null)
        if (!sent) return
        const editMain = async () => { await sent.edit(V2.components(render())).catch(() => {}) }
        const collector = sent.createMessageComponentCollector?.({ time: 24 * 60 * 60 * 1000 })
        if (!collector) return

        let busy = false

        // ── Choque de premio épímero: al elegir configura el borrador,
        // edita el panel original y confirma arriba en el mismo efímero.
        const openPick = async (kind, packInt) => {
            if (kind === "coins" && !boat) {
                return packInt.reply({ content: "Monedas: hace falta UnbelievaBoat configurado.", ephemeral: true }).catch(() => {})
            }
            if (kind === "item") {
                await ensureStore()
                if (!storeItems?.length) {
                    return packInt.reply({ content: storeError ? "No pude leer la tienda de UnbelievaBoat." : "La tienda está vacía.", ephemeral: true }).catch(() => {})
                }
            }
            const panel = await packInt.reply({
                ...V2_EPHEMERAL.components(buildPickContainer(kind, { tools: toolsLite, boat, storeItems, draft })),
                fetchReply: true,
            }).catch(() => null)
            if (!panel) return
            const own = panel.createMessageComponentCollector?.({ time: 5 * 60 * 1000 })
            if (!own) return
            own.on("collect", async j => {
                if (j.user.id !== authorId) return
                // Cerrar: queda el panel con la confirmación y se detiene.
                if (j.isButton() && j.customId === MK.DONE) {
                    await j.update(V2_EPHEMERAL.components(buildConfirmContainer("✅ Panel cerrado"))).catch(() => {})
                    own.stop("done")
                    return
                }
                const id = j.customId
                // ── Cantidad fija de XP ──
                if (j.isStringSelectMenu() && id === MK.XP) {
                    const v = j.values?.[0]
                    if (v === "custom") {
                        const sub = await askModal(j, "dropw:xp", buildMakeXpModal(draft.xp || ""))
                        if (!sub) return
                        const n = Math.round(Number(sub.fields.getTextInputValue("value")) || 0)
                        if (n < Drops.LIMITS.amountMin || n > Drops.LIMITS.amountMax) {
                            await sub.reply({ content: `Pon un número entre ${fmtInt(Drops.LIMITS.amountMin)} y ${fmtInt(Drops.LIMITS.amountMax)} XP.`, ephemeral: true }).catch(() => {})
                            return
                        }
                        draft.xp = n
                        // El modal ya reconoció a j: se reconoce el envío y se
                        // refresca el panel efímero desde el propio submit.
                        await editMain()
                        await sub.update(V2_EPHEMERAL.components(buildConfirmContainer(`✅ Premios: ${prizeSummary(draft, toolsLite) || "sin premios"}`))).catch(() => {})
                        own.stop("ok")
                        return
                    }
                    if (v === "none") {
                        draft.xp = 0
                    } else {
                        draft.xp = Math.round(Number(v) || 0)
                    }
                    await editMain()
                    await j.update(V2_EPHEMERAL.components(buildConfirmContainer(`✅ Premios: ${prizeSummary(draft, toolsLite) || "sin premios"}`))).catch(() => {})
                    own.stop("ok")
                    return
                }
                // ── Cantidad fija de monedas ──
                if (j.isStringSelectMenu() && id === MK.COINS) {
                    const v = j.values?.[0]
                    if (v === "custom") {
                        const sub = await askModal(j, "dropw:coins", buildMakeCoinsModal(draft.coins || ""))
                        if (!sub) return
                        const n = Math.round(Number(sub.fields.getTextInputValue("value")) || 0)
                        if (n < Drops.LIMITS.coinMin || n > Drops.LIMITS.coinMax) {
                            await sub.reply({ content: `Pon un número entre ${fmtInt(Drops.LIMITS.coinMin)} y ${fmtInt(Drops.LIMITS.coinMax)} monedas.`, ephemeral: true }).catch(() => {})
                            return
                        }
                        draft.coins = n
                        await editMain()
                        await sub.update(V2_EPHEMERAL.components(buildConfirmContainer(`✅ Premios: ${prizeSummary(draft, toolsLite) || "sin premios"}`))).catch(() => {})
                        own.stop("ok")
                        return
                    }
                    if (v === "none") {
                        draft.coins = 0
                    } else {
                        draft.coins = Math.round(Number(v) || 0)
                    }
                    await editMain()
                    await j.update(V2_EPHEMERAL.components(buildConfirmContainer(`✅ Premios: ${prizeSummary(draft, toolsLite) || "sin premios"}`))).catch(() => {})
                    own.stop("ok")
                    return
                }
                // ── Objetos: añadir con modal de unidades ──
                if (j.isStringSelectMenu() && id === MK.ITEM) {
                    const item = (storeItems || []).find(it => it.id === j.values?.[0])
                    if (!item) return
                    if (draft.items.length >= 3 && !draft.items.some(it => it.id === item.id)) {
                        await j.update(V2_EPHEMERAL.components(buildConfirmContainer("⚠️ Máximo 3 objetos distintos."))).catch(() => {})
                        return
                    }
                    const sub = await askModal(j, `dropw:qty:${item.id}`, buildMakeQtyModal(item))
                    if (!sub) return
                    const n = Math.round(Number(sub.fields.getTextInputValue("value")) || 0)
                    if (n < 1 || n > Drops.LIMITS.qtyMax) {
                        await sub.reply({ content: `Pon un número entre 1 y ${Drops.LIMITS.qtyMax}.`, ephemeral: true }).catch(() => {})
                        return
                    }
                    draftAddItem(draft, item, n)
                    await editMain()
                    await sub.update(V2_EPHEMERAL.components(buildConfirmContainer(`✅ Premios: ${prizeSummary(draft, toolsLite) || "sin premios"}`))).catch(() => {})
                    own.stop("ok")
                    return
                }
                // ── Objetos: quitar uno del premio ──
                if (j.isStringSelectMenu() && id === MK.RITEM) {
                    draftRemoveItem(draft, j.values?.[0])
                    await editMain()
                    await j.update(V2_EPHEMERAL.components(buildConfirmContainer(`✅ Premios: ${prizeSummary(draft, toolsLite) || "sin premios"}`))).catch(() => {})
                    own.stop("ok")
                    return
                }
            })
            own.on("end", () => {})
        }

        collector.on("collect", async i => {
            if (i.user.id !== authorId) return tools.denyButton(i, "drops")
            const id = i.customId

            // ── Menú de tipo de premio: abre el panel efímero de cantidad ──
            if (i.isStringSelectMenu() && id === MK.MENU) {
                const val = i.values?.[0]
                if (val === "xp" || val === "coins" || val === "item") {
                    await openPick(val, i)
                }
                return
            }

            // ── Menú de reservados: el drop pasa a privado y su usos = reservas ──
            if (i.isUserSelectMenu() && id === MK.USERS) {
                await i.deferUpdate()
                const picks = i.values.slice(0, 25).map(uid => ({
                    id: uid,
                    name: i.members?.get(uid)?.displayName || i.users?.get(uid)?.username || `usuario ${uid}`,
                }))
                const before = draft.allow.length
                draftAddAllow(draft, picks)
                if (picks.length && draft.allow.length === before) {
                    await i.followUp({ content: `Tope de reservas alcanzado (${Drops.LIMITS.allowedMax}).`, ephemeral: true }).catch(() => {})
                }
                await i.editReply(V2.components(render())).catch(() => {})
                return
            }

            // ── Botones simples: nombre, usos, caducidad ──
            if (i.isButton() && id === MK.NAME) {
                const sub = await askModal(i, "dropw:name", buildMakeNameModal(draft.name))
                if (!sub) return
                const v = String(sub.fields.getTextInputValue("value") || "").trim().slice(0, 40)
                if (v) draft.name = v
                await sub.update(V2.components(render())).catch(() => {})
                return
            }
            if (i.isButton() && id === MK.USES) {
                const sub = await askModal(i, "dropw:uses", buildMakeUsesModal(String(draft.maxClaims)))
                if (!sub) return
                draft.maxClaims = Math.max(1, Math.min(Drops.LIMITS.usesMax, Math.round(Number(sub.fields.getTextInputValue("value")) || 0)))
                await sub.update(V2.components(render())).catch(() => {})
                return
            }
            if (i.isButton() && id === MK.DUR) {
                const sub = await askModal(i, "dropw:dur", buildMakeDurModal(String(draft.durationMin)))
                if (!sub) return
                draft.durationMin = Math.max(Drops.LIMITS.durationMin, Math.min(Drops.LIMITS.durationMax, Math.round(Number(sub.fields.getTextInputValue("value")) || 1440)))
                await sub.update(V2.components(render())).catch(() => {})
                return
            }

            // ── Crear / Cancelar ──
            if (i.isButton() && id === MK.CREATE) {
                const prizes = draftPrizes(draft)
                if (Drops.prizesCount(prizes) === 0) {
                    return i.reply({ content: "Añade al menos una recompensa antes de crear.", ephemeral: true }).catch(() => {})
                }
                if (busy) return
                busy = true
                try {
                    await i.deferUpdate()
                    const res = await Drops.createDrop(client, guildId, {
                        maxClaims: draft.maxClaims,
                        durationMin: draft.durationMin,
                        name: draft.name,
                        createdBy: authorId,
                        kind: "bundle",
                        prizes,
                        allowedUsers: draft.allow,
                    })
                    if (!res.ok) throw new Error((res.errors || []).join("; "))
                    const code = res.code
                    if (dropSeq > 0) {
                        await client.db.update(guildId, { $set: { "settings.dropSeq": dropSeq } }).exec().catch(() => {})
                    }
                    const url = Drops.dropUrl(guildId, code, tools.WEBSITE)
                    await i.editReply(V2.components(buildCreatedContainer(res.drop, code, url, tools, draft.allow)))
                    collector.stop("created")
                } catch (e) {
                    console.error("[drops:crear]", e?.message)
                    await i.followUp({ content: "No se pudo crear el drop: revisa los premios e inténtalo de nuevo.", ephemeral: true }).catch(() => {})
                } finally { busy = false }
                return
            }
            if (i.isButton() && id === MK.CANCEL) {
                collector.stop("cancel")
                await i.update(V2.components(buildCancelledContainer())).catch(() => {})
            }
        })

        collector.on("end", async (_, reason) => {
            if (reason === "cancel" || reason === "created") return
            try {
                await sent.edit(V2.components(new ContainerBuilder().setAccentColor(0x87f3ff)
                    .addTextDisplayComponents(textBuilder("## ⏱️ Tiempo agotado"))
                    .addTextDisplayComponents(textBuilder("-# El asistente se cerró: reabre `/drops crear` cuando quieras."))))
            } catch {}
        })
    },

    // ───
    async runList(client, int, tools, { deleteMode = false } = {}) {
        const base = Drops.dropsBaseUrl(tools.WEBSITE)
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
            const fresh = selected ? currentRows.find(r => r.code === selected) : null
            if (selected && !fresh) selected = null
            return fresh
                ? buildDropDetailContainer(currentRows, fresh, base, guildId, tools, { deleteMode })
                : buildDropsListContainer(currentRows, base, guildId, tools, { deleteMode })
        }

        await say(int, render())
        const message = await int.fetchReply().catch(() => null)
        if (!message) return

        let busy = false
        const refresh = async editor => {
            currentRows = await fetchRows()
            await editor.editReply(V2.components(render()))
        }
        // Botones de cantidad/tiempo: abren un modal para el número exacto y
        // al confirmar refrescan el mensaje de arriba.
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
                        ? `Pon un número de usos entre ${USES_BOUNDS.min} y ${USES_BOUNDS.max} usos.`
                        : `Pon un número de horas entre ${HOURS_BOUNDS.min} y ${HOURS_BOUNDS.max}.`,
                    ephemeral: true,
                }).catch(() => {})
            }
            try {
                await submitted.deferUpdate()
                const doc = await client.db.fetch(guildId, [`drops.${code}`]).exec().catch(() => null)
                const drop = doc?.drops?.[code]
                if (!drop) {
                    return submitted.followUp({ content: "Ese drop ya no existe. Reabre /drops mostrar." }).catch(() => {})
                }
                if (isUses) {
                    const total = Number(drop.maxClaims) + parsed.value
                    if (total > Drops.LIMITS.usesMax) {
                        return submitted.followUp({ content: `Se pasaría del máximo (${tools.commafy(Drops.LIMITS.usesMax)} usos).` }).catch(() => {})
                    }
                    await client.db.update(guildId, { $set: { [`drops.${code}.maxClaims`]: total } }).exec()
                } else {
                    await client.db.update(guildId, { $set: { [`drops.${code}.expiresAt`]: Number(drop.expiresAt) + parsed.value * 3600 * 1000 } }).exec()
                }
                currentRows = await fetchRows()
                selected = code
                // El modal ya reconoció a buttonInt: el panel se refresca
                // editando el mensaje directamente.
                await message.edit(V2.components(render())).catch(() => {})
                await submitted.followUp({
                    content: isUses
                        ? `✅ +${tools.commafy(parsed.value)} usos a \`${code}\`.`
                        : `✅ +${tools.commafy(parsed.value)} h a \`${code}\`.`,
                }).catch(() => {})
            } catch {
                try { await submitted.followUp({ content: "No se pudo actualizar. Reabre /drops mostrar." }) } catch {}
            }
        }
        // Botón "Privatizar": pega IDs o menciones y añade los reservados.
        const openReserveModal = async (buttonInt, code) => {
            const modalId = `dropw:solo:${code}`
            try {
                await buttonInt.showModal(buildReserveModal(code))
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
            try { raw = submitted.fields.getTextInputValue("value") } catch { raw = "" }
            const ids = parseAllowedInput(raw)
            if (!ids.length) {
                return submitted.reply({ content: "Pega al menos una mención <@usuario> o un ID válido.", ephemeral: true }).catch(() => {})
            }
            try {
                const picks = []
                for (const uid of ids) {
                    const member = await int.guild?.members?.fetch?.(uid).catch(() => null)
                    picks.push({ id: uid, name: member?.displayName || `usuario ${uid}` })
                }
                const res = await applyReserve(client, guildId, code, picks)
                if (!res.ok) throw new Error("missing")
                currentRows = await fetchRows()
                selected = code
                await message.edit(V2.components(render())).catch(() => {})
                await submitted.followUp({
                    content: `🔒 \`${code}\` privado: ${tools.commafy(res.total)} en total (usos: ${tools.commafy(res.bump)}).`,
                }).catch(() => {})
            } catch {
                try { await submitted.followUp({ content: "No se pudo actualizar. Reabre /drops mostrar.", ephemeral: true }) } catch {}
            }
        }
        const collector = message.createMessageComponentCollector({ time: 24 * 60 * 60 * 1000 })
        collector.on("collect", async interaction => {
            if (!interaction.isStringSelectMenu() && !interaction.isButton()) return
            if (interaction.user.id !== authorId) {
                return tools.denyButton(interaction, "drops")
            }
            // Los botones con modal se abren sin defer (showModal ya reconoce).
            if (interaction.isButton()) {
                const [prefix, action, code] = String(interaction.customId || "").split(":")
                if (prefix === BTN_PREFIX && (action === BTN_USES || action === BTN_TIME)) {
                    await openAmountModal(interaction, action, code)
                    return
                }
                if (prefix === BTN_PREFIX && action === BTN_SOLO) {
                    await openReserveModal(interaction, code)
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
                } else if (interaction.isStringSelectMenu() && id.startsWith(QUIT_PREFIX)) {
                    const code = id.slice(QUIT_PREFIX.length)
                    const uid = interaction.values?.[0]
                    if (uid) {
                        await applyAllowRemove(client, guildId, code, uid)
                        await refresh(interaction)
                        await interaction.followUp({ content: `✅ Quité <@${uid}> del privado de \`${code}\`.` }).catch(() => {})
                    }
                } else if (interaction.isButton()) {
                    const [prefix, action, code] = id.split(":")
                    if (prefix === BTN_PREFIX && action === BTN_DEL) {
                        await Drops.deleteDrop(client, guildId, code)
                        selected = null
                        await refresh(interaction)
                        await interaction.followUp({ content: `🗑️ Drop \`${code}\` eliminado.` }).catch(() => {})
                    } else if (prefix === BTN_PREFIX && action === BTN_OPEN) {
                        await applyOpenAll(client, guildId, code)
                        await refresh(interaction)
                        await interaction.followUp({ content: `🌍 \`${code}\` público de nuevo.` }).catch(() => {})
                    }
                }
            } catch {
                try {
                    await interaction.followUp({ content: "No se pudo actualizar. Reabre /drops mostrar." })
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
                await message.edit(V2.components(container))
            } catch {}
        })
    },

    // Permisos de /drops (solo gestores, ver run): roles en settings.dropRoles.
    async runPermiso(client, int, tools) {
        const container = new ContainerBuilder().setAccentColor(0x87f3ff)
        container.addTextDisplayComponents(textBuilder(`## 🔑 Permiso de /drops`))
        container.addSeparatorComponents(sepBuilder())
        const role = int.options.getRole("rol")
        if (role) {
            if (role.id === int.guild.id) return tools.warn("Elige un rol válido (no @everyone).")
            if (int.options.get("quitar")?.value) {
                await client.db.update(int.guild.id, { $pull: { "settings.dropRoles": { id: role.id } } }).exec()
                container.addTextDisplayComponents(textBuilder(`- 🗑️ <@&${role.id}> ya no puede usar \`/drops\`.`))
            } else {
                await client.db.update(int.guild.id, { $addToSet: { "settings.dropRoles": { id: role.id } } }).exec()
                container.addTextDisplayComponents(textBuilder(`- ✅ <@&${role.id}> ya puede usar \`/drops\` (crear, ver, eliminar).`))
            }
        } else {
            const doc = await client.db.fetch(int.guild.id, ["settings.dropRoles"]).exec().catch(() => null)
            const roles = Array.isArray(doc?.settings?.dropRoles) ? doc.settings.dropRoles : []
            if (!roles.length) {
                container.addTextDisplayComponents(textBuilder([
                    `- Nadie extra puede usar \`/drops\`: solo quienes gestionan el servidor.`,
                    `-# Añade uno con \`/drops permiso rol:@Staff\`.`,
                ].join("\n")))
            } else {
                container.addTextDisplayComponents(textBuilder([
                    `- Quien gestione el servidor siempre puede. Además:`,
                    roles.map(r => `- <@&${r.id}>`).join("\n"),
                ].join("\n")))
            }
        }
        return say(int, container)
    },

    // Autocompletado: sugiere items de la tienda por nombre (el valor es el
    // ID). Sin economía o sin items, lista vacía.
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
module.exports.describePrizes = describePrizes
module.exports.MENU_ID = MENU_ID
module.exports.BACK_VALUE = BACK_VALUE
module.exports.BTN_DEL = BTN_DEL
module.exports.BTN_USES = BTN_USES
module.exports.BTN_TIME = BTN_TIME
module.exports.BTN_SOLO = BTN_SOLO
module.exports.BTN_OPEN = BTN_OPEN
module.exports.QUIT_PREFIX = QUIT_PREFIX
module.exports.BTN_PREFIX = BTN_PREFIX
module.exports.MODAL_PREFIX = MODAL_PREFIX
module.exports.USES_BOUNDS = USES_BOUNDS
module.exports.HOURS_BOUNDS = HOURS_BOUNDS
module.exports.parseModalAmount = parseModalAmount
module.exports.buildUsesModal = buildUsesModal
module.exports.buildTimeModal = buildTimeModal
module.exports.MAX_MENU_OPTIONS = MAX_MENU_OPTIONS
module.exports.MK = MK
module.exports.makeDraft = makeDraft
module.exports.draftPrizes = draftPrizes
module.exports.draftAddItem = draftAddItem
module.exports.draftRemoveItem = draftRemoveItem
module.exports.draftAddAllow = draftAddAllow
module.exports.draftRemoveAllow = draftRemoveAllow
module.exports.durationLabel = durationLabel
module.exports.describeAllow = describeAllow
module.exports.prizeSummary = prizeSummary
module.exports.buildMakeContainer = buildMakeContainer
module.exports.buildPickContainer = buildPickContainer
module.exports.buildConfirmContainer = buildConfirmContainer
module.exports.buildCancelledContainer = buildCancelledContainer
module.exports.buildCreatedContainer = buildCreatedContainer
module.exports.buildMakeNameModal = buildMakeNameModal
module.exports.buildMakeUsesModal = buildMakeUsesModal
module.exports.buildMakeDurModal = buildMakeDurModal
module.exports.buildMakeXpModal = buildMakeXpModal
module.exports.buildMakeCoinsModal = buildMakeCoinsModal
module.exports.buildMakeQtyModal = buildMakeQtyModal
module.exports.parseAllowedInput = parseAllowedInput
module.exports.applyReserve = applyReserve
module.exports.applyOpenAll = applyOpenAll
module.exports.applyAllowRemove = applyAllowRemove
module.exports.buildReserveModal = buildReserveModal
