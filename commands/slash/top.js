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
    if ("ijl".includes(ch)) return 0.55
    if ("tf".includes(ch)) return 0.7
    if ("mw".includes(ch)) return 1.4
    if ("MW".includes(ch)) return 1.45
    return 1
}

function estimateVisualWidth(text) {
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
// ordenar + unidad para pintar. Sin antigüedad: vive en el miembro de
// Discord, no en la DB, y rankear exigiría descargar el servidor entero.
function statNumber(raw) {
    if (raw == null) return 0
    if (typeof raw === "object") return Number(raw.current ?? raw.days) || 0
    return Number(raw) || 0
}

function statChannelCount(raw) {
    if (raw == null) return 0
    if (typeof raw === "number") return raw
    if (raw instanceof Set || raw instanceof Map) return raw.size
    if (Array.isArray(raw)) return raw.length
    if (typeof raw === "object") return Object.keys(raw).length
    return 0
}

const STAT_MODES = {
    mensajes: {
        menuEmoji: "💬", label: "Mensajes", title: "Top de mensajes",
        unit: "mensajes", abbr: "msjs", emoji: "<:messages:1467163578699354235>",
        one: "mensaje", get: u => Number(u.messages) || 0,
    },
    mensajes_mes: {
        menuEmoji: "📅", label: "Mensajes del mes", title: "Top de mensajes del mes",
        unit: "mensajes este mes", abbr: "msgs mes", emoji: "<:messages:1467163578699354235>",
        one: "mensaje este mes", get: u => Number(u.monthlyMessages) || 0,
    },
    mensajes_dia: {
        menuEmoji: "☀️", label: "Mensajes del día", title: "Top de mensajes del día",
        unit: "mensajes hoy", abbr: "msgs hoy", emoji: "☀️",
        one: "mensaje hoy", get: u => Number(u.dailyMessages) || 0,
    },
    reacciones_enviadas: {
        menuEmoji: "❤️", label: "Reacciones enviadas", title: "Top de reacciones enviadas",
        unit: "reacciones enviadas", abbr: "reacciones", emoji: "❤️",
        one: "reacción enviada", get: u => Number(u.reactionsSent) || 0,
    },
    reacciones_recibidas: {
        menuEmoji: "💘", label: "Reacciones recibidas", title: "Top de reacciones recibidas",
        unit: "reacciones recibidas", abbr: "reacciones", emoji: "💘",
        one: "reacción recibida", get: u => Number(u.reactionsReceived) || 0,
    },
    racha: {
        menuEmoji: "🔥", label: "Racha actual", title: "Top de racha actual",
        unit: "días de racha", abbr: "días", emoji: "🔥",
        one: "día de racha", get: u => statNumber(u.streak),
    },
    racha_max: {
        menuEmoji: "🏆", label: "Racha máxima", title: "Top de racha máxima",
        unit: "días de racha máx.", abbr: "días", emoji: "🏆",
        one: "día de racha máx.", get: u => {
            const raw = u.streak
            if (raw == null) return 0
            if (typeof raw === "object") return Number(raw.max ?? raw.maximum ?? raw.best ?? raw.current ?? raw.days) || 0
            return Number(raw) || 0
        },
    },
    canales: {
        menuEmoji: "🧭", label: "Canales", title: "Top de canales",
        unit: "canales", abbr: "can.", emoji: "🧭",
        one: "canal", get: u => statChannelCount(u.channels),
    },
    counting: {
        menuEmoji: "🔢", label: "Counting", title: "Top de counting",
        unit: "números", abbr: "núms.", emoji: "🔢",
        one: "número", get: u => Number(u.countingSent) || 0,
    },
    voz: {
        menuEmoji: "🎙️", label: "Voz", title: "Top de voz",
        unit: "min en voz", abbr: "min", emoji: "🎙️",
        one: "min en voz", get: u => Number(u.voiceMinutes) || 0,
    },
}

function statUnit(mode, value) {
    if (Number(value) === 1 && mode.one) return mode.one
    return mode.unit
}

// Un solo control para cambiar de vista: XP total, XP del mes, XP del día
// y una entrada por estadística (testeable sin interacción).
const VIEW_MODES = [
    { value: "xp", label: "XP total", menuEmoji: "📊" },
    { value: "xp_mes", label: "XP del mes", menuEmoji: "🗓️" },
    { value: "xp_dia", label: "XP del día", menuEmoji: "✨" },
]

function buildViewMenu(viewKey, disabled = false) {
    return new StringSelectMenuBuilder()
        .setCustomId("top-view")
        .setPlaceholder("Ver top por…")
        .setDisabled(disabled)
        .addOptions(
            ...VIEW_MODES.map(v =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(v.label).setValue(v.value).setEmoji(v.menuEmoji).setDefault(viewKey === v.value)),
            ...Object.entries(STAT_MODES).map(([key, mode]) =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(mode.label).setValue(key).setEmoji(mode.menuEmoji).setDefault(viewKey === key))
        )
}

module.exports = {
metadata: {
    name: "top",
    description: "View the server's XP leaderboard.",
    args: [
        { type: "user", name: "member", description: "Finds a certain member's position on the leaderboard", required: false },
        { type: "bool", name: "monthly", description: "Show this month's most active members", required: false }
    ]
},

async run(client, int, tools) {
    let lbLink = `${tools.WEBSITE}/leaderboard/${int.guild.id}`

    let db = await tools.fetchAll()
    if (!db) return tools.warn(`Nobody in this server is ranked yet!`)
    else if (!db.settings.enabled) return tools.warn("*xpDisabled")
    else if (db.settings.leaderboard.disabled) return tools.warn("The leaderboard is disabled in this server!" + (tools.canManageServer(int.member) ? `\nAs a moderator, you can still privately view the leaderboard here: ${lbLink}` : ""))

    if (client.monthlyMaintenance) {
        client.monthlyMaintenance(int.guild, db).catch(error => {
            console.warn(`Could not update monthly leaderboard for ${int.guild.id}:`, error.message)
        })
    }

    let pageSize = 8
    let viewKey = int.options.get("monthly")?.value ? "xp_mes" : "xp"

    let minLeaderboardXP = db.settings.leaderboard.minLevel > 1 ? tools.xpForLevel(db.settings.leaderboard.minLevel, db.settings) : 0
    const hasLeaderboardLevel = userData => Number(userData?.xp) > 0 && tools.getLevel(Number(userData.xp), db.settings) > 0
    const buildRankings = isMonthly => tools.xpObjToArray(db.users || {})
        .filter(x => hasLeaderboardLevel(x) && !x.hidden && (isMonthly ? tools.getMonthlyXP(x) > 0 : Number(x.xp) > minLeaderboardXP))
        .sort((a, b) => isMonthly
            ? tools.getMonthlyXP(b) - tools.getMonthlyXP(a)
                || tools.getMonthlyMessages(b) - tools.getMonthlyMessages(a)
                || b.xp - a.xp
            : b.xp - a.xp)
    let rankings = buildRankings(false)

    // El botón rota global -> mensual -> diario. El diario ordena por XP del
    // día (desempate por mensajes del día y luego XP total, como el mensual).
    const buildDailyRankings = () => tools.xpObjToArray(db.users || {})
        .filter(x => hasLeaderboardLevel(x) && !x.hidden && tools.getDailyXP(x) > 0)
        .sort((a, b) => tools.getDailyXP(b) - tools.getDailyXP(a)
            || tools.getDailyMessages(b) - tools.getDailyMessages(a)
            || b.xp - a.xp)

    const buildStatRankings = key => {
        const mode = STAT_MODES[key]
        if (!mode) return []
        return tools.xpObjToArray(db.users || {})
            .filter(x => hasLeaderboardLevel(x) && !x.hidden && mode.get(x) > 0)
            .sort((a, b) => mode.get(b) - mode.get(a) || b.xp - a.xp)
    }

    const buildViewRankings = key => {
        if (key === "xp_mes") return buildRankings(true)
        if (key === "xp_dia") return buildDailyRankings()
        if (key && STAT_MODES[key]) return buildStatRankings(key)
        return buildRankings(false)
    }

    rankings = buildViewRankings(viewKey)

    let totalPages = Math.max(1, Math.ceil(rankings.length / pageSize))
    let pageNumber = 1

    let highlight = null
    let userSearch = int.options.get("user") || int.options.get("member") // option is "user" if from context menu
    if (userSearch) {
        let foundRanking = rankings.findIndex(x => x.id == userSearch.user.id)
        if (isNaN(foundRanking) || foundRanking < 0) return tools.warn(int.user.id == userSearch.user.id ? "No estas en el top!" : "Este miembro no esta en el top!")
        else pageNumber = Math.floor(foundRanking / pageSize) + 1
        highlight = userSearch.user.id
    }

    let isHidden = db.settings.leaderboard.ephemeral

    const configuredColor = db.settings.leaderboard.embedColor
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
        const pageData = rankings.slice((page - 1) * pageSize, page * pageSize)
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
            const monthlyMessages = tools.commafy(tools.getMonthlyMessages(entry))
            const monthlyXP = tools.commafy(tools.getMonthlyXP(entry))
            const dailyMessages = tools.commafy(tools.getDailyMessages(entry))
            const dailyXP = tools.commafy(tools.getDailyXP(entry))
            const statValue = statMode ? statMode.get(entry) : 0
            const member = resolvedMembers.get(userId)
            const user = member?.user || client.users.cache.get(userId)
            const displayName = member?.displayName || user?.globalName || user?.username
            const memberDisplay = member
                ? `<@${userId}>`
                : `<@${userId}>  <:no_en_el_server:1549908584555347988>`
            const searchedMemberName = displayName || "Miembro"
            const memberMarker = isHighlighted && !isRequester
                ? `  <:member:1467596629787021415>** ${searchedMemberName || "Miembro"}**`
                : isRequester
                    ? "  <:member:1467596629787021415> **Tú**"
                    : ""
            entryComponents.push(new TextDisplayBuilder().setContent([
                `${rankRole?.emoji || "<:top:1467967277251956887>"} **#${position} - Nivel ${level} - ${memberDisplay}**${memberMarker}`,
                statMode
                    ? fitLine(...statLineVariants(statMode.emoji, tools.commafy(statValue), statUnit(statMode, statValue), statMode.abbr))
                    : viewKey === "xp_dia"
                    ? fitMonthlyLine(...dailyMessageVariants(dailyMessages, dailyXP))
                    : viewKey === "xp_mes"
                    ? fitMonthlyLine(...monthlyMessageVariants(monthlyMessages, monthlyXP))
                    : fitLine(...globalMessageVariants(totalMessages, monthlyMessages))
            ].join("\n")))

            if (index < pageData.length - 1) {
                entryComponents.push(new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small))
            }
        })

        if (!pageData.length) {
            entryComponents.push(new TextDisplayBuilder().setContent("*Aún no hay miembros en este top.*"))
        }

        const previousPage = page <= 1 ? totalPages : page - 1
        const nextPage = page >= totalPages ? 1 : page + 1
        const firstMember = (page - 1) * pageSize + 1
        const lastMember = Math.min(page * pageSize, rankings.length)
        const memberRange = rankings.length ? `Miembros **${firstMember}-${lastMember}** de **${rankings.length}**` : "**0 miembros**"
        const canNavigate = rankings.length > pageSize
        const viewMenu = buildViewMenu(viewKey, disabled)
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

        const container = new ContainerBuilder()
            .setAccentColor(pageAccentColor || tools.COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `# <:top:1467967277251956887> ${statMode ? statMode.title : viewKey === "xp_dia" ? "Top diario" : viewKey === "xp_mes" ? `Top de ${getCurrentSpanishMonth().charAt(0).toUpperCase() + getCurrentSpanishMonth().slice(1)}` : "Top"} de ${int.guild.name}`
            ].join("\n")))

        container.addSeparatorComponents(new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small))

        entryComponents.forEach(component => {
            if (component instanceof SeparatorBuilder) container.addSeparatorComponents(component)
            else container.addTextDisplayComponents(component)
        })

        return {
            container: container
                .addSeparatorComponents(new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `-# Página **${page}** de **${totalPages}**  -  ${memberRange}`))
                .addActionRowComponents(new ActionRowBuilder().addComponents(navigation))
                .addActionRowComponents(new ActionRowBuilder().addComponents(viewMenu)),
            pageUserIds
        }
    }

    if (pageNumber < 1 || pageNumber > totalPages) return tools.warn("There are no members on this page!")

    await int.deferReply({
        flags: MessageFlags.IsComponentsV2 | (isHidden ? MessageFlags.Ephemeral : 0)
    })

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

    await sendPage(pageNumber, int)
    const message = await int.fetchReply()

    let buttonPressed = false
    const collector = message.createMessageComponentCollector({ time: 24 * 60 * 60 * 1000 })
    collector.on("collect", async button => {
        if (button.user.id !== int.user.id) return tools.buttonReply(button)
        if (buttonPressed) return

        buttonPressed = true
        try {
            await button.deferUpdate()

            if (button.customId === "top-prev") pageNumber = pageNumber <= 1 ? totalPages : pageNumber - 1
            if (button.customId === "top-next") pageNumber = pageNumber >= totalPages ? 1 : pageNumber + 1
            if (button.isStringSelectMenu?.() && button.customId === "top-view") {
                const picked = button.values?.[0]
                viewKey = picked === "xp_mes" || picked === "xp_dia" || (picked && STAT_MODES[picked]) ? picked : "xp"
                rankings = buildViewRankings(viewKey)
                pageNumber = 1
                totalPages = Math.max(1, Math.ceil(rankings.length / pageSize))
            }

            // Se edita via el boton (token fresco en cada pulsacion): el token
            // de la interaccion original caduca y con int.editReply los botones
            // dejaban de responder al rato.
            await sendPage(pageNumber, button)
        } catch (error) {
            console.warn(`Could not update top board for ${int.guild?.id}:`, error.message)
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
module.exports.buildViewMenu = buildViewMenu
module.exports.VIEW_MODES = VIEW_MODES
module.exports.monthlyMessageVariants = monthlyMessageVariants