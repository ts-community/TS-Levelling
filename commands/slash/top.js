const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder
} = require("discord.js")
const ranks = require("../../consts/ranks.js")
const recordsConfig = require("../../config/records.js")

const tenureCache = new Map()

function getCurrentSpanishMonth() {
    return new Intl.DateTimeFormat("es-ES", {
        timeZone: "Europe/Madrid",
        month: "long"
    }).format(new Date())
}

// Ancho visual disponible (en "unidades de carácter") antes de que Discord
// parta la línea en dos en una pantalla de móvil estrecha. La fuente de
// Discord NO es monoespaciada: un "1" o un "." ocupan bastante menos que un
// "0" o una "m", así que medir con text.length elegía a veces la variante
// larga para líneas que luego saltaban (p. ej. "109.936 msjs totales -
// 3.240 este mes" saltaba y la casi idéntica "110.894 msjs totales -
// 1.184 este mes" no). Por eso se pesa cada carácter y los umbrales están
// calibrados con casos reales de este servidor. Dos líneas casi idénticas
// ("15.577 mensajes totales - 0 este mes", cabe; "15.637 mensajes totales -
// 11 este mes", saltaba) difieren físicamente en ~2px, así que ningún umbral
// las separa con margen: por eso la cascada acorta primero "este mes"→"mes"
// (casi invisible) antes que "mensajes"→"msjs", y el umbral deja medio
// punto de aire bajo el primer caso real que saltaba.
const MOBILE_LINE_WIDTH = 37.9
// Umbral mensual propio: las líneas mensuales llevan números de XP grandes
// en negrita y el medidor las infravalora un poco frente a las globales.
// Calibrado con datos de pantalla: "87 msgs este mes - 300 XP este mes"
// (37.45, cabe) frente a "1.185 mensajes mes - 115.080 XP mes" (37.02,
// saltaba). El global no se toca.
const MONTHLY_LINE_WIDTH = 36.9
// Un emoji personalizado (<:nombre:id>) se ve como un solo icono pequeño,
// pero como texto pesa muchísimo más que eso: se le da un ancho fijo.
const CUSTOM_EMOJI_VISUAL_WIDTH = 1.8
// La negrita (**...**) ensancha un poco el texto.
const BOLD_WIDTH_FACTOR = 1.08

function charWidth(ch) {
    if (ch === " ") return 0.45
    if (ch === "1") return 0.55
    if (ch === "." || ch === ",") return 0.4
    if (ch === "-") return 0.55
    if (ch === "#") return 0.9
    // Selectores de variación (U+FE0F/U+FE0E) y ZWJ (U+200D): no se
    // renderizan, solo modifican el emoji anterior. Contarlos como 1
    // robaba ~1.0 en las líneas con ❤️/☀️/🎙️ y hacía encoger antes.
    if (ch === "\uFE0F" || ch === "\uFE0E" || ch === "\u200D") return 0
    if ("ijl".includes(ch)) return 0.55
    if ("tf".includes(ch)) return 0.7
    if ("mw".includes(ch)) return 1.4
    if ("MW".includes(ch)) return 1.45
    return 1
}

function estimateVisualWidth(text) {
    // El tachado (~~...~~) es marcado como la negrita: no se renderiza,
    // así que no mide (las líneas completadas de /records lo usan).
    text = String(text).replace(/~~/g, "")
    let width = 0
    for (const part of text.split(/(<a?:\w+:\d+>)/g)) {
        if (!part) continue
        if (/<a?:\w+:\d+>/.test(part)) {
            width += CUSTOM_EMOJI_VISUAL_WIDTH
            continue
        }
        // Tramos impares = dentro de **...** (negrita).
        part.split("**").forEach((segment, index) => {
            let segmentWidth = 0
            for (const ch of segment) segmentWidth += charWidth(ch)
            width += index % 2 === 1 ? segmentWidth * BOLD_WIDTH_FACTOR : segmentWidth
        })
    }
    return width
}

// Recibe variantes del mismo texto de la más completa a la más corta y
// devuelve la primera que quepa en MOBILE_LINE_WIDTH. Si ni la más corta
// cabe, se devuelve igualmente esa (mejor esfuerzo).
function fitLine(...variants) {
    return variants.find(variant => estimateVisualWidth(variant) <= MOBILE_LINE_WIDTH)
        ?? variants[variants.length - 1]
}

function fitMonthlyLine(...variants) {
    return variants.find(variant => estimateVisualWidth(variant) <= MONTHLY_LINE_WIDTH)
        ?? variants[variants.length - 1]
}

// commafy devuelve string: solo "1" es singular, el resto plural (incluido "0").
// Se elige aquí porque fitLine mide la variante ya construida: el cambio de
// palabra no rompe la medición.
const isSingleMessage = n => String(n).trim() === "1"

function globalMessageVariants(total, monthly) {
    const E = "<:messages:1467163578699354235>"
    const full = isSingleMessage(total) ? "mensaje" : "mensajes"
    const abbr = isSingleMessage(total) ? "msj" : "msjs"
    const tot = isSingleMessage(total) ? "total" : "totales"
    return [
        `-# ${E} **${total}** ${full} ${tot}  -  ${E} **${monthly}** este mes`,
        `-# ${E} **${total}** ${full} ${tot}  -  ${E} **${monthly}** mes`,
        `-# ${E} **${total}** ${abbr} ${tot}  -  ${E} **${monthly}** mes`,
        `-# ${E} **${total}** ${abbr}  -  ${E} **${monthly}** mes`,
        `-# ${E} **${total}** m  -  ${E} **${monthly}** m`,
        `-# ${E} **${total}**  -  ${E} **${monthly}**`
    ]
}

function monthlyMessageVariants(monthly, xp) {
    const E = "<:messages:1467163578699354235>"
    const X = "<:XP:1467192533812645939>"
    const full = isSingleMessage(monthly) ? "mensaje" : "mensajes"
    const abbr = isSingleMessage(monthly) ? "msg" : "msgs"
    return [
        `-# ${E} **${monthly}** ${full} este mes  -  ${X} **${xp}** XP este mes`,
        `-# ${E} **${monthly}** ${abbr} este mes  -  ${X} **${xp}** XP este mes`,
        `-# ${E} **${monthly}** ${full} mes  -  ${X} **${xp}** XP mes`,
        `-# ${E} **${monthly}** ${abbr} mes  -  ${X} **${xp}** XP mes`,
        `-# ${E} **${monthly}** ${abbr}  -  ${X} **${xp}** XP`,
        `-# ${E} **${monthly}** m  -  ${X} **${xp}** XP`,
        `-# ${E} **${monthly}**  -  ${X} **${xp}**`
    ]
}

function dailyMessageVariants(msgs, xp) {
    const E = "<:messages:1467163578699354235>"
    const X = "<:XP:1467192533812645939>"
    const full = isSingleMessage(msgs) ? "mensaje" : "mensajes"
    const abbr = isSingleMessage(msgs) ? "msg" : "msgs"
    return [
        `-# ${E} **${msgs}** ${full} hoy  -  ${X} **${xp}** XP hoy`,
        `-# ${E} **${msgs}** ${abbr} hoy  -  ${X} **${xp}** XP hoy`,
        `-# ${E} **${msgs}** ${full}  -  ${X} **${xp}** XP`,
        `-# ${E} **${msgs}** ${abbr}  -  ${X} **${xp}** XP`,
        `-# ${E} **${msgs}** m  -  ${X} **${xp}** XP`,
        `-# ${E} **${msgs}**  -  ${X} **${xp}**`
    ]
}

function statLineVariants(emoji, value, unit, abbr) {
    return [
        `-# ${emoji} **${value}** ${unit}`,
        `-# ${emoji} **${value}** ${abbr}`,
        `-# ${emoji} **${value}**`
    ]
}

// Tops por estadística (misma fuente que /records): valor numérico para
// ordenar + unidad para pintar. Antigüedad es la excepción: vive en el
// miembro actual de Discord y requiere descargar los miembros del servidor.
function statNumber(raw) {
    if (raw == null) return 0
    if (typeof raw === "object") return Number(raw.current ?? raw.days) || 0
    return Number(raw) || 0
}

const STAT_MODES = {
    mensajes: {
        menuEmoji: "💬", label: "Mensajes totales", title: "Top de Mensajes Totales",
        unit: "mensajes", abbr: "msjs", emoji: "<:messages:1467163578699354235>",
        one: "mensaje", shortUnit: "msjs", shortOne: "msj",
        get: u => Number(u.messages) || 0,
    },
    mensajes_mes: {
        menuEmoji: "📅", label: "Mensajes este mes", title: "Top de Mensajes Este Mes",
        unit: "mensajes este mes", abbr: "msgs mes", emoji: "<:messages:1467163578699354235>",
        one: "mensaje este mes", midUnit: "msgs mes", midOne: "msg mes",
        shortUnit: "mes", shortOne: "mes",
        get: u => Number(u.monthlyMessages) || 0,
    },
    mensajes_dia: {
        menuEmoji: "☀️", label: "Mensajes diarios", title: "Top de Mensajes Diarios",
        unit: "mensajes hoy", abbr: "msgs hoy", emoji: "☀️",
        one: "mensaje hoy", midUnit: "msgs hoy", midOne: "msg hoy",
        shortUnit: "hoy", shortOne: "hoy",
        get: u => Number(u.dailyMessages) || 0,
    },
    mensajes_mes_max: {
        menuEmoji: "🏆", label: "Mensajes Máximos Mensuales", title: "Top de Mensajes Máximos Mensuales",
        unit: "mensajes máx. en un mes", abbr: "msgs máx. mes", emoji: "🏆",
        one: "mensaje máx. en un mes", midUnit: "msgs máx. mes", midOne: "msg máx. mes",
        shortUnit: "máx. mes", shortOne: "máx. mes",
        tinyUnit: "mes", tinyOne: "mes",
        get: u => Math.max(Number(u.monthlyMessagesMax) || 0, Number(u.monthlyMessages) || 0),
    },
    mensajes_dia_max: {
        menuEmoji: "🏆", label: "Mensajes Máximos Diarios", title: "Top de Mensajes Máximos Diarios",
        unit: "mensajes máx. en un día", abbr: "msgs máx. día", emoji: "🏆",
        one: "mensaje máx. en un día", midUnit: "msgs máx. día", midOne: "msg máx. día",
        shortUnit: "máx. día", shortOne: "máx. día",
        tinyUnit: "día", tinyOne: "día",
        get: u => Math.max(Number(u.dailyMessagesMax) || 0, Number(u.dailyMessages) || 0),
    },
    racha: {
        menuEmoji: "🔥", label: "Racha actual", title: "Top de Racha Actual",
        unit: "días de racha", abbr: "días", emoji: "🔥",
        one: "día de racha", shortUnit: "días", shortOne: "día",
        get: u => statNumber(u.streak),
    },
    racha_max: {
        menuEmoji: "🏆", label: "Racha máxima", title: "Top de Racha Máxima",
        unit: "días de racha máx.", abbr: "días máx.", emoji: "🏆",
        one: "día de racha máx.", midUnit: "días máx.", midOne: "día máx.",
        shortUnit: "máx.", shortOne: "máx.",
        get: u => {
            const raw = u.streak
            if (raw == null) return 0
            if (typeof raw === "object") return Number(raw.max ?? raw.maximum ?? raw.best ?? raw.current ?? raw.days) || 0
            return Number(raw) || 0
        },
    },
    antiguedad: {
        menuEmoji: "🏅", label: "Antigüedad", title: "Top de Antigüedad",
        unit: "años en el servidor", abbr: "años", emoji: "🏅",
        one: "año en el servidor", shortUnit: "años", shortOne: "año",
        get: u => Number(u.joinedTimestamp) || 0,
    },
    reacciones_recibidas: {
        menuEmoji: "💘", label: "Reacciones recibidas", title: "Top de Reacciones Recibidas",
        unit: "reacciones recibidas", abbr: "reaccs recibidas", emoji: "💘",
        one: "reacción recibida", midUnit: "reaccs recibidas", midOne: "reacc. recibida",
        shortUnit: "recibidas", shortOne: "recibida",
        tinyUnit: "reaccs", tinyOne: "reaccs",
        get: u => Number(u.reactionsReceived) || 0,
    },
    reacciones_enviadas: {
        menuEmoji: "❤️", label: "Reacciones enviadas", title: "Top de Reacciones Enviadas",
        unit: "reacciones enviadas", abbr: "reaccs enviadas", emoji: "❤️",
        one: "reacción enviada", midUnit: "reaccs enviadas", midOne: "reacc. enviada",
        shortUnit: "enviadas", shortOne: "enviada",
        tinyUnit: "reaccs", tinyOne: "reaccs",
        get: u => Number(u.reactionsSent) || 0,
    },
    pokemon: {
        menuEmoji: "💥", label: "Poketwo", title: "Top de Poketwo",
        unit: "pokemons", abbr: "pkm", emoji: "💥",
        one: "pokemon", shortUnit: "pokes", shortOne: "poke",
        tinyUnit: "pkm", tinyOne: "pkm",
        get: u => Number(u.pokemonCaught) || 0,
    },
    counting: {
        menuEmoji: "🔢", label: "Counting", title: "Top de Counting",
        unit: "números", abbr: "núms.", emoji: "🔢",
        one: "número", shortUnit: "núms.", shortOne: "núm.",
        get: u => Number(u.countingSent) || 0,
    },
    voz: {
        menuEmoji: "🎙️", label: "Voz", title: "Top de Voz",
        unit: "min en voz", abbr: "min", emoji: "🎙️",
        one: "min en voz", get: u => Number(u.voiceMinutes) || 0,
    },
}

const STAT_RECORD_EMOJIS = Object.fromEntries(recordsConfig.categories
    .flatMap(category => category.records.map(record => [record.id, record.emoji])))
const STAT_RECORD_IDS = {
    mensajes: "messages",
    mensajes_mes: "monthly_messages",
    mensajes_dia: "daily_messages",
    reacciones_enviadas: "reactions_sent",
    reacciones_recibidas: "reactions_received",
    racha: "streak",
    racha_max: "streak",
    counting: "counting",
    pokemon: "pokemon",
    voz: "voice_time",
}

function statUnit(mode, value) {
    if (Number(value) === 1 && mode.one) return mode.one
    return mode.unit
}

// Texto de voz como en las estadísticas de /records ("2 horas",
// "2 horas y 5 minutos", "45 minutos"). Duplicado aquí a propósito para
// no crear un ciclo records.js -> top.js.
function topVoiceText(minutes) {
    const total = Math.max(0, Math.floor(Number(minutes) || 0))
    if (!total) return "0 minutos"
    const hours = Math.floor(total / 60)
    const rest = total % 60
    const h = n => `${n} ${n === 1 ? "hora" : "horas"}`
    const m = n => `${n} ${n === 1 ? "minuto" : "minutos"}`
    if (!rest) return h(hours)
    if (!hours) return m(rest)
    return `${h(hours)} y ${m(rest)}`
}

// Versión compacta del tiempo de voz para las líneas del top
// ("2 h y 5 min" en vez de "2 horas y 5 minutos"). Mismo formato corto
// que /records (formatVoiceTimeShort).
function topVoiceTextShort(minutes) {
    const total = Math.max(0, Math.floor(Number(minutes) || 0))
    if (!total) return "0 min"
    const hours = Math.floor(total / 60)
    const rest = total % 60
    if (!rest) return `${hours} h`
    if (!hours) return `${rest} min`
    return `${hours} h y ${rest} min`
}

function topVoiceTextCompact(minutes) {
    const total = Math.max(0, Math.floor(Number(minutes) || 0))
    if (!total) return "0m"
    const hours = Math.floor(total / 60)
    const rest = total % 60
    if (!rest) return `${hours}h`
    if (!hours) return `${rest}m`
    return `${hours}h ${rest}m`
}

function topTenureText(joinedTimestamp, now = Date.now()) {
    const joined = new Date(joinedTimestamp)
    const current = new Date(now)
    if (!Number.isFinite(joined.getTime()) || joined > current) return "0 días"

    const addYears = (date, years) => {
        const result = new Date(date)
        const day = result.getDate()
        result.setDate(1)
        result.setFullYear(result.getFullYear() + years)
        result.setMonth(date.getMonth())
        result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()))
        return result
    }
    const addMonths = (date, months) => {
        const result = new Date(date)
        const day = result.getDate()
        result.setDate(1)
        result.setMonth(result.getMonth() + months)
        result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()))
        return result
    }

    let years = current.getFullYear() - joined.getFullYear()
    let anniversary = addYears(joined, years)
    if (anniversary > current) {
        years--
        anniversary = addYears(joined, years)
    }

    let months = (current.getFullYear() - anniversary.getFullYear()) * 12 +
        current.getMonth() - anniversary.getMonth()
    let reference = addMonths(anniversary, months)
    if (reference > current) {
        months--
        reference = addMonths(anniversary, months)
    }
    const days = Math.max(0, Math.floor((current - reference) / (24 * 3600 * 1000)))
    const parts = []
    if (years) parts.push(`${years} ${years === 1 ? "año" : "años"}`)
    if (months) parts.push(`${months} ${months === 1 ? "mes" : "meses"}`)
    if (days || !parts.length) parts.push(`${days} ${days === 1 ? "día" : "días"}`)
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`
}

function topTenureTextShort(joinedTimestamp, now = Date.now()) {
    return topTenureText(joinedTimestamp, now)
        .replace(/años?/g, "a")
        .replace(/meses?/g, "m")
        .replace(/días?/g, "d")
}

function topTenureVariants(joinedTimestamp, now = Date.now()) {
    const full = topTenureText(joinedTimestamp, now)
    const daysShort = full.replace(/días?/g, "d")
    const monthsShort = daysShort.replace(/meses?/g, "m")
    const compact = topTenureTextShort(joinedTimestamp, now)
    return [...new Set([full, daysShort, monthsShort, compact])]
}

// Listón para las líneas de stats del top. Van sin -# (letra normal),
// así que otra lógica y otro listón que en las líneas pequeñas: si la
// línea completa no cabe con el nombre visible, se usa la unidad compacta o,
// como último recurso, solo el número para evitar saltos de línea.
// Calibrado con casos reales en móvil estrecho: con 48 casi todo cabía
// según el medidor pero en pantalla saltaba (la mención pillada ocupa
// más que el nombre plano y el emoji unicode más de lo que mide). La
// sonda mide ya la mención real (@nombre) con sus marcas, y el listón
// deja margen para ese extra sin contar (pill + emoji unicode).
const TOP_STAT_LINE_WIDTH = 37

// Línea de una entrada del top en vistas de stats: número primero y
// mención al final (la mención no tiene longitud fija y así las cifras
// quedan estructuradas). Las marcas (Tú / fuera del server / buscado)
// van al final del todo, fuera de la negrita.
function buildStatEntryLine({ emoji, position, mention, shownName, endMarkers, viewKey, commafied, value, displayValue, displayValueShort, displayValueVariants }) {
    const mode = STAT_MODES[viewKey]
    // La sonda imita la línea final: la mención se pinta como @nombre
    // (estimateVisualWidth ya cuenta los emojis personalizados de las
    // marcas como icono). Sin ella se infravaloraba y el salto llegaba
    // antes de encoger.
    const probeWidth = valueText =>
        estimateVisualWidth(`${emoji} **#${position} - ${valueText}** - @${shownName || ""}${endMarkers || ""}`)
    // Con marca visible (Tú / nombre buscado) la línea lleva texto extra
    // tras la mención cuya píldora ya va justa de margen: listón 3 uds.
    // más estricto para que no salte en móvil estrecho. La marca de
    // "fuera del server" (solo icono) no necesita margen extra.
    const markerText = String(endMarkers || "").replace(/<a?:\w+:\d+>/g, "")
    const lineLimit = markerText.trim() ? TOP_STAT_LINE_WIDTH - 3 : TOP_STAT_LINE_WIDTH
    let valueText
    if (viewKey === "antiguedad") {
        valueText = displayValueShort || "0 d"
    } else if (viewKey === "voz") {
        const full = topVoiceText(value)
        const short = topVoiceTextShort(value)
        const compact = topVoiceTextCompact(value)
        valueText = [full, short, compact].find(text => probeWidth(text) <= lineLimit) ?? compact
    } else {
        // Cascada completa → intermedia → corta → mínima → solo número.
        // La intermedia (midUnit) y la corta (shortUnit) siempre conservan
        // el marcador distintivo (mes/hoy/máx. mes/máx. día/recibidas/
        // enviadas/máx.) para no confundir mensual con diario ni
        // recibidas con enviadas. La mínima (tinyUnit) es de una sola
        // palabra como último texto antes del número pelado (p. ej.
        // "reaccs"). Solo el número es el último recurso si ni la forma
        // mínima cabe con nombres muy largos.
        const one = Number(value) === 1
        const full = `${commafied} ${one && mode.one ? mode.one : mode.unit}`
        const candidates = [full]
        if (mode.midUnit) {
            const mid = `${commafied} ${one ? (mode.midOne || mode.midUnit) : mode.midUnit}`
            if (!candidates.includes(mid)) candidates.push(mid)
        }
        if (mode.shortUnit) {
            const short = `${commafied} ${one ? (mode.shortOne || mode.shortUnit) : mode.shortUnit}`
            if (!candidates.includes(short)) candidates.push(short)
        }
        if (mode.tinyUnit) {
            const tiny = `${commafied} ${one ? (mode.tinyOne || mode.tinyUnit) : mode.tinyUnit}`
            if (!candidates.includes(tiny)) candidates.push(tiny)
        }
        candidates.push(commafied)
        valueText = candidates.find(text => probeWidth(text) <= lineLimit) ?? commafied
    }
    return `${emoji} **#${position} - ${valueText}** - ${mention}${endMarkers || ""}`
}

// Un solo control para cambiar de vista: XP total, XP del mes, XP del día
// y una entrada por estadística (testeable sin interacción).
const VIEW_MODES = [
    { value: "xp", label: "XP total", menuEmoji: "📊" },
    { value: "xp_mes", label: "XP del mes", menuEmoji: "🗓️" },
    { value: "xp_dia", label: "XP del día", menuEmoji: "✨" },
]

const VIEW_GROUPS = [
    { value: "grupo_xp", label: "XP", menuEmoji: "📊", views: ["xp", "xp_mes", "xp_dia"] },
    { value: "grupo_actividad", label: "Actividad", menuEmoji: "💬", views: ["mensajes", "mensajes_mes", "mensajes_dia", "mensajes_mes_max", "mensajes_dia_max"] },
    { value: "grupo_comunidad", label: "Comunidad", menuEmoji: "🤝", views: ["antiguedad", "racha", "racha_max", "reacciones_recibidas", "reacciones_enviadas"] },
    { value: "grupo_canales", label: "Canales", menuEmoji: "🧭", views: ["pokemon", "counting"] },
    { value: "grupo_voz", label: "Voz", menuEmoji: "🎙️", views: ["voz"] },
]

function viewGroupFor(viewKey) {
    return VIEW_GROUPS.find(group => group.views.includes(viewKey)) || VIEW_GROUPS[0]
}

function buildViewMenu(viewKey, disabled = false, groupValue = null, selectedView = viewKey) {
    const group = groupValue && VIEW_GROUPS.find(item => item.value === groupValue)
    const options = group
        ? [
            { value: "top-groups", label: "Volver atrás", menuEmoji: "⬅️" },
            ...group.views.map(value => ({ value, label: value.startsWith("xp") ? VIEW_MODES.find(mode => mode.value === value)?.label : STAT_MODES[value]?.label, menuEmoji: value.startsWith("xp") ? VIEW_MODES.find(mode => mode.value === value)?.menuEmoji : STAT_MODES[value]?.menuEmoji })),
        ]
        : VIEW_GROUPS
    return new StringSelectMenuBuilder()
        .setCustomId("top-view")
        .setPlaceholder(group ? "Selecciona una estadística…" : "Selecciona una categoría…")
        .setDisabled(disabled)
        .addOptions(
            ...options.map(v =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(v.label).setValue(v.value).setEmoji(v.menuEmoji)
                    .setDefault(group
                        ? selectedView === v.value
                        : selectedView != null && viewGroupFor(viewKey).value === v.value)),
        )
}

module.exports = {
metadata: {
    name: "top",
    description: "Ver la clasificación de XP del servidor.",
    args: [
        { type: "user", name: "member", description: "Busca la posición de un miembro en la clasificación", required: false },
        { type: "string", name: "view", description: "Elige qué clasificación abrir", required: false, choices: [
            { name: "📊 XP total", value: "xp" },
            { name: "🗓️ XP del mes", value: "xp_mes" },
            { name: "✨ XP del día", value: "xp_dia" },
            { name: "💬 Mensajes totales", value: "mensajes" },
            { name: "📅 Mensajes este mes", value: "mensajes_mes" },
            { name: "☀️ Mensajes diarios", value: "mensajes_dia" },
            { name: "🏆 Mensajes Máximos Mensuales", value: "mensajes_mes_max" },
            { name: "🏆 Mensajes Máximos Diarios", value: "mensajes_dia_max" },
            { name: "🔥 Racha actual", value: "racha" },
            { name: "🏆 Racha máxima", value: "racha_max" },
            { name: "🏅 Antigüedad", value: "antiguedad" },
            { name: "💘 Reacciones recibidas", value: "reacciones_recibidas" },
            { name: "❤️ Reacciones enviadas", value: "reacciones_enviadas" },
            { name: "💥 Poketwo", value: "pokemon" },
            { name: "🔢 Counting", value: "counting" },
            { name: "🎙️ Voz", value: "voz" },
        ]},
    ]
},

async run(client, int, tools) {
    // Los bots no tienen XP: respuesta efímera antes del defer (después
    // ya no se puede hacer efímero).
    if (tools.getTargetUser()?.bot) return int.reply({ content: tools.errors.noBotView, ephemeral: true })
    // Defer INMEDIATO, antes del trabajo pesado (fetchAll del doc entero +
    // rankings): si la DB tarda más de 3s, Discord muestra "La aplicación
    // no ha respondido" y un defer tardío ya no sirve (Unknown interaction).
    // El flag ephemeral vive en settings: lectura ligera con proyección
    // (sin crear docs) para diferir ya con el flag correcto. Un solo
    // deferReply: un segundo revienta con "already been sent or deferred".
    let isHidden = false
    try {
        const settingsDoc = await client.db.fetch(int.guild.id, ["settings"])
        isHidden = !!settingsDoc?.settings?.leaderboard?.ephemeral
    } catch {}
    await int.deferReply({
        flags: MessageFlags.IsComponentsV2 | (isHidden ? MessageFlags.Ephemeral : 0)
    })
    let lbLink = `${tools.WEBSITE}/leaderboard/${int.guild.id}`

    let db = await tools.fetchAll()
    if (!db) return tools.warn(`¡Aún no hay nadie en la clasificación de este servidor!`)
    else if (!db.settings?.enabled) return tools.warn("*xpDisabled")
    else if (db.settings.leaderboard?.disabled) return tools.warn("¡La clasificación está desactivada en este servidor!" + (tools.canManageServer(int.member) ? `\nComo moderador, puedes verla en privado aquí: ${lbLink}` : ""))
    // isHidden ya se resolvió arriba para el defer (no se puede cambiar después).

    if (client.monthlyMaintenance) {
        client.monthlyMaintenance(int.guild, db).catch(error => {
            console.warn(`Could not update monthly leaderboard for ${int.guild.id}:`, error.message)
        })
    }

    let pageSize = 8
    const userEntries = tools.xpObjToArray(db.users || {})
    const requestedView = int.options?.get?.("view")?.value
    const requestedViewKey = requestedView === "monthly" ? "xp_mes"
        : requestedView === "daily" ? "xp_dia"
            : requestedView
    let viewKey = requestedViewKey || "xp"
    if (viewKey !== "xp" && viewKey !== "xp_mes" && viewKey !== "xp_dia" && !STAT_MODES[viewKey]) viewKey = "xp"
    let menuGroup = null
    let pickerMode = null
    if (requestedViewKey) menuGroup = viewGroupFor(viewKey).value

    let minLeaderboardXP = db.settings.leaderboard?.minLevel > 1 ? tools.xpForLevel(db.settings.leaderboard.minLevel, db.settings) : 0
    const hasLeaderboardLevel = userData => Number(userData?.xp) > 0 && tools.getLevel(Number(userData.xp), db.settings) > 0
    const info = db.info || null
    const tenureMembers = new Map()
    let tenureLoadPromise = null
    const getTenureAge = member => {
        const joined = Number(member?.joinedTimestamp)
        if (!joined) return 0
        return Math.max(0, Date.now() - joined)
    }
    const loadTenureMembers = async () => {
        if (tenureMembers.size) return
        const currentMembers = int.guild.members.cache
        if (currentMembers?.size) currentMembers.forEach(member => tenureMembers.set(String(member.id), member))
        if (tenureMembers.size >= Number(int.guild.memberCount || 0)) return
        const cached = tenureCache.get(String(int.guild.id))
        if (cached && Date.now() - cached.loadedAt < 10 * 60 * 1000) {
            cached.members.forEach(member => tenureMembers.set(String(member.id), member))
            return
        }
        if (!tenureLoadPromise) {
            tenureLoadPromise = int.guild.members.fetch().then(members => {
                if (typeof members.forEach === "function") members.forEach(member => tenureMembers.set(String(member.id), member))
                tenureCache.set(String(int.guild.id), { loadedAt: Date.now(), members: new Map(tenureMembers) })
            }).catch(() => {})
        }
        await tenureLoadPromise
    }
    const buildRankings = isMonthly => userEntries
        .map(entry => ({ entry, value: isMonthly ? tools.getMonthlyXP(entry, info) : Number(entry.xp) || 0 }))
        .filter(({ entry, value }) => hasLeaderboardLevel(entry) && !entry.hidden && value > (isMonthly ? 0 : minLeaderboardXP))
        .sort((a, b) => isMonthly
            ? b.value - a.value
                || tools.getMonthlyMessages(b.entry, info) - tools.getMonthlyMessages(a.entry, info)
                || b.entry.xp - a.entry.xp
            : b.value - a.value)
        .map(({ entry }) => entry)
    let rankings = buildRankings(false)

    // El botón rota global -> mensual -> diario. El diario ordena por XP del
    // día (desempate por mensajes del día y luego XP total, como el mensual).
    const buildDailyRankings = () => userEntries
        .map(entry => ({ entry, value: tools.getDailyXP(entry, info) }))
        .filter(({ entry, value }) => hasLeaderboardLevel(entry) && !entry.hidden && value > 0)
        .sort((a, b) => b.value - a.value
            || tools.getDailyMessages(b.entry, info) - tools.getDailyMessages(a.entry, info)
            || b.entry.xp - a.entry.xp)
        .map(({ entry }) => entry)

    const statValueFor = (key, entry) => {
        if (key === "mensajes_mes") return tools.getMonthlyMessages(entry, info)
        if (key === "mensajes_dia") return tools.getDailyMessages(entry, info)
        if (key === "antiguedad") return getTenureAge(tenureMembers.get(String(entry.id)))
        const mode = STAT_MODES[key]
        return mode ? mode.get(entry) : 0
    }

    const buildStatRankings = key => {
        const mode = STAT_MODES[key]
        if (!mode) return []
        if (key === "antiguedad") {
            return [...tenureMembers.values()]
                .filter(member => !member.user?.bot && member.joinedTimestamp)
                .map(member => ({
                    id: String(member.id),
                    xp: Number(db.users?.[String(member.id)]?.xp) || 0,
                    hidden: !!db.users?.[String(member.id)]?.hidden,
                }))
                .filter(entry => !entry.hidden && statValueFor(key, entry) > 0)
                .sort((a, b) => statValueFor(key, b) - statValueFor(key, a) || b.xp - a.xp)
        }
        return userEntries
            .map(entry => ({ entry, value: statValueFor(key, entry) }))
            .filter(({ entry, value }) => hasLeaderboardLevel(entry) && !entry.hidden && value > 0)
            .sort((a, b) => b.value - a.value || b.entry.xp - a.entry.xp)
            .map(({ entry }) => entry)
    }

    const buildViewRankings = key => {
        if (key === "xp_mes") return buildRankings(true)
        if (key === "xp_dia") return buildDailyRankings()
        if (key && STAT_MODES[key]) return buildStatRankings(key)
        return buildRankings(false)
    }

    if (viewKey === "antiguedad") await loadTenureMembers()
    rankings = buildViewRankings(viewKey)

    let totalPages = Math.max(1, Math.ceil(rankings.length / pageSize))
    let pageNumber = 1

    let highlight = null
    // En menús de contexto (View on leaderboard) no hay options: se usa targetUser.
    // Igual que la opción member, pero desde el menú de contexto (Ver en el top).
    let userSearch = int.options?.get?.("user") || int.options?.get?.("member") || (int.targetUser ? { user: int.targetUser } : null)
    if (userSearch) {
        let foundRanking = rankings.findIndex(x => x.id == userSearch.user.id)
        if (isNaN(foundRanking) || foundRanking < 0) return tools.warn(int.user.id == userSearch.user.id ? "¡No estás en el top!" : "¡Este miembro no está en el top!")
        else pageNumber = Math.floor(foundRanking / pageSize) + 1
        highlight = userSearch.user.id
    }

    const configuredColor = db.settings.leaderboard?.embedColor
    const accentColor = configuredColor && configuredColor !== -1
        ? (typeof configuredColor === "string"
            ? parseInt(configuredColor.replace("#", ""), 16)
            : configuredColor)
        : tools.COLOR

    const resolvedMembers = new Map()

    // Fetches only the members not already cached/resolved, in a single
    // batched request per page instead of one force-fetch per member.
    const resolvePageMembers = async userIds => {
        const missing = userIds.filter(id => !resolvedMembers.has(id))
        if (!missing.length) return

        const fetched = await int.guild.members.fetch({ user: missing }).catch(() => new Map())
        missing.forEach(id => resolvedMembers.set(id, fetched.get(id) ?? null))
    }

    const buildContainer = async (page, disabled = false) => {
        const showPicker = pickerMode !== null
        const pageData = showPicker ? [] : rankings.slice((page - 1) * pageSize, page * pageSize)
        const pageUserIds = pageData.map(entry => String(entry.id))

        await resolvePageMembers(pageUserIds)

        const entryComponents = []
        const pageRankCounts = new Map()
        const getRankInfo = entry => {
            const level = tools.getLevel(entry.xp, db.settings)
            const reward = tools.getRolesForLevel(level, db.settings.rewards)[0]
            const rank = reward && ranks.find(rankData => rankData.roles.some(role => role.id === reward.id))
            const rankRole = rank?.roles.find(role => role.id === reward?.id)
            if (rank) pageRankCounts.set(rank.rank, (pageRankCounts.get(rank.rank) || 0) + 1)
            return { level, rank, rankRole }
        }

        const pageRankInfo = pageData.map(getRankInfo)
        const dominantRankName = [...pageRankCounts.entries()]
            .sort((a, b) => b[1] - a[1])[0]?.[0]
        const dominantRank = ranks.find(rankData => rankData.rank === dominantRankName)
        const statMode = STAT_MODES[viewKey] || null
        const pageAccentColor = statMode
            ? accentColor
            : viewKey === "xp_dia"
            ? 0xffd166
            : viewKey === "xp_mes"
            ? 0x8ecae6
            : dominantRank
            ? parseInt(dominantRank.color.replace("#", ""), 16)
            : accentColor

        pageData.forEach((entry, index) => {
            const position = (page - 1) * pageSize + index + 1
            const userId = String(entry.id)
            const isHighlighted = entry.id === highlight
            const isRequester = entry.id === int.user.id
            const { level, rankRole } = pageRankInfo[index]
            const totalMessages = tools.commafy(tools.getMessages(entry))
            const monthlyMessages = tools.commafy(tools.getMonthlyMessages(entry, info))
            const monthlyXP = tools.commafy(tools.getMonthlyXP(entry, info))
            const dailyMessages = tools.commafy(tools.getDailyMessages(entry, info))
            const dailyXP = tools.commafy(tools.getDailyXP(entry, info))
            const statValue = statMode ? statValueFor(viewKey, entry) : 0
            const member = resolvedMembers.get(userId)
            const statDisplayValue = viewKey === "antiguedad"
                ? topTenureText(tenureMembers.get(userId)?.joinedTimestamp)
                : null
            const statDisplayValueShort = viewKey === "antiguedad"
                ? topTenureTextShort(tenureMembers.get(userId)?.joinedTimestamp)
                : null
            const statDisplayValueVariants = viewKey === "antiguedad"
                ? topTenureVariants(tenureMembers.get(userId)?.joinedTimestamp)
                : null
            const user = member?.user || client.users.cache.get(userId)
            const displayName = member?.displayName || user?.globalName || user?.username
            const shownName = displayName || "Miembro"
            // Stats: número primero y marcas al final del todo.
            const memberDisplay = `<@${userId}>`
            let endMarkers = ""
            if (!member) endMarkers += "  <:no_en_el_server:1549908584555347988>"
            if (isHighlighted && !isRequester) endMarkers += `  <:member:1467596629787021415>** ${shownName}**`
            else if (isRequester) endMarkers += "  <:member:1467596629787021415> **Tú**"
            // XP: tal cual estaba (marcas dentro de la negrita).
            const xpMemberDisplay = member
                ? `<@${userId}>`
                : `<@${userId}>  <:no_en_el_server:1549908584555347988>`
            const xpMemberMarker = isHighlighted && !isRequester
                ? `  <:member:1467596629787021415>** ${shownName}**`
                : isRequester
                    ? "  <:member:1467596629787021415> **Tú**"
                    : ""
            const statEmoji = STAT_RECORD_EMOJIS[STAT_RECORD_IDS[viewKey]] || statMode?.emoji
            entryComponents.push(new TextDisplayBuilder().setContent([
                statMode
                    ? buildStatEntryLine({ emoji: statEmoji, position, mention: memberDisplay, shownName, endMarkers, viewKey, commafied: tools.commafy(statValue), value: statValue, displayValue: statDisplayValue, displayValueShort: statDisplayValueShort, displayValueVariants: statDisplayValueVariants })
                    : `${rankRole?.emoji || "<:top:1467967277251956887>"} **#${position} - Nivel ${level} - ${xpMemberDisplay}**${xpMemberMarker}`,
                !statMode && viewKey === "xp_dia"
                    ? fitMonthlyLine(...dailyMessageVariants(dailyMessages, dailyXP))
                    : !statMode && viewKey === "xp_mes"
                    ? fitMonthlyLine(...monthlyMessageVariants(monthlyMessages, monthlyXP))
                    : !statMode ? fitLine(...globalMessageVariants(totalMessages, monthlyMessages)) : null
            ].filter(Boolean).join("\n")))

            if (index < pageData.length - 1) {
                entryComponents.push(new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small))
            }
        })

        if (!pageData.length && !showPicker) {
            entryComponents.push(new TextDisplayBuilder().setContent("*Aún no hay miembros en este top.*"))
        }

        const previousPage = page <= 1 ? totalPages : page - 1
        const nextPage = page >= totalPages ? 1 : page + 1
        const firstMember = (page - 1) * pageSize + 1
        const lastMember = Math.min(page * pageSize, rankings.length)
        const memberRange = rankings.length ? `Miembros **${firstMember}-${lastMember}** de **${rankings.length}**` : "**0 miembros**"
        const canNavigate = rankings.length > pageSize
        const selectedView = menuGroup && pickerMode !== "stats" ? viewKey : null
        const viewMenu = buildViewMenu(viewKey, disabled, menuGroup, selectedView)
        const selectedGroup = menuGroup ? VIEW_GROUPS.find(group => group.value === menuGroup) : null
        const menuOptionLabel = value => {
            const xpMode = VIEW_MODES.find(mode => mode.value === value)
            const statMode = STAT_MODES[value]
            return xpMode ? `${xpMode.menuEmoji} ${xpMode.label}` : `${statMode?.menuEmoji || "•"} ${statMode?.label || value}`
        }
        const menuHint = pickerMode === "stats" && selectedGroup
            ? [
                "Elige una estadística:",
                ...selectedGroup.views.map(value => `- ${menuOptionLabel(value)}`),
            ].join("\n")
            : pickerMode === "categories"
                ? [
                    "Elige una categoría para ver su top:",
                    ...VIEW_GROUPS.map(group => `- ${group.menuEmoji} ${group.label}`),
                ].join("\n")
                : null
        const navigation = [
            new ButtonBuilder()
                .setCustomId("top-prev")
                .setLabel(`<< Página ${previousPage}`)
                .setStyle(page <= 1 ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setDisabled(!canNavigate || disabled),
            new ButtonBuilder()
                .setCustomId("top-next")
                .setLabel(`Página ${nextPage} >>`)
                .setStyle(page >= totalPages ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setDisabled(!canNavigate || disabled),
        ]

        const pageTitle = pickerMode === "categories"
            ? `# <:top:1467967277251956887> Categorías del Top`
            : pickerMode === "stats"
                ? `# <:top:1467967277251956887> Estadísticas de ${selectedGroup?.label || "este grupo"}`
                : `# <:top:1467967277251956887> ${statMode ? statMode.title : viewKey === "xp_dia" ? "Top Diario" : viewKey === "xp_mes" ? `Top de ${getCurrentSpanishMonth().charAt(0).toUpperCase() + getCurrentSpanishMonth().slice(1)}` : "Top"} de ${int.guild.name}`
        const container = new ContainerBuilder()
            .setAccentColor(pageAccentColor || tools.COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                pageTitle,
                menuHint,
            ].filter(Boolean).join("\n")))

        container.addSeparatorComponents(new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small))

        entryComponents.forEach(component => {
            if (component instanceof SeparatorBuilder) container.addSeparatorComponents(component)
            else container.addTextDisplayComponents(component)
        })

        const renderedContainer = showPicker
            ? container.addActionRowComponents(new ActionRowBuilder().addComponents(viewMenu))
            : container
                .addSeparatorComponents(new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `-# Página **${page}** de **${totalPages}**  -  ${memberRange}`))
                .addActionRowComponents(new ActionRowBuilder().addComponents(navigation))
                .addSeparatorComponents(new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small))
                .addActionRowComponents(new ActionRowBuilder().addComponents(viewMenu))
        return {
            container: renderedContainer,
            pageUserIds
        }
    }

    if (pageNumber < 1 || pageNumber > totalPages) return tools.warn("¡No hay miembros en esta página!")

    const sendPage = async (page, editor, disabled = false) => {
        const { container, pageUserIds } = await buildContainer(page, disabled)

        // Se incluye SIEMPRE a los usuarios de la página como mención real,
        // para que se resuelvan bien en cualquier dispositivo, pero con
        // SuppressNotifications para que no llegue push/sonido.
        await editor.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
            allowedMentions: { users: pageUserIds, parse: [] },
        })
    }

    const updatePage = async (page, editor, disabled = false) => {
        const { container, pageUserIds } = await buildContainer(page, disabled)
        await editor.update({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
            allowedMentions: { users: pageUserIds, parse: [] },
        })
    }

    const updateTenureLoading = async editor => {
        const container = new ContainerBuilder()
            .setAccentColor(accentColor || tools.COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# 🏅 Top de Antigüedad de ${int.guild.name}\n-# Cargando los miembros actuales del servidor…`,
            ))
        await editor.update({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
            allowedMentions: { parse: [] },
        })
    }

    await sendPage(pageNumber, int)
    const message = await int.fetchReply()

    const editMessagePage = async (page, disabled = false) => {
        const { container, pageUserIds } = await buildContainer(page, disabled)
        await message.edit({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
            allowedMentions: { users: pageUserIds, parse: [] },
        })
    }

    let buttonPressed = false
    const collector = message.createMessageComponentCollector({ time: 24 * 60 * 60 * 1000 })
    collector.on("collect", async button => {
        // Solo quien usó /top puede paginar o cambiar la vista. Aviso en español.
        if (button.user.id !== int.user.id) return tools.denyButton(button, "top")
        if (buttonPressed) {
            await button.deferUpdate().catch(() => {})
            return
        }

        buttonPressed = true
        try {
            const isViewMenu = button.isStringSelectMenu?.() && button.customId === "top-view"
            const picked = isViewMenu ? button.values?.[0] : null
            const pickedGroup = VIEW_GROUPS.find(group => group.value === picked)
            const onlyChangesPicker = isViewMenu && (picked === "top-groups" || pickedGroup?.views.length > 1)
            const opensTenure = isViewMenu && picked === "antiguedad"
            const tenureNeedsLoading = opensTenure && !tenureMembers.size
            if (!onlyChangesPicker && !tenureNeedsLoading) await button.deferUpdate()

            if (button.customId === "top-prev") pageNumber = pageNumber <= 1 ? totalPages : pageNumber - 1
            if (button.customId === "top-next") pageNumber = pageNumber >= totalPages ? 1 : pageNumber + 1
            if (isViewMenu) {
                if (picked === "top-groups") {
                    menuGroup = null
                    viewKey = "xp"
                    pickerMode = "categories"
                } else if (VIEW_GROUPS.some(group => group.value === picked)) {
                    const pickedGroup = VIEW_GROUPS.find(group => group.value === picked)
                    menuGroup = picked
                    viewKey = pickedGroup.views[0]
                    pickerMode = pickedGroup.views.length === 1 ? null : "stats"
                } else if (picked === "xp_mes" || picked === "xp_dia" || (picked && STAT_MODES[picked])) {
                    viewKey = picked
                    pickerMode = null
                } else if (picked === "xp") {
                    viewKey = "xp"
                    menuGroup = null
                    pickerMode = null
                }
                if (tenureNeedsLoading) await updateTenureLoading(button)
                if (viewKey === "antiguedad") await loadTenureMembers()
                rankings = buildViewRankings(viewKey)
                pageNumber = 1
                totalPages = Math.max(1, Math.ceil(rankings.length / pageSize))
            }

            // Las categorías solo cambian el selector: una sola actualización
            // responde y edita la interacción, sin una segunda llamada.
            if (onlyChangesPicker) {
                await updatePage(pageNumber, button)
                return
            }

            // Se edita via el boton (token fresco en cada pulsacion): el token
            // de la interaccion original caduca y con int.editReply los botones
            // dejaban de responder al rato.
            await sendPage(pageNumber, button)
        } catch (error) {
            try {
                await editMessagePage(pageNumber)
            } catch (fallbackError) {
                console.warn(`Could not update top board for ${int.guild?.id}:`, fallbackError.message || error.message)
            }
        } finally {
            buttonPressed = false
        }
    })
    collector.on("end", async () => {
        // Pasadas 24h los botones se desactivan. Se edita via message.edit
        // (token de bot, sin caducidad) porque el de la interaccion ya expiro.
        try {
            const { container, pageUserIds } = await buildContainer(pageNumber, true)
            await message.edit({
                components: [container],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                allowedMentions: { users: pageUserIds, parse: [] },
            })
        } catch {}
    })

}}

// Helpers expuestos para tests/verificación (el loader solo usa .metadata).
module.exports.estimateVisualWidth = estimateVisualWidth
module.exports.fitLine = fitLine
module.exports.fitMonthlyLine = fitMonthlyLine
module.exports.globalMessageVariants = globalMessageVariants
module.exports.monthlyMessageVariants = monthlyMessageVariants
module.exports.dailyMessageVariants = dailyMessageVariants
module.exports.statLineVariants = statLineVariants
module.exports.STAT_MODES = STAT_MODES
module.exports.statUnit = statUnit
module.exports.buildStatEntryLine = buildStatEntryLine
module.exports.topVoiceText = topVoiceText
module.exports.topVoiceTextShort = topVoiceTextShort
module.exports.topVoiceTextCompact = topVoiceTextCompact
module.exports.topTenureText = topTenureText
module.exports.topTenureTextShort = topTenureTextShort
module.exports.topTenureVariants = topTenureVariants
module.exports.TOP_STAT_LINE_WIDTH = TOP_STAT_LINE_WIDTH
module.exports.buildViewMenu = buildViewMenu
module.exports.VIEW_MODES = VIEW_MODES
module.exports.VIEW_GROUPS = VIEW_GROUPS
module.exports.monthlyMessageVariants = monthlyMessageVariants