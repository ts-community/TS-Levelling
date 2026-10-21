const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, ModalBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } = require("discord.js")
const Drops = require("../../classes/Drops.js")

const ACCENT = 0x87f3ff
// Emoji de XP del servidor (igual que /rank y /records).
const XP_EMOJI = "<:XP:1467192533812645939>"

// Miles con punto siempre (igual que commafy en las respuestas).
const fmtInt = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")

const sepBuilder = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
const textBuilder = content => new TextDisplayBuilder().setContent(content)

// Fecha relativa corta ("dentro de 3 horas").
const shortDate = ts => `<t:${Math.floor(Number(ts) / 1000)}:R>`

// ─── Bloques de texto compartidos (crear / creado / detalle) ────────────────

// "🔒 Reservado · @a @b" o "🌍 Público".
function accessLine(allow) {
    const people = Array.isArray(allow) ? allow.filter(Boolean) : []
    if (!people.length) return "🌍 **Acceso:** Público"
    const shown = people.slice(0, 10).map(u => `<@${u.id}>`).join(" ")
    return `🔒 **Acceso:** Reservado · ${shown}${people.length > 10 ? ` +${people.length - 10} más` : ""}`
}

// Líneas de premios: una por recompensa, o la nota vacía.
function prizeLines(prizes, tools) {
    const lines = []
    if (prizes.xp > 0) lines.push(`- ${XP_EMOJI} **${tools.commafy(prizes.xp)}** XP`)
    if (prizes.coins > 0) lines.push(`- 🪙 **${tools.commafy(prizes.coins)}** monedas`)
    for (const r of prizes.roles || []) lines.push(`- 🎭 <@&${r.id}>`)
    for (const it of prizes.items || []) lines.push(`- 📦 **${tools.commafy(it.qty)}×** ${it.name || "objeto"}`)
    return lines.length ? lines.join("\n") : "-# *Sin recompensas por ahora.*"
}

// Premios de un drop guardado (los antiguos no-pack se muestran en una línea).
function dropPrizeLines(drop, tools) {
    if (drop.kind === "bundle") return prizeLines(Drops.normalizePrizes(drop.prizes), tools)
    return `- ${dropPrizeText(drop, tools)}`
}

// "XP + 🪙 monedas + ..." en una línea (para la lista).
function describePrizes(prizes, tools, maxParts = Infinity) {
    const parts = []
    if (prizes.xp > 0) parts.push(`${XP_EMOJI} ${tools.commafy(prizes.xp)} XP`)
    if (prizes.coins > 0) parts.push(`🪙 ${tools.commafy(prizes.coins)} monedas`)
    for (const r of prizes.roles) parts.push(`🎭 <@&${r.id}>`)
    for (const it of prizes.items) parts.push(`📦 ${tools.commafy(it.qty)}× ${it.name || "objeto"}`)
    if (parts.length > maxParts) parts.splice(maxParts, parts.length - maxParts, `+${parts.length - maxParts} más`)
    return parts.join(" + ")
}

function dropPrizeText(drop, tools, maxParts = Infinity) {
    if (drop.kind === "bundle") return describePrizes(Drops.normalizePrizes(drop.prizes), tools, maxParts)
    if (drop.kind === "role") return `🎭 rol ${drop.roleName || `<@&${drop.roleId}>`}`
    if (drop.kind === "item") return `📦 ${tools.commafy(drop.amount)}× ${drop.itemName || "objeto"}`
    return `${Drops.kindEmoji(drop.kind)} ${tools.commafy(drop.amount)} ${Drops.kindName(drop.kind)}`
}

// Añade "**🎁 Premios** / sep / lista / sep" al contenedor.
function addPrizesBlock(container, linesText) {
    container.addTextDisplayComponents(textBuilder("**🎁 Premios**"))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder(linesText))
    container.addSeparatorComponents(sepBuilder())
}

// ─── /drops mostrar y /drops eliminar ───────────────────────────────────────

const MENU_ID = "dropinspect"
const BACK_VALUE = "__back"
// Botones del detalle: "drop:<accion>:<CODE>". Los de cantidad/tiempo abren
// un modal ("dropm:<accion>:<CODE>"). "Reservar" abre un modal largo para
// pegar IDs/menciones; "Abrir a todos" y "Quitar" solo salen con reservas.
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

// Línea de un drop en la lista: `CODE` (reclamados/total) - premio.
// Tachado si se agotó; candado si es reservado.
function dropListLine(row, base, guildId, tools) {
    const { code, drop, left } = row
    const claimed = Math.max(0, Number(drop.maxClaims) - left)
    const url = `${base}${Drops.dropPath(guildId, code)}`
    const head = left <= 0 ? `~~[\`${code}\`](${url})~~` : `[\`${code}\`](${url})`
    const lock = drop.allow?.length ? " 🔒" : ""
    return `${head}${lock} - ${tools.commafy(claimed)}/${tools.commafy(drop.maxClaims)} - ${dropPrizeText(drop, tools, 2)}`
}

// Menú de drops. Con una vista abierta, la primera opción es "Volver atrás".
function buildInspectMenu(rows, selectedCode) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(MENU_ID)
        .setPlaceholder("Elige un drop para verlo en detalle")
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

// Lista de /drops mostrar: una línea por drop y el menú debajo.
function buildDropsListContainer(rows, base, guildId, tools) {
    const container = new ContainerBuilder().setAccentColor(ACCENT)
    container.addTextDisplayComponents(textBuilder("## 🎁 Drops del servidor"))
    container.addSeparatorComponents(sepBuilder())
    if (!rows.length) {
        container.addTextDisplayComponents(textBuilder("-# *No hay ningún drop activo. Crea uno con `/drops crear`.*"))
        return container
    }
    container.addTextDisplayComponents(textBuilder(
        rows.slice(0, MAX_MENU_OPTIONS).map(row => `- ${dropListLine(row, base, guildId, tools)}`).join("\n")
        + (rows.length > MAX_MENU_OPTIONS ? `\n-# +${rows.length - MAX_MENU_OPTIONS} más` : ""),
    ))
    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildInspectMenu(rows, null)))
    return container
}

// Detalle de un drop: misma estructura que el asistente, con botones de gestión.
function buildDropDetailContainer(rows, row, base, guildId, tools) {
    const { code, drop, left } = row
    const claimed = Math.max(0, Number(drop.maxClaims) - left)
    const url = `${base}${Drops.dropPath(guildId, code)}`
    const allowed = Array.isArray(drop?.allow) ? drop.allow : []
    const container = new ContainerBuilder().setAccentColor(ACCENT)
    container.addTextDisplayComponents(textBuilder(`## 🎁 ${drop.name || "Drop"} \`${code}\``))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder([
        `👥 **Usos:** ${tools.commafy(claimed)}/${tools.commafy(drop.maxClaims)}`,
        `📅 **Caduca:** ${shortDate(drop.expiresAt)}`,
        accessLine(allowed),
    ].join("\n")))
    container.addSeparatorComponents(sepBuilder())
    addPrizesBlock(container, dropPrizeLines(drop, tools))
    container.addTextDisplayComponents(textBuilder(`🔗 **Enlace:** ${url}`))
    container.addSeparatorComponents(sepBuilder())

    const buttons = [
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_DEL}:${code}`).setLabel("Eliminar").setStyle(ButtonStyle.Danger).setEmoji("🗑️"),
        // Con reservas los usos son siempre el nº de reservados.
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_USES}:${code}`).setLabel("Usos").setStyle(ButtonStyle.Secondary).setEmoji("➕").setDisabled(allowed.length > 0),
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_TIME}:${code}`).setLabel("Tiempo").setStyle(ButtonStyle.Secondary).setEmoji("⏳"),
        new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_SOLO}:${code}`).setLabel("Reservar").setStyle(ButtonStyle.Secondary).setEmoji("🔒"),
    ]
    if (allowed.length) {
        buttons.push(new ButtonBuilder().setCustomId(`${BTN_PREFIX}:${BTN_OPEN}:${code}`).setLabel("Abrir a todos").setStyle(ButtonStyle.Success).setEmoji("🌍"))
    }
    container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons))
    if (allowed.length) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`${QUIT_PREFIX}${code}`)
                .setPlaceholder("Quitar a un reservado")
                .addOptions(allowed.slice(0, MAX_MENU_OPTIONS).map(u =>
                    new StringSelectMenuOptionBuilder()
                        .setValue(String(u.id))
                        .setLabel(String(u.name || `usuario ${u.id}`).slice(0, 100)),
                )),
        ))
    }
    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildInspectMenu(rows, code)))
    return container
}

// Todas las respuestas van en Componentes V2 y visibles.
const V2 = { components: c => ({ components: [c], flags: [MessageFlags.IsComponentsV2], allowedMentions: { parse: [] } }) }
const say = (int, container) => int.editReply(V2.components(container))

// ─── Asistente /drops crear ─────────────────────────────────────────────────
// Un único mensaje con dos vistas: el panel principal y el selector de un
// premio (se cambia con update() sobre el mismo mensaje: más rápido que un
// panel efímero aparte). Nada toca la BD hasta pulsar "Crear".
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

// Borrador del asistente. Por defecto: 3 usos y 24 h de caducidad.
function makeDraft(name, { maxClaims = 3, durationMin = 1440 } = {}) {
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

// Reservas: con reservados, los usos son SIEMPRE el nº de reservados.
function syncUses(d) {
    if (d.allow.length) d.maxClaims = Math.min(Drops.LIMITS.usesMax, d.allow.length)
}

// Sustituye la lista de reservados (el menú de usuarios muestra la selección
// actual, así que elegir/quitar ahí equivale a reemplazar). Vacío = público.
function draftSetAllow(d, picks) {
    d.allow = Drops.normalizeAllowedUsers(Array.isArray(picks) ? picks : [])
    syncUses(d)
    return d.allow
}

// Fusiona (se conserva por compatibilidad).
function draftAddAllow(d, picks) {
    d.allow = Drops.normalizeAllowedUsers([...(d.allow || []), ...(Array.isArray(picks) ? picks : [])])
    syncUses(d)
    return d.allow
}

function draftRemoveAllow(d, id) {
    d.allow = d.allow.filter(u => String(u?.id) !== String(id))
    syncUses(d)
}

// Duración: etiqueta del preset si existe; si no, horas y minutos.
function durationLabel(min) {
    const m = Math.round(Number(min) || 0)
    const hit = Drops.DURATION_PRESETS.find(p => p.minutes === m)
    if (hit) return hit.label
    if (m >= 60) {
        const hh = Math.floor(m / 60), mm = m % 60
        return mm ? `${fmtInt(hh)} h ${fmtInt(mm)} min` : `${fmtInt(hh)} ${hh === 1 ? "hora" : "horas"}`
    }
    return `${fmtInt(m)} minutos`
}

// Compatibilidad con los tests: texto de acceso del borrador.
function describeAllow(allow) {
    return accessLine(allow)
}

const presetOption = (label, value, description) =>
    new StringSelectMenuOptionBuilder().setLabel(String(label).slice(0, 100)).setValue(String(value)).setDescription(String(description).slice(0, 100))

// "🆙 10.000 XP + 📦 3× X" para los textos cortos.
function prizeSummary(d, tools) {
    const parts = []
    if (d.xp > 0) parts.push(`🆙 ${tools.commafy(d.xp)} XP`)
    if (d.coins > 0) parts.push(`🪙 ${tools.commafy(d.coins)} monedas`)
    for (const it of d.items) parts.push(`📦 ${tools.commafy(it.qty)}× ${it.name}`)
    return parts.join(" + ")
}

// Panel principal:
// título / sep / usos+caducidad+acceso / sep / Premios / sep / lista / sep /
// menú de premios + menú de usuarios / sep / nombre-usos-caducidad / sep / crear-cancelar
function buildMakeContainer(draft, { tools = { commafy: fmtInt }, boat = false } = {}) {
    const container = new ContainerBuilder().setAccentColor(ACCENT)
    const reserved = draft.allow.length > 0

    container.addTextDisplayComponents(textBuilder(`## 📋 Crear drop: ${draft.name}`))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder([
        `👥 **Usos:** ${tools.commafy(draft.maxClaims)}${reserved ? " *(= reservados)*" : ""}`,
        `📅 **Caducidad:** ${durationLabel(draft.durationMin)}`,
        accessLine(draft.allow),
    ].join("\n")))
    container.addSeparatorComponents(sepBuilder())
    addPrizesBlock(container, prizeLines(draftPrizes(draft), tools))

    const rewardOptions = [
        presetOption("🆙 XP", "xp", "Elegir o cambiar la XP"),
        boat && presetOption("🪙 Monedas", "coins", "Elegir o cambiar las monedas"),
        boat && presetOption("📦 Objeto", "item", "Añadir o quitar objetos de la tienda"),
    ].filter(Boolean)
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(MK.MENU)
            .setPlaceholder("➕ Añadir premio")
            .addOptions(...rewardOptions),
    ))

    const users = new UserSelectMenuBuilder()
        .setCustomId(MK.USERS)
        .setPlaceholder("🌍 Público · elige usuarios para reservarlo 🔒")
        .setMinValues(0)
        .setMaxValues(25)
    if (reserved) users.setDefaultUsers(draft.allow.slice(0, 25).map(u => String(u.id)))
    container.addActionRowComponents(new ActionRowBuilder().addComponents(users))

    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(MK.NAME).setLabel("Nombre").setStyle(ButtonStyle.Secondary).setEmoji("🏷️"),
        new ButtonBuilder().setCustomId(MK.USES).setLabel("Usos").setStyle(ButtonStyle.Secondary).setEmoji("👥").setDisabled(reserved),
        new ButtonBuilder().setCustomId(MK.DUR).setLabel("Caducidad").setStyle(ButtonStyle.Secondary).setEmoji("📅"),
    ))
    container.addSeparatorComponents(sepBuilder())
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(MK.CREATE).setLabel("Crear").setStyle(ButtonStyle.Success).setEmoji("✅")
            .setDisabled(!(draft.xp > 0 || draft.coins > 0 || draft.items.length > 0)),
        new ButtonBuilder().setCustomId(MK.CANCEL).setLabel("Cancelar").setStyle(ButtonStyle.Danger).setEmoji("✖️"),
    ))
    return container
}

// Vista de selección de un premio (sustituye al panel principal hasta volver).
function buildPickContainer(kind, { tools = { commafy: fmtInt }, storeItems = null, draft = null } = {}) {
    const container = new ContainerBuilder().setAccentColor(ACCENT)
    const titles = { xp: "🆙 XP", coins: "🪙 Monedas", item: "📦 Objetos" }
    container.addTextDisplayComponents(textBuilder(`## ${titles[kind] || "Premio"}`))
    container.addSeparatorComponents(sepBuilder())

    if (kind === "xp" || kind === "coins") {
        const actual = kind === "xp" ? draft?.xp : draft?.coins
        container.addTextDisplayComponents(textBuilder(actual > 0
            ? `**Actual:** ${tools.commafy(actual)} ${kind === "xp" ? "XP" : "monedas"}`
            : "-# *Sin configurar.*"))
        const presets = kind === "xp" ? Drops.AMOUNT_PRESETS : Drops.COIN_PRESETS
        const menu = new StringSelectMenuBuilder()
            .setCustomId(kind === "xp" ? MK.XP : MK.COINS)
            .setPlaceholder("Elige una cantidad")
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
    } else if (kind === "item") {
        container.addTextDisplayComponents(textBuilder(draft?.items?.length
            ? draft.items.map(it => `- 📦 **${tools.commafy(it.qty)}×** ${it.name}`).join("\n")
            : "-# *Sin objetos todavía.*"))
        if (draft?.items?.length) {
            container.addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(MK.RITEM)
                    .setPlaceholder("Quitar un objeto")
                    .addOptions(draft.items.map(it => presetOption(`${it.qty}× ${it.name}`, it.id, "Quitar del premio"))),
            ))
        }
        const menu = new StringSelectMenuBuilder()
            .setCustomId(MK.ITEM)
            .setPlaceholder("Añadir un objeto de la tienda")
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
        new ButtonBuilder().setCustomId(MK.DONE).setLabel("Volver").setStyle(ButtonStyle.Secondary).setEmoji("⬅️"),
    ))
    return container
}

// Pantalla de cancelado.
function buildCancelledContainer() {
    return new ContainerBuilder().setAccentColor(ACCENT)
        .addTextDisplayComponents(textBuilder("## ✖️ Cancelado"))
        .addTextDisplayComponents(textBuilder("-# *No se ha creado ningún drop.*"))
}

// Drop creado: misma estructura que el asistente (sin menús ni botones) y,
// al final, el enlace.
function buildCreatedContainer(drop, code, url, tools = { commafy: fmtInt }, allow = null) {
    const people = Array.isArray(allow) && allow.length ? allow : (Array.isArray(drop?.allow) ? drop.allow : [])
    const container = new ContainerBuilder().setAccentColor(ACCENT)
    container.addTextDisplayComponents(textBuilder(`## ✅ Drop creado: ${drop.name || "Drop"}`))
    container.addSeparatorComponents(sepBuilder())
    container.addTextDisplayComponents(textBuilder([
        `👥 **Usos:** ${tools.commafy(drop.maxClaims)}`,
        `📅 **Caduca:** ${shortDate(drop.expiresAt)}`,
        accessLine(people),
    ].join("\n")))
    container.addSeparatorComponents(sepBuilder())
    const prizes = Drops.normalizePrizes(drop.prizes || { xp: drop.xp, coins: drop.coins, roles: [], items: drop.items || [] })
    addPrizesBlock(container, prizeLines(prizes, tools))
    container.addTextDisplayComponents(textBuilder(`🔗 **Enlace:** ${url}`))
    return container
}

// Modales del asistente. Todos usan el campo "value".
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
        .setTitle("XP del premio")
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput(prefill, { label: "Cuánta XP por persona", placeholder: "Ej: 5000", max: 7 })))
}

function buildMakeCoinsModal(prefill = "") {
    return new ModalBuilder()
        .setCustomId("dropw:coins")
        .setTitle("Monedas del premio")
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput(prefill, { label: "Cuántas monedas por persona", placeholder: "Ej: 10000", max: 10 })))
}

function buildMakeQtyModal(item) {
    return new ModalBuilder()
        .setCustomId(`dropw:qty:${item.id}`)
        .setTitle(`Unidades: ${item.name}`.slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(
            makeTextInput("", { label: "Unidades por persona", placeholder: "1", max: 3 })))
}

// Modal de /drops mostrar: pegar IDs o menciones para reservar.
function buildReserveModal(code) {
    return new ModalBuilder()
        .setCustomId(`dropw:solo:${code}`)
        .setTitle(`Reservar ${code}`)
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("value")
                .setLabel("IDs o menciones de usuarios")
                .setPlaceholder("<@123…>, 123… (varios, uno tras otro)")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(2000)))
}

// Extrae menciones <@…> e IDs crudos (17-20 dígitos), sin duplicados.
function parseAllowedInput(input) {
    const text = Array.isArray(input) ? input.join(" ") : String(input || "")
    const found = []
    const seen = new Set()
    const push = id => { if (/^\d{17,20}$/.test(id) && !seen.has(id)) { seen.add(id); found.push(id) } }
    for (const m of text.matchAll(/<@(\d{17,20})>/g)) push(m[1])
    for (const m of text.replace(/<@\d{17,20}>/g, " ").matchAll(/\b\d{17,20}\b/g)) push(m[0])
    return found.slice(0, Drops.LIMITS.allowedMax)
}

// Reclamos de gente que NO está en la lista de reservados (ocupan usos).
const foreignClaims = (drop, allow) =>
    (drop.claims || []).filter(c => !allow.some(u => String(u.id) === String(c))).length

// Añade reservados. Los usos pasan a ser: nº de reservados + reclamos ajenos ya hechos.
async function applyReserve(client, guildId, code, users) {
    const doc = await client.db.fetch(guildId, ["drops"]).exec().catch(() => null)
    const drop = doc?.drops?.[code]
    if (!drop) return { ok: false }
    const before = Array.isArray(drop.allow) ? drop.allow : []
    const clean = Drops.normalizeAllowedUsers([...before, ...(Array.isArray(users) ? users : [])])
    const bump = Math.min(Drops.LIMITS.usesMax, clean.length + foreignClaims(drop, clean))
    await client.db.update(guildId, { $set: { [`drops.${code}.allow`]: clean, [`drops.${code}.maxClaims`]: bump } }).exec()
    return { ok: true, added: clean.length - before.length, total: clean.length, bump }
}

// Quita a un reservado y reajusta los usos (si quedan reservados).
async function applyAllowRemove(client, guildId, code, userId) {
    const doc = await client.db.fetch(guildId, ["drops"]).exec().catch(() => null)
    const drop = doc?.drops?.[code]
    if (!drop) return null
    const allow = (Array.isArray(drop.allow) ? drop.allow : []).filter(u => String(u?.id) !== String(userId))
    const $set = { [`drops.${code}.allow`]: allow }
    if (allow.length) $set[`drops.${code}.maxClaims`] = Math.min(Drops.LIMITS.usesMax, allow.length + foreignClaims(drop, allow))
    await client.db.update(guildId, { $set }).exec()
    return allow
}

// Hace el drop público de nuevo (borra los reservados).
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
                { type: "string", name: "nombre", description: "Nombre del drop (por defecto: Drop #N)", required: false },
                { type: "integer", name: "usos", description: "Usos totales del drop: cada persona lo reclama una vez (por defecto: 3)", required: false, min: 1, max: 5000 },
                { type: "integer", name: "caducidad", description: "Horas hasta que el enlace caduca (por defecto: 24)", required: false, min: 1, max: 720 },
            ]},
            { type: "subcommand", name: "mostrar", description: "Ver los drops activos del servidor", args: [] },
            { type: "subcommand", name: "eliminar", description: "Eliminar un drop activo", args: [
                { type: "string", name: "drop", description: "Drop a eliminar (elige de la lista)", required: true, autocomplete: true },
            ]},
            { type: "subcommand", name: "permisos", description: "Roles que pueden usar /drops (solo gestores)", args: [
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
        // Permisos: solo gestores. El resto: gestores o roles de la DB.
        if (sub === "permisos") {
            if (!isManager) return tools.warn("*notMod")
        } else {
            const canUse = isManager || Drops.canUseDrops({ isManager: false, memberRoles: int.member?.roles?.cache, settings: db.settings })
            if (!canUse) return tools.warn("*notMod")
        }
        if (!db.settings.enabled) return tools.warn("*xpDisabled")

        // Defer inmediato: las llamadas a la BD y a UnbelievaBoat tardan.
        await int.deferReply().catch(() => {})
        if (sub === "mostrar") return module.exports.runList(client, int, tools, {})
        if (sub === "eliminar") return module.exports.runDelete(client, int, tools)
        if (sub === "permisos") return module.exports.runPermiso(client, int, tools)
        return module.exports.runCreate(client, int, tools, db)
    },

    async runCreate(client, int, tools, db) {
        const guildId = int.guild.id
        const authorId = int.user.id
        const boat = Drops.boatEnabled()

        // Contador para el nombre automático.
        let dropSeq = 0
        try {
            const doc = await client.db.fetch(guildId, ["settings.dropSeq"]).exec().catch(() => null)
            dropSeq = (Number(doc?.settings?.dropSeq) || 0) + 1
        } catch {}

        const nameRaw = String(int.options.get("nombre")?.value || "").trim()
        const over = {}
        const usesOpt = int.options.getInteger?.("usos")
        if (usesOpt) over.maxClaims = Math.max(1, Math.min(Drops.LIMITS.usesMax, Math.round(usesOpt)))
        const durOpt = int.options.getInteger?.("caducidad")
        if (durOpt) over.durationMin = Math.max(Drops.LIMITS.durationMin, Math.min(Drops.LIMITS.durationMax, Math.round(durOpt * 60)))
        const draft = makeDraft(nameRaw || `Drop #${dropSeq}`, over)

        // La tienda de UnbelievaBoat se precarga en segundo plano (sin esperar):
        // cuando se abre "Objeto" casi siempre ya está lista.
        let storeItems = null, storeError = false, storeReady = !boat
        const storePromise = boat
            ? Drops.fetchBoatStore(guildId).then(s => { storeItems = s }).catch(() => { storeError = true }).finally(() => { storeReady = true })
            : Promise.resolve()

        const toolsLite = { commafy: (...a) => tools.commafy(...a) }
        let view = "main"
        const render = () => view === "main"
            ? buildMakeContainer(draft, { tools: toolsLite, boat })
            : buildPickContainer(view, { tools: toolsLite, storeItems, draft })

        // Modal + espera del envío. showModal ya reconoce la interacción.
        const askModal = async (i, modalId, modal) => {
            try { await i.showModal(modal) } catch { return null }
            try { return await i.awaitModalSubmit({ filter: s => s.customId === modalId && s.user.id === authorId, time: 120000 }) }
            catch { return null }
        }
        const errorReply = (sub, content) => sub.reply({ content, ephemeral: true }).catch(() => {})

        const sent = await int.editReply(V2.components(render())).catch(() => null)
        if (!sent) return
        const collector = sent.createMessageComponentCollector?.({ time: 24 * 60 * 60 * 1000 })
        if (!collector) return

        let busy = false

        collector.on("collect", async i => {
            if (i.user.id !== authorId) return tools.denyButton(i, "drops")
            const id = i.customId

            // ── Menú "Añadir premio": cambia a la vista del premio ──
            if (i.isStringSelectMenu() && id === MK.MENU) {
                const val = i.values?.[0]
                if (val !== "xp" && val !== "coins" && val !== "item") return
                if (val === "coins" && !boat) return
                if (val === "item") {
                    if (!storeReady) {
                        await i.deferUpdate().catch(() => {})
                        await storePromise
                        if (!storeItems?.length) {
                            return i.followUp({ content: storeError ? "No pude leer la tienda de UnbelievaBoat." : "La tienda está vacía.", ephemeral: true }).catch(() => {})
                        }
                        view = "item"
                        return i.editReply(V2.components(render())).catch(() => {})
                    }
                    if (!storeItems?.length) {
                        return errorReply(i, storeError ? "No pude leer la tienda de UnbelievaBoat." : "La tienda está vacía.")
                    }
                }
                view = val
                return i.update(V2.components(render())).catch(() => {})
            }

            // ── Volver desde la vista de un premio ──
            if (i.isButton() && id === MK.DONE) {
                view = "main"
                return i.update(V2.components(render())).catch(() => {})
            }

            // ── XP / monedas: preset, personalizada o quitar ──
            if (i.isStringSelectMenu() && (id === MK.XP || id === MK.COINS)) {
                const isXp = id === MK.XP
                const key = isXp ? "xp" : "coins"
                const v = i.values?.[0]
                if (v === "custom") {
                    const sub = await askModal(i, isXp ? "dropw:xp" : "dropw:coins", isXp ? buildMakeXpModal(draft.xp || "") : buildMakeCoinsModal(draft.coins || ""))
                    if (!sub) return
                    const n = Math.round(Number(sub.fields.getTextInputValue("value")) || 0)
                    const [min, max] = isXp ? [Drops.LIMITS.amountMin, Drops.LIMITS.amountMax] : [Drops.LIMITS.coinMin, Drops.LIMITS.coinMax]
                    if (n < min || n > max) {
                        return errorReply(sub, `Pon un número entre ${fmtInt(min)} y ${fmtInt(max)}.`)
                    }
                    draft[key] = n
                    view = "main"
                    return sub.update(V2.components(render())).catch(() => {})
                }
                draft[key] = v === "none" ? 0 : Math.round(Number(v) || 0)
                view = "main"
                return i.update(V2.components(render())).catch(() => {})
            }

            // ── Objetos: añadir (con modal de unidades) ──
            if (i.isStringSelectMenu() && id === MK.ITEM) {
                const item = (storeItems || []).find(it => it.id === i.values?.[0])
                if (!item) return
                if (draft.items.length >= 3 && !draft.items.some(it => it.id === item.id)) {
                    return errorReply(i, "Máximo 3 objetos distintos.")
                }
                const sub = await askModal(i, `dropw:qty:${item.id}`, buildMakeQtyModal(item))
                if (!sub) return
                const n = Math.round(Number(sub.fields.getTextInputValue("value")) || 0)
                if (n < 1 || n > Drops.LIMITS.qtyMax) {
                    return errorReply(sub, `Pon un número entre 1 y ${Drops.LIMITS.qtyMax}.`)
                }
                draftAddItem(draft, item, n)
                view = "main"
                return sub.update(V2.components(render())).catch(() => {})
            }

            // ── Objetos: quitar (se queda en la vista para quitar más) ──
            if (i.isStringSelectMenu() && id === MK.RITEM) {
                draftRemoveItem(draft, i.values?.[0])
                return i.update(V2.components(render())).catch(() => {})
            }

            // ── Usuarios: la selección completa define los reservados ──
            if (i.isUserSelectMenu() && id === MK.USERS) {
                const picks = i.values.slice(0, 25).map(uid => ({
                    id: uid,
                    name: i.members?.get(uid)?.displayName || i.users?.get(uid)?.username || `usuario ${uid}`,
                }))
                draftSetAllow(draft, picks)
                return i.update(V2.components(render())).catch(() => {})
            }

            // ── Nombre / usos / caducidad ──
            if (i.isButton() && id === MK.NAME) {
                const sub = await askModal(i, "dropw:name", buildMakeNameModal(draft.name))
                if (!sub) return
                const v = String(sub.fields.getTextInputValue("value") || "").trim().slice(0, 40)
                if (v) draft.name = v
                return sub.update(V2.components(render())).catch(() => {})
            }
            if (i.isButton() && id === MK.USES) {
                if (draft.allow.length) return errorReply(i, "Con reservados, los usos son el número de reservados.")
                const sub = await askModal(i, "dropw:uses", buildMakeUsesModal(String(draft.maxClaims)))
                if (!sub) return
                draft.maxClaims = Math.max(1, Math.min(Drops.LIMITS.usesMax, Math.round(Number(sub.fields.getTextInputValue("value")) || 0)))
                return sub.update(V2.components(render())).catch(() => {})
            }
            if (i.isButton() && id === MK.DUR) {
                const sub = await askModal(i, "dropw:dur", buildMakeDurModal(String(draft.durationMin)))
                if (!sub) return
                draft.durationMin = Math.max(Drops.LIMITS.durationMin, Math.min(Drops.LIMITS.durationMax, Math.round(Number(sub.fields.getTextInputValue("value")) || 1440)))
                return sub.update(V2.components(render())).catch(() => {})
            }

            // ── Crear / Cancelar ──
            if (i.isButton() && id === MK.CREATE) {
                const prizes = draftPrizes(draft)
                if (Drops.prizesCount(prizes) === 0) {
                    return errorReply(i, "Añade al menos una recompensa antes de crear.")
                }
                if (busy) return
                busy = true
                try {
                    await i.deferUpdate()
                    syncUses(draft)
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
                        client.db.update(guildId, { $set: { "settings.dropSeq": dropSeq } }).exec().catch(() => {})
                    }
                    const url = Drops.dropUrl(guildId, code, tools.WEBSITE)
                    collector.stop("created")
                    await i.editReply(V2.components(buildCreatedContainer(res.drop, code, url, tools, draft.allow)))
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
                await sent.edit(V2.components(new ContainerBuilder().setAccentColor(ACCENT)
                    .addTextDisplayComponents(textBuilder("## ⏱️ Tiempo agotado"))
                    .addTextDisplayComponents(textBuilder("-# *Reabre `/drops crear` cuando quieras.*"))))
            } catch {}
        })
    },

    // ─── /drops eliminar drop:<código> ───
    // El autocompletado lista los drops activos; al enviar, se borra directo.
    async runDelete(client, int, tools) {
        const guildId = int.guild.id
        const typed = String(int.options.getString("drop") || "").trim()
        const doc = await client.db.fetch(guildId, ["drops"]).exec().catch(() => null)
        const drops = doc?.drops || {}
        const keys = Object.keys(drops)
        const code = keys.find(k => k === typed) || keys.find(k => k.toLowerCase() === typed.toLowerCase())
        const container = new ContainerBuilder().setAccentColor(ACCENT)
        if (!code) {
            container.addTextDisplayComponents(textBuilder("## 🗑️ Eliminar drop"))
            container.addSeparatorComponents(sepBuilder())
            container.addTextDisplayComponents(textBuilder(`No existe ningún drop con el código \`${typed.slice(0, 20)}\`.\n-# *Elígelo de la lista al escribir el comando.*`))
            return say(int, container)
        }
        const drop = drops[code]
        try {
            await Drops.deleteDrop(client, guildId, code)
        } catch (e) {
            console.error("[drops:eliminar]", e?.message)
            return tools.warn("No se pudo eliminar el drop. Inténtalo de nuevo.")
        }
        const claimed = Array.isArray(drop.claims) ? drop.claims.length : 0
        container.addTextDisplayComponents(textBuilder(`## 🗑️ Drop eliminado: ${drop.name || "Drop"} \`${code}\``))
        container.addSeparatorComponents(sepBuilder())
        container.addTextDisplayComponents(textBuilder([
            `👥 **Usos:** ${tools.commafy(claimed)}/${tools.commafy(drop.maxClaims)}`,
            accessLine(Array.isArray(drop.allow) ? drop.allow : []),
        ].join("\n")))
        container.addSeparatorComponents(sepBuilder())
        addPrizesBlock(container, dropPrizeLines(drop, tools))
        container.addTextDisplayComponents(textBuilder("-# *El enlace ya no funciona.*"))
        return say(int, container)
    },

    // ─── /drops mostrar ───
    async runList(client, int, tools) {
        const base = Drops.dropsBaseUrl(tools.WEBSITE)
        const guildId = int.guild.id
        const authorId = int.user.id

        const fetchRows = async () => {
            const doc = await client.db.fetch(guildId, ["drops"]).exec().catch(() => null)
            // Solo los no expirados; los agotados salen tachados.
            return Drops.listDrops(doc).filter(r => !r.expired)
        }
        let currentRows = await fetchRows()
        let selected = null
        const render = () => {
            const fresh = selected ? currentRows.find(r => r.code === selected) : null
            if (selected && !fresh) selected = null
            return fresh
                ? buildDropDetailContainer(currentRows, fresh, base, guildId, tools)
                : buildDropsListContainer(currentRows, base, guildId, tools)
        }

        await say(int, render())
        const message = await int.fetchReply().catch(() => null)
        if (!message) return

        let busy = false
        const refresh = async editor => {
            currentRows = await fetchRows()
            await editor.editReply(V2.components(render()))
        }

        // Usos / tiempo: modal con el número exacto; luego se refresca el panel.
        const openAmountModal = async (buttonInt, action, code) => {
            const isUses = action === BTN_USES
            const modalId = `${MODAL_PREFIX}:${action}:${code}`
            try {
                await buttonInt.showModal(isUses ? buildUsesModal(code) : buildTimeModal(code))
            } catch { return }
            let submitted = null
            try {
                submitted = await buttonInt.awaitModalSubmit({ filter: i => i.customId === modalId && i.user.id === authorId, time: 120000 })
            } catch { submitted = null }
            if (!submitted) return
            let raw = ""
            try { raw = submitted.fields.getTextInputValue("amount") } catch { raw = "" }
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
                    return submitted.followUp({ content: "Ese drop ya no existe. Reabre /drops mostrar.", ephemeral: true }).catch(() => {})
                }
                if (isUses) {
                    if (drop.allow?.length) {
                        return submitted.followUp({ content: "Con reservados, los usos son el número de reservados.", ephemeral: true }).catch(() => {})
                    }
                    const total = Number(drop.maxClaims) + parsed.value
                    if (total > Drops.LIMITS.usesMax) {
                        return submitted.followUp({ content: `Se pasaría del máximo (${tools.commafy(Drops.LIMITS.usesMax)} usos).`, ephemeral: true }).catch(() => {})
                    }
                    await client.db.update(guildId, { $set: { [`drops.${code}.maxClaims`]: total } }).exec()
                } else {
                    await client.db.update(guildId, { $set: { [`drops.${code}.expiresAt`]: Number(drop.expiresAt) + parsed.value * 3600 * 1000 } }).exec()
                }
                selected = code
                await refresh(submitted)
            } catch {
                try { await submitted.followUp({ content: "No se pudo actualizar. Reabre /drops mostrar.", ephemeral: true }) } catch {}
            }
        }

        // Reservar: pegar IDs o menciones.
        const openReserveModal = async (buttonInt, code) => {
            const modalId = `dropw:solo:${code}`
            try {
                await buttonInt.showModal(buildReserveModal(code))
            } catch { return }
            let submitted = null
            try {
                submitted = await buttonInt.awaitModalSubmit({ filter: i => i.customId === modalId && i.user.id === authorId, time: 120000 })
            } catch { submitted = null }
            if (!submitted) return
            let raw = ""
            try { raw = submitted.fields.getTextInputValue("value") } catch { raw = "" }
            const ids = parseAllowedInput(raw)
            if (!ids.length) {
                return submitted.reply({ content: "Pega al menos una mención <@usuario> o un ID válido.", ephemeral: true }).catch(() => {})
            }
            try {
                await submitted.deferUpdate()
                const picks = await Promise.all(ids.map(async uid => {
                    const member = await int.guild?.members?.fetch?.(uid).catch(() => null)
                    return { id: uid, name: member?.displayName || `usuario ${uid}` }
                }))
                const res = await applyReserve(client, guildId, code, picks)
                if (!res.ok) throw new Error("missing")
                selected = code
                await refresh(submitted)
            } catch {
                try { await submitted.followUp({ content: "No se pudo actualizar. Reabre /drops mostrar.", ephemeral: true }) } catch {}
            }
        }

        const collector = message.createMessageComponentCollector({ time: 24 * 60 * 60 * 1000 })
        collector.on("collect", async interaction => {
            if (!interaction.isStringSelectMenu() && !interaction.isButton()) return
            if (interaction.user.id !== authorId) return tools.denyButton(interaction, "drops")
            // Los botones con modal se abren sin defer (showModal ya reconoce).
            if (interaction.isButton()) {
                const [prefix, action, code] = String(interaction.customId || "").split(":")
                if (prefix === BTN_PREFIX && (action === BTN_USES || action === BTN_TIME)) {
                    return openAmountModal(interaction, action, code)
                }
                if (prefix === BTN_PREFIX && action === BTN_SOLO) {
                    return openReserveModal(interaction, code)
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
                    }
                } else if (interaction.isButton()) {
                    const [prefix, action, code] = id.split(":")
                    if (prefix === BTN_PREFIX && action === BTN_DEL) {
                        await Drops.deleteDrop(client, guildId, code)
                        selected = null
                        await refresh(interaction)
                    } else if (prefix === BTN_PREFIX && action === BTN_OPEN) {
                        await applyOpenAll(client, guildId, code)
                        await refresh(interaction)
                    }
                }
            } catch {
                try { await interaction.followUp({ content: "No se pudo actualizar. Reabre el comando.", ephemeral: true }) } catch {}
            } finally {
                busy = false
            }
        })
        collector.on("end", async () => {
            try {
                // Desactiva botones y menús al expirar (también los de las secciones).
                const container = render()
                const disable = c => { if (typeof c.setDisabled === "function") c.setDisabled(true) }
                for (const row of container.components) {
                    for (const comp of (row.components || [])) disable(comp)
                    if (row.accessory) disable(row.accessory)
                }
                await message.edit(V2.components(container))
            } catch {}
        })
    },

    // Permisos de /drops (solo gestores): roles en settings.dropRoles.
    async runPermiso(client, int, tools) {
        const container = new ContainerBuilder().setAccentColor(ACCENT)
        container.addTextDisplayComponents(textBuilder("## 🔑 Permisos de /drops"))
        container.addSeparatorComponents(sepBuilder())
        const role = int.options.getRole("rol")
        if (role) {
            if (role.id === int.guild.id) return tools.warn("Elige un rol válido (no @everyone).")
            if (int.options.get("quitar")?.value) {
                await client.db.update(int.guild.id, { $pull: { "settings.dropRoles": { id: role.id } } }).exec()
                container.addTextDisplayComponents(textBuilder(`🗑️ <@&${role.id}> ya no puede usar \`/drops\`.`))
            } else {
                await client.db.update(int.guild.id, { $addToSet: { "settings.dropRoles": { id: role.id } } }).exec()
                container.addTextDisplayComponents(textBuilder(`✅ <@&${role.id}> ya puede usar \`/drops\`.`))
            }
        } else {
            const doc = await client.db.fetch(int.guild.id, ["settings.dropRoles"]).exec().catch(() => null)
            const roles = Array.isArray(doc?.settings?.dropRoles) ? doc.settings.dropRoles : []
            container.addTextDisplayComponents(textBuilder(roles.length
                ? `Quien gestione el servidor siempre puede. Además:\n${roles.map(r => `- <@&${r.id}>`).join("\n")}`
                : "Solo quienes gestionan el servidor.\n-# *Añade uno con `/drops permisos rol:@Staff`.*"))
        }
        return say(int, container)
    },

    // Autocompletado de /drops eliminar: lista los drops activos (el valor es el
    // código). Solo para quien puede usar /drops: los códigos son los enlaces.
    async autocomplete(client, int) {
        try {
            const focused = int.options.getFocused(true)
            const guildId = int.guildId || int.guild?.id
            if (!focused || !guildId || focused.name !== "drop") return int.respond([])
            const doc = await client.db.fetch(guildId, ["drops", "settings.dropRoles"]).exec().catch(() => null)
            const allowed = Drops.canUseDrops({
                isManager: !!int.memberPermissions?.has("ManageGuild"),
                memberRoles: int.member?.roles?.cache,
                settings: doc?.settings || {},
            })
            if (!allowed) return int.respond([])
            const q = String(focused.value || "").trim().toLowerCase()
            const rows = Drops.listDrops(doc)
                .filter(r => !r.expired)
                .filter(r => !q || r.code.toLowerCase().includes(q) || String(r.drop.name || "").toLowerCase().includes(q))
            return int.respond(rows.slice(0, 25).map(({ code, drop, left }) => {
                const claimed = Math.max(0, Number(drop.maxClaims) - left)
                const lock = drop.allow?.length ? "🔒 " : ""
                return {
                    name: `${lock}${drop.name || "Drop"} - ${code} - ${fmtInt(claimed)}/${fmtInt(drop.maxClaims)} usos`.slice(0, 100),
                    value: code,
                }
            }))
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
module.exports.draftSetAllow = draftSetAllow
module.exports.draftAddAllow = draftAddAllow
module.exports.draftRemoveAllow = draftRemoveAllow
module.exports.durationLabel = durationLabel
module.exports.describeAllow = describeAllow
module.exports.accessLine = accessLine
module.exports.prizeLines = prizeLines
module.exports.prizeSummary = prizeSummary
module.exports.buildMakeContainer = buildMakeContainer
module.exports.buildPickContainer = buildPickContainer
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