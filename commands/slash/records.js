const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
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
const INFO_BUTTON_ID = "records-info"
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
    const shown = full ? tier.threshold : current
    return {
        tier,
        target: tier.threshold,
        frac: full ? 1 : current / tier.threshold,
        currentLabel: fmt(shown),
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
        if (userData?.voiceMinutes == null) return null
        // Umbrales en minutos, se muestran en horas (divisor 60).
        const toHours = m => m / 60
        const minutes = Number(userData.voiceMinutes) || 0
        const hourTiers = record.tiers.map(t => ({ ...t, threshold: toHours(t.threshold) }))
        return makeProgress(toHours(minutes), hourTiers, v => `${commafy(v)}h`)
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

// Un bloque por logro con el render compartido del mensaje de desbloqueo:
// ### en una sola línea con guion (puede saltar en móvil), descripción
// citada y recompensa en pequeño. Sin línea de progreso por ahora.
// Solo se muestra el nivel actual (el siguiente a desbloquear).
function buildRecordBlock(record, unlockedIds, progress, commafy) {
    const tiers = record.tiers
    const total = tiers.length
    let completed
    let currentTier
    if (progress) {
        if (progress.full) {
            completed = total
            currentTier = tiers[total - 1]
        } else {
            completed = progress.completed
            currentTier = progress.tier
        }
    } else {
        completed = tiers.filter(t => unlockedIds.has(`${record.id}:${t.threshold}`)).length
        currentTier = tiers[Math.min(completed, total - 1)]
    }

    const allDone = completed >= total

    const lines = [allDone
        ? `### ~~${record.emoji} **${currentTier.name}** - ${completed}/${total} fases~~`
        : `### ${record.emoji} **${currentTier.name}** - ${completed}/${total} fases`]
    lines.push(allDone ? `> ~~${currentTier.desc}~~` : `> ${currentTier.desc}`)
    lines.push(allDone
        ? `-# ~~${formatReward(currentTier, commafy)}~~`
        : `-# ${formatReward(currentTier, commafy)}`)
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

function buildHiddenBlocks(hiddenCategory, unlockedIds, commafy) {
    // Sin cabecera: va pegado al título como las demás páginas (el contador
    // ya sale en el menú). Lo no descubierto muestra su propio misterio
    // (uno por Record, sin filtrar nada); lo descubierto, el render completo
    // con nombre y recompensa pero descripción sustituida por misterio.
    // Un bloque por nivel para separarlos como en las demás páginas.
    const blocks = []
    for (const record of hiddenCategory.records) {
        const total = record.tiers.length
        const completed = record.tiers.filter(t => unlockedIds.has(`${record.id}:${t.threshold}`)).length
        for (const tier of record.tiers) {
            const key = `${record.id}:${tier.threshold}`
            if (!unlockedIds.has(key)) {
                blocks.push(`-# 🔍 *${record.mystery || "Un secreto aún por descubrir…"}*`)
                continue
            }
            blocks.push([
                `### ${record.emoji} **${tier.name}** - ${completed}/${total} fases`,
                `-# ❓ *El secreto sigue a salvo…*`,
                `-# ${formatReward(tier, commafy)}`,
            ].join("\n"))
        }
    }
    return blocks
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
    const channelsRaw = userData?.channels
    const channels = show(typeof channelsRaw === "number" ? channelsRaw
            : channelsRaw instanceof Set || channelsRaw instanceof Map ? channelsRaw.size
            : Array.isArray(channelsRaw) ? channelsRaw.length
            : channelsRaw ? Object.keys(channelsRaw).length : 0)
    const voiceHours = Math.floor((Number(userData?.voiceMinutes) || 0) / 60)
    const voice = `${show(voiceHours)}h`
    let tenure = "0 días"
    if (member?.joinedTimestamp) {
        const days = Math.max(0, Math.floor((Date.now() - member.joinedTimestamp) / (24 * 3600 * 1000)))
        tenure = `${show(days)} días`
    }
    const groups = [
        [
            `### 💬 Actividad`,
            `<:messages:1467163578699354235> **Mensajes totales:** ${msgs}`,
            `📅 **Mensajes este mes:** ${monthlyMsgs}`,
            `☀️ **Mensajes hoy:** ${show(Number(userData?.dailyMessages) || 0)}`,
        ].join("\n"),
        [
            `### 🤝 Comunidad`,
            `❤️ **Reacciones enviadas:** ${show(userData?.reactionsSent)}`,
            `💘 **Reacciones recibidas:** ${show(userData?.reactionsReceived)}`,
            `🔥 **Racha actual:** ${streak}`,
            `🏆 **Racha máxima:** ${maxStreak}`,
            `🏅 **Antigüedad servidor:** ${tenure}`,
        ].join("\n"),
        [
            `### 🧭 Canales`,
            `🧭 **Canales con mensajes:** ${channels}`,
            `🔢 **Números en Counting:** ${show(userData?.countingSent)}`,
        ].join("\n"),
        [
            `### 🎙️ Voz`,
            `🎙️ **Tiempo en voz:** ${voice}`,
        ].join("\n"),
    ]
    const help = [
        `-# Completa fases y gana XP extra.`,
        `-# Ves tu siguiente nivel, con progreso real.`,
        `-# Los ocultos se revelan solos.`,
    ]
    return [groups, help.join("\n")]
}

// Detalle del botón de estadísticas en Components V2: qué son y cómo van.
// Devuelve los 4 bloques de texto (el contenedor los separa).
function buildInfoDetailBlocks(tools) {
    const totalXp = tools.commafy(records.totalXp(records.allRecords()))
    const tiers = records.countTiers(records.allRecords())
    return [
        `# ${records.RECORDS_EMOJI} ¿Qué son los Records?`,
        [
            `## 🎯 Cómo funcionan`,
            `-# Cada logro tiene fases con XP extra.`,
            `-# Siempre ves tu siguiente nivel.`,
            `-# Al completarlo, el XP se suma solo.`,
        ].join("\n"),
        [
            `## 🗂️ Las páginas`,
            `-# Stats, actividad, comunidad, canales y voz.`,
            `-# Los ocultos se revelan solos.`,
            `-# Hay **${totalXp} XP** en ${tiers} fases.`,
        ].join("\n"),
        `-# Muévete con el menú del mensaje.`,
    ]
}

function buildInfoContainer(tools) {
    const [title, how, pages, foot] = buildInfoDetailBlocks(tools)
    const container = new ContainerBuilder().setAccentColor(ACCENTS.stats)
    const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    const text = content => new TextDisplayBuilder().setContent(content)
    container.addTextDisplayComponents(text(title))
    container.addSeparatorComponents(sep())
    container.addTextDisplayComponents(text(how))
    container.addSeparatorComponents(sep())
    container.addTextDisplayComponents(text(pages))
    container.addSeparatorComponents(sep())
    container.addTextDisplayComponents(text(foot))
    return container
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
    const targetMember = int.options.get("user") || int.options.get("member")
    const member = targetMember?.member || int.member
    const memberId = member?.id || int.user.id

    let db = await tools.fetchAll()
    if (!db) return tools.warn("*noData")
    else if (!db.settings.enabled) return tools.warn("*xpDisabled")

    const userData = db.users?.[memberId] || {}
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
                ? buildHiddenBlocks(category, unlockedIds, tools.commafy)
                : buildCategoryBlocks(category, userData, member, unlockedIds, tools.commafy))
            : null
        // Sin cabecera de categoría (salvo ocultos, que ya vienen sin ella):
        // el primer récord (pageBlocks[1]) va pegado al título en el mismo
        // TextDisplay, como en el mensaje de nuevo Record. En stats el título
        // va solo: los grupos empiezan después del separador.
        const categoryIntro = pageBlocks
            ? (category.hidden ? pageBlocks[0] : pageBlocks[1])
            : null
        const titleContent = [
            buildTitle(unlockedIds),
            statGroups ? statGroups[0] : categoryIntro,
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
            // El primer grupo ya va pegado al título; el resto con
            // separadores. Sin ayuda ni botón.
            for (const text of statGroups.slice(1)) {
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            }
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

    await int.deferReply({ flags: MessageFlags.IsComponentsV2 })

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
        // Botón de ayuda: explicación en Components V2 y efímero.
        if (interaction.isButton()) {
            if (interaction.customId === INFO_BUTTON_ID) {
                return interaction.reply({
                    components: [buildInfoContainer(tools)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    allowedMentions: noPings,
                }).catch(() => {})
            }
            return tools.buttonReply(interaction)
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
module.exports.buildRecordBlock = buildRecordBlock
module.exports.buildCategoryBlocks = buildCategoryBlocks
module.exports.buildHiddenBlocks = buildHiddenBlocks
module.exports.buildCatSelect = buildCatSelect
module.exports.buildInfoTexts = buildInfoTexts
module.exports.buildInfoDetailBlocks = buildInfoDetailBlocks
module.exports.buildInfoContainer = buildInfoContainer
module.exports.ACCENTS = ACCENTS
module.exports.INFO_ID = INFO_ID
module.exports.INFO_BUTTON_ID = INFO_BUTTON_ID
module.exports.INFO_EMOJI = INFO_EMOJI
module.exports.INFO_EMOJI = INFO_EMOJI
module.exports.PAGES = PAGES