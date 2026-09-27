const {
    ActionRowBuilder,
    ContainerBuilder,
    MessageFlags,
    SectionBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ThumbnailBuilder,
} = require("discord.js")
const path = require("path")
const fs = require("fs")
const Tools = require("../../classes/Tools.js")
const ranks = require("../../consts/ranks.js")
const records = require("../../config/records.js")
const { estimateVisualWidth } = require("./top.js")

const XP_EMOJI = "<:XP:1467192533812645939>"
const INFO_EMOJI = "ℹ️"
const INFO_ID = "stats"
// Banner del rango del usuario (como /rank) + su avatar: son sus stats.
// Cada página lleva su color de acento.
const ACCENTS = {
    stats: 0xe6c036,
    actividad: 0x4aa8ff,
    comunidad: 0xff6b4a,
    canales: 0x3ddc84,
    voz: 0x9b7bff,
    hidden: 0x8a8f98,
}
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000

// Páginas en el orden de config/records.js (la última es ocultos).
const PAGES = records.categories.map(c => c.id)

// Rango del usuario por su rol de nivel (igual que /rank): banner y color
// vienen de consts/ranks.js. null si no tiene rango o falta el asset.
function resolveRank(xp, settings) {
    try {
        const levelData = Tools.global.getLevel(Number(xp) || 0, settings, true)
        const levelRoles = Tools.global.getRolesForLevel(levelData.level, settings?.rewards || [])
        const levelRole = levelRoles[0] || null
        const rank = (levelRole && ranks.find(r => r.roles.some(role => role.id === levelRole.id))) || null
        if (!rank?.banner?.url) return null
        const file = path.join(__dirname, "../../assets/banners/", rank.banner.url)
        if (!fs.existsSync(file)) return null
        return { rank, file }
    } catch {
        return null
    }
}

// Progreso real con datos que YA existen (mensajes, mensuales, antigüedad).
// null = esa mecánica aún no tiene datos. target = primer nivel no superado
// (o el último si los supera todos: la barra sale llena pero sin ✅).
function makeProgress(current, tiers, fmt) {
    const tier = tiers.find(t => t.threshold > current) || tiers[tiers.length - 1]
    const full = current >= tier.threshold
    return {
        tier,
        target: tier.threshold,
        frac: full ? 1 : current / tier.threshold,
        currentLabel: fmt(current),
        targetLabel: fmt(tier.threshold),
        full,
        completed: tiers.filter(t => t.threshold <= current).length,
    }
}

function getProgress(record, userData, member, commafy) {
    const type = record.mechanic.type
    if (type === "messages_total") {
        return makeProgress(Number(userData?.messages) || 0, record.tiers, v => commafy(v))
    }
    if (type === "messages_monthly") {
        return makeProgress(Number(userData?.monthlyMessages) || 0, record.tiers, v => commafy(v))
    }
    if (type === "messages_daily") {
        return makeProgress(Number(userData?.dailyMessages) || 0, record.tiers, v => commafy(v))
    }
    if (type === "member_tenure") {
        if (!member?.joinedTimestamp) return null
        const years = (Date.now() - member.joinedTimestamp) / MS_PER_YEAR
        const fmt1 = v => String(Math.round(v * 10) / 10).replace(".", ",")
        return makeProgress(years, record.tiers, fmt1)
    }
    if (type === "streak_days") {
        const raw = userData?.streak
        const current = raw == null ? 0
            : (typeof raw === "object" ? Number(raw.current ?? raw.days) || 0 : Number(raw) || 0)
        if (!current) return null
        return makeProgress(current, record.tiers, v => commafy(v))
    }
    if (type === "reactions_sent") {
        if (userData?.reactionsSent == null) return null
        return makeProgress(Number(userData.reactionsSent) || 0, record.tiers, v => commafy(v))
    }
    if (type === "reactions_received") {
        return makeProgress(Number(userData?.reactionsReceived) || 0, record.tiers, v => commafy(v))
    }
    if (type === "distinct_channels") {
        if (userData?.channels == null) return null
        const n = typeof userData.channels === "number" ? userData.channels
            : userData.channels instanceof Set || userData.channels instanceof Map ? userData.channels.size
            : Array.isArray(userData.channels) ? userData.channels.length
            : Object.keys(userData.channels).length
        return makeProgress(n, record.tiers, v => commafy(v))
    }
    if (type === "counting_numbers") {
        if (userData?.countingSent == null) return null
        return makeProgress(Number(userData.countingSent) || 0, record.tiers, v => commafy(v))
    }
    if (type === "voice_minutes") {
        // Umbrales en minutos, se muestran en horas (divisor 60) con un
        // decimal en español ("3,5/5 h"). La "h" la pone formatProgress.
        // Sin voz aún = 0 minutos (no null: el fallback de formatProgress
        // usaría el umbral en minutos y saldría "0/300 h").
        const toHours = m => m / 60
        const fmtHours = v => String(Math.round(v * 10) / 10).replace(".", ",")
        const minutes = Number(userData?.voiceMinutes) || 0
        const hourTiers = record.tiers.map(t => ({ ...t, threshold: toHours(t.threshold) }))
        return makeProgress(toHours(minutes), hourTiers, fmtHours)
    }
    if (type === "voice_join_all_fixed") {
        // Progreso real: fijos visitados de N (un solo tier de recompensa).
        // buildRecordBlock usa phasesTotal como denominador ("2/5 fases").
        const fixed = (record.mechanic.fixedChannelIds || []).map(String)
        const joined = new Set([].concat(userData?.voiceJoined || []).map(String))
        const visited = fixed.filter(id => joined.has(id)).length
        const total = Math.max(1, fixed.length)
        return {
            tier: record.tiers[0],
            target: total,
            frac: total ? visited / total : 0,
            currentLabel: commafy(visited),
            targetLabel: commafy(total),
            full: visited >= total,
            completed: Math.min(visited, total),
            phasesTotal: total,
        }
    }
    if (type === "economy_participation") {
        // Flag binario: si existe el flag, está completado; si no, es null (sin progreso numérico)
        const hasFlag = userData?.records?.["economy_participation:1"]
        if (hasFlag) return makeProgress(1, record.tiers, v => commafy(v))
        return null
    }
    return null
}

function countUnlocked(entries, unlockedIds) {
    return entries.reduce((sum, { record }) => sum + record.tiers.filter(t => unlockedIds.has(`${record.id}:${t.threshold}`)).length, 0)
}

// Los ocultos siempre cuentan en el total: 0/36 al empezar,
// 1/36 al completar el primero, 36/36 con todo.
function titleCounts(unlockedIds) {
    const doneVisible = countUnlocked(records.visibleRecords(), unlockedIds)
    const doneHidden = countUnlocked(records.hiddenRecords(), unlockedIds)
    return { done: doneVisible + doneHidden, total: records.countTiers(records.allRecords()) }
}

function buildTitle(unlockedIds) {
    const { done, total } = titleCounts(unlockedIds)
    return `# ${records.RECORDS_EMOJI} Mis Records (${done}/${total})`
}

function formatReward(tier, commafy) {
    const rewards = []
    if (tier.xp > 0) rewards.push(`${XP_EMOJI} **+${commafy(tier.xp)} XP**`)
    if (tier.roleId) rewards.push(`<@&${tier.roleId}>`)
    return rewards.join(" + ")
}

function compactProgressLabel(label) {
    const value = Number(String(label).replace(/\./g, "").replace(",", "."))
    if (!Number.isFinite(value) || Math.abs(value) < 1000) return label
    const divisor = Math.abs(value) >= 1000000 ? 1000000 : 1000
    const suffix = divisor === 1000000 ? "M" : "k"
    const compact = Math.round((value / divisor) * 10) / 10
    return `${String(compact).replace(".", ",")}${suffix}`
}

function formatProgress(record, progress, commafy, unitOverride) {
    const target = progress?.target ?? record.tiers[0]?.threshold ?? 0
    const current = compactProgressLabel(progress?.currentLabel ?? commafy(0))
    const targetLabel = compactProgressLabel(progress?.targetLabel ?? commafy(target))
    const unit = unitOverride
        ?? (record.unit === "horas" ? "h"
            : record.unit === "mensajes" ? "mensajes"
                : target === 1 && record.unitOne ? record.unitOne
                    : record.unit || (record.tiers.length === 1 ? "" : "fases"))
    return `📊 **${current}/${targetLabel}${unit ? ` ${unit}` : ""}**`
}

// Listón de ancho para las líneas pequeñas (-#): el mismo que usa el test
// de móvil y /top (MOBILE_LINE_WIDTH).
const PROGRESS_LINE_WIDTH = 37.9

// En récords de mensajes la unidad larga ("mensajes") puede saltar de línea
// en móvil con números grandes: si la línea completa supera el listón, se
// reescribe con "msgs" (como la cascada de /top con fitLine). Las menciones
// de rol se miden como "@rol", igual que en el test.
function fitProgressLine(record, progress, currentTier, commafy) {
    const reward = formatReward(currentTier, commafy)
    const full = `${formatProgress(record, progress, commafy)} - ${reward}`
    if (record.unit !== "mensajes") return full
    const rendered = `-# ${full}`.replace(/<@&\d+>/g, "@rol")
    if (estimateVisualWidth(rendered) <= PROGRESS_LINE_WIDTH) return full
    return `${formatProgress(record, progress, commafy, "msgs")} - ${reward}`
}

// Un bloque por logro con el render compartido del mensaje de desbloqueo:
// ### en una sola línea con guion (puede saltar en móvil), descripción
// citada y recompensa en pequeño. Sin línea de progreso por ahora.
// Solo se muestra el nivel actual (el siguiente a desbloquear).
function buildRecordBlock(record, unlockedIds, progress, commafy) {
    const tiers = record.tiers
    // Algunos récords miden el avance en fases propias (p. ej. Ruta completa:
    // 5 canales con un solo tier de recompensa).
    const total = progress?.phasesTotal ?? tiers.length
    let completed
    let currentTier
    if (progress) {
        if (progress.full) {
            completed = total
            currentTier = tiers[tiers.length - 1]
        } else {
            completed = progress.completed
            currentTier = progress.tier
        }
    } else {
        completed = tiers.filter(t => unlockedIds.has(`${record.id}:${t.threshold}`)).length
        currentTier = tiers[Math.min(completed, total - 1)]
    }

    const allDone = completed >= total
    const phaseWord = total === 1 ? "fase" : "fases"

    const lines = [allDone
        ? `### ~~${record.emoji} **${currentTier.name}** - ${completed}/${total} ${phaseWord}~~`
        : `### ${record.emoji} **${currentTier.name}** - ${completed}/${total} ${phaseWord}`]
    lines.push(allDone ? `> ~~${currentTier.desc}~~` : `> ${currentTier.desc}`)
    const binaryProgress = !progress && total === 1 && completed ? {
        currentLabel: commafy(1),
        target: 1,
        targetLabel: commafy(1),
    } : progress
    const progressLine = fitProgressLine(record, binaryProgress, currentTier, commafy)
    lines.push(allDone ? `-# ~~${progressLine}~~` : `-# ${progressLine}`)
    return lines.join("\n")
}

// Los completados van arriba; el resto por dificultad (el último umbral
// es la meta real del récord). Así se ve de un vistazo lo conseguido.
function sortRecordsByProgress(category, unlockedIds) {
    const isDone = r => r.tiers.every(t => unlockedIds.has(`${r.id}:${t.threshold}`))
    return [...category.records].sort((a, b) => {
        const ad = isDone(a) ? 0 : 1
        const bd = isDone(b) ? 0 : 1
        if (ad !== bd) return ad - bd
        const aDifficulty = a.tiers[a.tiers.length - 1]?.threshold || 0
        const bDifficulty = b.tiers[b.tiers.length - 1]?.threshold || 0
        return bDifficulty - aDifficulty
    })
}

function buildCategoryBlocks(category, userData, member, unlockedIds, commafy) {
    const blocks = [`## ${category.emoji} ${category.name}`]
    const sortedRecords = sortRecordsByProgress(category, unlockedIds)
    for (const record of sortedRecords) {
        blocks.push(buildRecordBlock(record, unlockedIds, getProgress(record, userData, member, commafy), commafy))
    }
    return blocks
}

function buildHiddenBlocks(hiddenCategory, unlockedIds, commafy, userData = {}, member = null) {
    // Sin cabecera: va pegado al título como las demás páginas (el contador
    // ya sale en el menú). Render idéntico al de un récord normal, pero con
    // UNA sola descripción misteriosa que no revela la condición, esté o no
    // desbloqueado (así lo descubierto tampoco filtra cómo se consigue).
    const blocks = []
    for (const record of hiddenCategory.records) {
        const masked = {
            ...record,
            tiers: record.tiers.map(tier => ({
                ...tier,
                desc: record.mystery || "Un secreto aún por descubrir…",
            })),
        }
        blocks.push(buildRecordBlock(masked, unlockedIds, getProgress(record, userData, member, commafy), commafy))
    }
    return blocks
}

function formatCount(value, singular, plural = singular === "mes" ? "meses" : `${singular}s`) {
    return `${value} ${value === 1 ? singular : plural}`
}

function formatVoiceTime(minutes) {
    const totalMinutes = Math.max(0, Math.floor(Number(minutes) || 0))
    const hours = Math.floor(totalMinutes / 60)
    const remainingMinutes = totalMinutes % 60
    if (!remainingMinutes) return formatCount(hours, "hora")
    if (!hours) return formatCount(remainingMinutes, "minuto")
    return `${formatCount(hours, "hora")} y ${formatCount(remainingMinutes, "minuto")}`
}

function getActiveVoiceMinutes(userData, member) {
    const channelId = member?.voice?.channelId
    const startedAt = Number(userData?.voiceStartedAt)
    if (!channelId || !startedAt) return 0
    const voiceRecord = records.allRecords().find(({ record }) => record.id === "voice_time")?.record
    if (voiceRecord?.mechanic?.excludedChannelIds?.some(id => String(id) === String(channelId))) return 0
    // Cuenta en solitario: basta con estar en un canal válido.
    return Math.floor(Math.min(Date.now() - startedAt, 12 * 60 * 60 * 1000) / 60000)
}

function formatTenure(joinedTimestamp, now = Date.now()) {
    const joined = new Date(joinedTimestamp)
    const current = new Date(now)
    if (!Number.isFinite(joined.getTime()) || joined > current) return formatCount(0, "día")

    let years = current.getFullYear() - joined.getFullYear()
    let anniversary = new Date(joined)
    anniversary.setFullYear(joined.getFullYear() + years)
    if (anniversary > current) {
        years--
        anniversary = new Date(joined)
        anniversary.setFullYear(joined.getFullYear() + years)
    }

    let months = current.getMonth() - anniversary.getMonth()
    if (months < 0) months += 12
    const monthiversary = new Date(anniversary)
    monthiversary.setMonth(anniversary.getMonth() + months)
    if (monthiversary > current) {
        months--
        monthiversary.setMonth(anniversary.getMonth() + months)
    }

    const days = Math.max(0, Math.floor((current - monthiversary) / (24 * 3600 * 1000)))
    const parts = []
    if (years) parts.push(formatCount(years, "año"))
    if (months) parts.push(formatCount(months, "mes"))
    if (days || !parts.length) parts.push(formatCount(days, "día"))
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`
}

// Página Estadísticas: valores útiles incluso cuando todavía están a cero.
function buildInfoTexts(userData, member, unlockedIds, tools) {
    const show = v => tools.commafy(Number(v) || 0)
    const msgs = show(tools.getMessages(userData))
    const monthlyMsgs = show(tools.getMonthlyMessages(userData))
    const streakRaw = userData?.streak
    const streakDays = typeof streakRaw === "object" ? Number(streakRaw?.current ?? streakRaw?.days) || 0 : Number(streakRaw) || 0
    const streakMax = typeof streakRaw === "object"
        ? Number(streakRaw?.max ?? streakRaw?.maximum ?? streakRaw?.best) || streakDays
        : streakDays
    const streak = `${show(streakDays)} días`
    const maxStreak = `${show(streakMax)} días`
    const voice = formatVoiceTime(Number(userData?.voiceMinutes) + getActiveVoiceMinutes(userData, member))
    const tenure = member?.joinedTimestamp ? formatTenure(member.joinedTimestamp) : formatCount(0, "día")
    // "msgs" en corto: con "mensajes" estas líneas saltan en móvil (listón 31).
    const groups = [
        [
            `### 💬 Actividad`,
            `- <:messages:1467163578699354235> **Mensajes totales:** ${msgs} msgs`,
            `- 📅 **Mensajes este mes:** ${monthlyMsgs} msgs`,
            `- ☀️ **Mensajes diarios:** ${show(Number(userData?.dailyMessages) || 0)} msgs`,
        ].join("\n"),
        [
            `### 🤝 Comunidad`,
            `- ❤️ **Reacciones enviadas:** ${show(userData?.reactionsSent)}`,
            `- 💘 **Reacciones recibidas:** ${show(userData?.reactionsReceived)}`,
            `- 🔥 **Racha actual:** ${streak}`,
            `- 🏆 **Racha máxima:** ${maxStreak}`,
            `- 🏅 **Antigüedad:** ${tenure}`,
        ].join("\n"),
        [
            `### 🧭 Canales`,
            `- 🔢 **Counting:** ${show(userData?.countingSent)} números`,
        ].join("\n"),
        [
            `### 🎙️ Voz`,
            `- 🎙️ **Tiempo en voz:** ${voice}`,
        ].join("\n"),
    ]
    const help = [
        `-# Completa fases y gana XP extra.`,
        `-# Ves tu siguiente nivel, con progreso real.`,
        `-# Los ocultos se revelan solos.`,
    ]
    return [groups, help.join("\n")]
}

// Un menú desplegable por categoría, con sus completados, su descripción y
// la posición (Página x/y) para orientarse. Estadísticas va primera.
function buildCatSelect(currentId, unlockedIds, disabled = false) {
    const order = [INFO_ID, ...PAGES]
    const position = Math.max(0, order.indexOf(currentId))
    const options = [
        new StringSelectMenuOptionBuilder()
            .setLabel("Estadísticas")
            .setValue(INFO_ID)
            .setDescription("Tus números de actividad, comunidad y voz.")
            .setEmoji(INFO_EMOJI)
            .setDefault(currentId === INFO_ID),
        ...records.categories.map(category => {
            const total = category.records.reduce((sum, r) => sum + r.tiers.length, 0)
            const done = category.records.reduce((sum, r) => sum + r.tiers.filter(t => unlockedIds.has(`${r.id}:${t.threshold}`)).length, 0)
            return new StringSelectMenuOptionBuilder()
                .setLabel(`${category.name} (${done}/${total})`)
                .setValue(category.id)
                .setDescription(category.desc)
                .setEmoji(category.menuEmoji || category.emoji)
                .setDefault(category.id === currentId)
        }),
    ]
    return new StringSelectMenuBuilder()
        .setCustomId("records-cat")
        .setPlaceholder(`Página ${position + 1}/${order.length} · Elige una categoría`)
        .setDisabled(disabled)
        .addOptions(options)
}

module.exports = {
metadata: {
    name: "records",
    description: "View your server Records (achievements).",
    args: [
        { type: "user", name: "member", description: "Which member to inspect", required: false },
    ],
},

async run(client, int, tools) {
    // Los bots no tienen XP: respuesta efímera antes del defer (después
    // ya no se puede hacer efímero).
    if (tools.getTargetUser()?.bot) return int.reply({ content: tools.errors.noBotView, ephemeral: true })
    await int.deferReply({ flags: MessageFlags.IsComponentsV2 })
    const targetMember = int.options.get("user") || int.options.get("member")
    const member = targetMember?.member || int.member
    const memberId = member?.id || int.user.id

    let db = await tools.fetchSettings(memberId)
    if (!db) return tools.warn("*noData")
    else if (!db.settings.enabled) return tools.warn("*xpDisabled")

    const userData = { ...(db.users?.[memberId] || {}) }
    const madridDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date())
    if (db.info?.dailyMessagesPeriod && db.info.dailyMessagesPeriod !== madridDay) {
        userData.dailyMessages = 0
    }
    const unlockedIds = new Set(Object.keys(userData.records || {}))
    const order = [INFO_ID, ...PAGES]
    let pageNumber = 0 // Estadísticas primero

    const buildContainer = (page, member, disabled = false) => {
        const id = order[page]
        const container = new ContainerBuilder().setAccentColor(ACCENTS[id] ?? ACCENTS.stats)

        const category = id !== INFO_ID ? records.categories.find(c => c.id === id) : null
        const statGroups = id === INFO_ID ? buildInfoTexts(userData, member, unlockedIds, tools)[0] : null
        const pageBlocks = category
            ? (category.hidden
                ? buildHiddenBlocks(category, unlockedIds, tools.commafy, userData, member)
                : buildCategoryBlocks(category, userData, member, unlockedIds, tools.commafy))
            : null
        // Sin cabecera de categoría (salvo ocultos, que ya vienen sin ella):
        // el primer récord (pageBlocks[1]) va pegado al título en el mismo
        // TextDisplay. En stats el nombre de la primera categoría va pegado
        // al título (sin separador encima) y todo lo demás lleva
        // separadores como en el resto de grupos.
        const categoryIntro = pageBlocks
            ? (category.hidden ? pageBlocks[0] : pageBlocks[1])
            : null
        const firstHeading = statGroups ? statGroups[0].split("\n")[0] : null
        const titleContent = [
            buildTitle(unlockedIds),
            firstHeading ?? categoryIntro,
        ].filter(Boolean).join("\n\n")
        const titleText = new TextDisplayBuilder().setContent(titleContent)
        const avatarUrl = typeof member?.displayAvatarURL === "function" ? member.displayAvatarURL() : ""
        if (avatarUrl) {
            container.addSectionComponents(new SectionBuilder()
                .addTextDisplayComponents(titleText)
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: avatarUrl } })))
        } else {
            container.addTextDisplayComponents(titleText)
        }
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))

        if (id === INFO_ID) {
            // La cabecera de Actividad ya va en el título: aquí solo sus
            // stats; el resto de grupos con cabecera, separador, stats y
            // separador, como siempre.
            statGroups.forEach((group, index) => {
                const [heading, ...stats] = group.split("\n")
                if (index > 0) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(heading))
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(stats.join("\n")))
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            })
        } else {
            // El título y el primer bloque comparten TextDisplay y cada bloque
            // queda separado por su propio divisor, incluido el final: misma
            // lógica en todas las páginas (/top ya envía containers mayores).
            const texts = category.hidden ? pageBlocks.slice(1) : pageBlocks.slice(2)
            for (const text of texts) {
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            }
        }
        container.addActionRowComponents(new ActionRowBuilder().addComponents(buildCatSelect(id, unlockedIds, disabled)))
        return { container }
    }

    // La mención de la IA en Test de Turing no debe pinguear: sin menciones.
    const noPings = { parse: [] }
    const sendPage = async (page, editor, member, disabled = false) => {
        const { container } = buildContainer(page, member, disabled)
        await editor.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
            allowedMentions: noPings,
        })
    }

    await sendPage(pageNumber, int, member)
    const message = await int.fetchReply()

    let buttonPressed = false
    const collector = message.createMessageComponentCollector({ time: 24 * 60 * 60 * 1000 })
    collector.on("collect", async interaction => {
        if (interaction.user.id !== int.user.id) {
            return interaction.reply({
                content: `Este menú es de otra persona. Usa ${tools.commandTag("records")} para ver tus Records.`,
                ephemeral: true,
            }).catch(() => {})
        }
        if (!interaction.isStringSelectMenu()) return tools.buttonReply(interaction)
        if (buttonPressed) return
        buttonPressed = true
        try {
            await interaction.deferUpdate()
            const target = order.indexOf(interaction.values?.[0])
            if (target !== -1) pageNumber = target
            await sendPage(pageNumber, interaction, interaction.member || member)
        } catch (error) {
            console.warn(`Could not update records board for ${int.guild?.id}:`, error.message)
        } finally {
            buttonPressed = false
        }
    })
    collector.on("end", async () => {
        try {
            const { container } = buildContainer(pageNumber, member, true)
            await message.edit({
                components: [container],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                allowedMentions: noPings,
            })
        } catch {}
    })
}}

// Para tests (el loader solo usa .metadata).
module.exports.getProgress = getProgress
module.exports.resolveRank = resolveRank
module.exports.titleCounts = titleCounts
module.exports.buildTitle = buildTitle
module.exports.formatReward = formatReward
module.exports.formatProgress = formatProgress
module.exports.fitProgressLine = fitProgressLine
module.exports.PROGRESS_LINE_WIDTH = PROGRESS_LINE_WIDTH
module.exports.buildRecordBlock = buildRecordBlock
module.exports.buildCategoryBlocks = buildCategoryBlocks
module.exports.buildHiddenBlocks = buildHiddenBlocks
module.exports.buildCatSelect = buildCatSelect
module.exports.buildInfoTexts = buildInfoTexts
module.exports.ACCENTS = ACCENTS
module.exports.INFO_ID = INFO_ID
module.exports.INFO_EMOJI = INFO_EMOJI
module.exports.INFO_EMOJI = INFO_EMOJI
module.exports.PAGES = PAGES