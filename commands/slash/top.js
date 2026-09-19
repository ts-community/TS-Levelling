const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
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
    let monthlyMode = !!int.options.get("monthly")?.value

    let minLeaderboardXP = db.settings.leaderboard.minLevel > 1 ? tools.xpForLevel(db.settings.leaderboard.minLevel, db.settings) : 0
    const hasLeaderboardLevel = userData => Number(userData?.xp) > 0 && tools.getLevel(Number(userData.xp), db.settings) > 0
    const buildRankings = isMonthly => tools.xpObjToArray(db.users || {})
        .filter(x => hasLeaderboardLevel(x) && !x.hidden && (isMonthly ? tools.getMonthlyXP(x) > 0 : Number(x.xp) > minLeaderboardXP))
        .sort((a, b) => isMonthly
            ? tools.getMonthlyXP(b) - tools.getMonthlyXP(a)
                || tools.getMonthlyMessages(b) - tools.getMonthlyMessages(a)
                || b.xp - a.xp
            : b.xp - a.xp)
    let rankings = buildRankings(monthlyMode)

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
        const pageAccentColor = monthlyMode
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
                monthlyMode
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
            new ButtonBuilder()
                .setCustomId("top-toggle")
                .setLabel(monthlyMode ? "Cambiar a top global" : "Cambiar a top mensual")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled),
        ]

        const container = new ContainerBuilder()
            .setAccentColor(pageAccentColor || tools.COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `# <:top:1467967277251956887> ${monthlyMode ? `Top de ${getCurrentSpanishMonth().charAt(0).toUpperCase() + getCurrentSpanishMonth().slice(1)}` : "Top"} de ${int.guild.name}`
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
                .addActionRowComponents(new ActionRowBuilder().addComponents(navigation)),
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
            if (button.customId === "top-toggle") {
                monthlyMode = !monthlyMode
                rankings = buildRankings(monthlyMode)
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