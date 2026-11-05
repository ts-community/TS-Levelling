const {
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} = require("discord.js")
const Drops = require("./Drops.js")

const MAIN_GUILD_ID = Drops.MAIN_GUILD_ID
const TOP_SIZE = 5
const PODIUM_SIZE = 3

const REWARD_COINS = [500000, 300000, 200000, 100000, 100000]

const STAFF_ROLE_IDS = [
    "1106553480803516437",
    "1107345436492185753",
    "1106553536839422022",
    "1202685031219200040",
    "1107329826982989906",
]
const LEGACY_STAFF_TOP_ROLES = [
    "1566503897747427489",
    "1566503915825004696",
]
const STAFF_VOTE_CHANNEL_ID = "1160813323655331850"
const STAFF_VOTE_DAYS_BEFORE_END = 3

const PUBLIC_OPENING = "Estos son los miembros que más han participado y el staff que habéis elegido por votación."
const PUBLIC_CLOSING = "Enhorabuena a los ganadores y gracias a todos por participar. ¡A por el próximo mes!"

const XP_EMOJI_FALLBACK = "<:XP:1467192533812645939>"
const MESSAGES_EMOJI_FALLBACK = "<:messages:1467163578699354235>"

const CHANNELS = {
    public: "1566501706785624114",
    admin: "1127922884568957010",
    staffVote: STAFF_VOTE_CHANNEL_ID,
}

const TOP_ROLES = {
    members: [
        "1566503932937638069",
        "1566503977728737342",
        "1566503994006700062",
    ],
    staff: [
        "1566503572726882476",
    ],
}

const MEDALS = ["🥇", "🥈", "🥉"]

function commafy(value) {
    return (Number(value) || 0).toLocaleString("en-US", { maximumFractionDigits: 10 }).replace(/,/g, ".")
}

function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function getSpanishMonthName(period) {
    return new Intl.DateTimeFormat("es-ES", {
        timeZone: "Europe/Madrid",
        month: "long",
        year: "numeric",
    }).format(new Date(`${period}-02T12:00:00Z`))
}

async function resolveEmojis(guild) {
    const find = (name) => guild?.emojis?.cache?.find(emoji =>
        String(emoji.name || "").toLowerCase() === name.toLowerCase())

    let xp = find("XP")
    let messages = find("messages")

    if ((!xp || !messages) && typeof guild?.emojis?.fetch === "function") {
        const fetched = await guild.emojis.fetch().catch(() => null)
        if (fetched) {
            xp = xp || fetched.find(emoji => String(emoji.name || "").toLowerCase() === "xp")
            messages = messages || fetched.find(emoji => String(emoji.name || "").toLowerCase() === "messages")
        }
    }

    return {
        xp: xp ? xp.toString() : XP_EMOJI_FALLBACK,
        messages: messages ? messages.toString() : MESSAGES_EMOJI_FALLBACK,
    }
}

function formatEntry(user, index, emojis, roleId) {
    if (!user?.id) return ""
    const position = index + 1
    const level = Number(user.level) || 0
    const medal = MEDALS[index] || "🎖️"
    const lines = [`${medal} #${position} - <@${user.id}> - Nivel ${level}`]

    const messages = Number(user.messages) || 0
    const messageWord = messages === 1 ? "mensaje" : "mensajes"
    lines.push(`-# ${emojis.xp} **${commafy(user.xp)} XP** - ${emojis.messages} **${commafy(messages)} ${messageWord}**`)

    if (roleId) lines.push(`-# **Rol:** <@&${roleId}>`)

    return lines.join("\n")
}

function formatTail(entries, emojis) {
    const tail = (entries || []).slice(PODIUM_SIZE, TOP_SIZE)
    if (!tail.length) return ""
    return tail
        .map((user, index) => {
            const messages = Number(user.messages) || 0
            const messageWord = messages === 1 ? "mensaje" : "mensajes"
            return `🎖️ #${PODIUM_SIZE + index + 1} - <@${user.id}> - ${emojis.messages} **${commafy(messages)} ${messageWord}**`
        })
        .join("\n")
}

function formatCategory(title, entries, emojis, roleIds = []) {
    const list = (entries || []).slice(0, TOP_SIZE)
    if (!list.length) return `### ${title}\n-# Sin actividad registrada`

    const podium = list.slice(0, PODIUM_SIZE)
        .map((user, index) => formatEntry(user, index, emojis, roleIds[index]))
        .join("\n")
    const tail = formatTail(list, emojis)
    return [`### ${title}`, podium, tail ? `\n${tail}` : ""].filter(Boolean).join("\n")
}

function buildRewardSection(rewards) {
    const lines = []
    for (const kind of ["members", "staff"]) {
        const entries = rewards?.[kind] || []
        if (!entries.length) continue
        const parts = entries.map(reward => {
            const medal = MEDALS[reward.position - 1] || "🎖️"
            return `${medal} <@${reward.userId}> **${commafy(reward.coins)} monedas**`
        })
        lines.push(`-# ${kind === "members" ? "👥" : "🛠️"} ${parts.join(" - ")}`)
    }
    return lines.length ? `### 🎁  RECOMPENSAS DEL MES\n${lines.join("\n")}` : ""
}

function buildRewardView(snapshot, existing = null) {
    const view = { members: [], staff: [] }
    for (const kind of ["members"]) {
        (snapshot?.[kind] || []).slice(0, REWARD_COINS.length).forEach((user, index) => {
            const position = index + 1
            const old = (existing?.[kind] || []).find(item =>
                Number(item?.position) === position && String(item?.userId) === String(user.id))
            view[kind].push({
                position,
                userId: String(user.id),
                coins: Number.isFinite(Number(old?.coins)) ? Number(old.coins) : (REWARD_COINS[index] || 0),
                roleId: TOP_ROLES[kind]?.[index] || "",
                delivered: old?.delivered === true,
            })
        })
    }
    return view
}

function hasStaffRole(member) {
    return Boolean(member?.roles?.cache?.some(role => STAFF_ROLE_IDS.includes(role.id)))
}

function truncatePollText(text, max = 55) {
    const clean = String(text || "").replace(/\s+/g, " ").trim()
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function monthlyUserStats(server, period, userId) {
    const data = server?.users?.[userId]
    const inPeriod = data?.monthlyPeriod
        ? String(data.monthlyPeriod) === String(period)
        : false
    return {
        monthlyXP: inPeriod ? (Number(data.monthlyXP) || 0) : 0,
        monthlyMessages: inPeriod ? (Number(data.monthlyMessages) || 0) : 0,
        totalXP: Number(data?.xp) || 0,
    }
}

function buildStaffCandidates(server, members, period) {
    const source = members?.values ? [...members.values()] : []
    const candidates = []

    for (const member of source) {
        if (!member?.id || member.user?.bot || !hasStaffRole(member)) continue
        const stats = monthlyUserStats(server, period, member.id)
        candidates.push({
            id: String(member.id),
            label: truncatePollText(member.displayName || member.user?.username || member.id),
            joinedTimestamp: Number(member.joinedTimestamp) || 0,
            ...stats,
        })
    }

    candidates.sort((a, b) =>
        b.monthlyXP - a.monthlyXP
        || b.monthlyMessages - a.monthlyMessages
        || b.totalXP - a.totalXP
        || a.joinedTimestamp - b.joinedTimestamp
        || a.id.localeCompare(b.id))

    const usedLabels = new Set()
    return candidates.map(candidate => {
        let label = candidate.label
        let suffix = 2
        while (usedLabels.has(label)) {
            label = truncatePollText(`${candidate.label} (${suffix++})`)
        }
        usedLabels.add(label)
        return { ...candidate, label }
    })
}

function formatVoteClose(closeAt) {
    return new Intl.DateTimeFormat("es-ES", {
        timeZone: "Europe/Madrid",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
    }).format(closeAt)
}

function buildStaffVoteContent(period, closeAt, candidateCount, totalCandidates, groupLabel = "") {
    const monthName = capitalize(getSpanishMonthName(period))
    const lines = [
        "@everyone",
        "",
        `# 🛠️  STAFF DEL MES - ${monthName.toUpperCase()}${groupLabel}`,
        "",
        "Elegid al **Staff del Mes** entre quienes más hayan destacado este mes.",
        "",
        "**Cómo funciona**",
        "- Podéis seleccionar varios candidatos.",
        `- Podéis votar hasta el **${formatVoteClose(closeAt)}** (hora peninsular).`,
        "- Ganará quien tenga más votos. En caso de empate, decidirán el **XP mensual**, los mensajes y la antigüedad.",
        `- El ganador aparecerá en los destacados y recibirá el rol <@&${TOP_ROLES.staff[0]}>.`,
    ]

    lines.push("", `Votad en la encuesta${totalCandidates > candidateCount ? " de este grupo" : ""}:`)
    return lines.join("\n")
}

async function startStaffVote(client, guild, server, members, period, closeAt) {
    const existing = server?.info?.monthlyStaffVote
    if (existing?.period === period && existing?.messageId) return { skipped: true, vote: existing }

    const allCandidates = buildStaffCandidates(server, members, period)
    const candidates = allCandidates
    if (!candidates.length) {
        return { error: "no hay candidatos de staff", candidates }
    }
    if (candidates.length === 1) {
        const vote = {
            period,
            candidates,
            openedAt: Date.now(),
            closesAt: closeAt.getTime(),
            winnerId: candidates[0].id,
            winnerLabel: candidates[0].label,
            winnerVotes: 0,
            tieBreak: false,
            results: [],
            auto: true,
            closedAt: Date.now(),
        }
        try {
            await client.db.update(guild.id, {
                $set: { "info.monthlyStaffVote": vote }
            }).exec()
        } catch (error) {
            return { error: error.message, vote }
        }
        return { vote, auto: true }
    }

    const channel = await resolveChannel(client, STAFF_VOTE_CHANNEL_ID)
    if (!channel || channel.guild?.id !== guild.id || !channel.isTextBased()) {
        return { error: "no se encontró el canal de la votación" }
    }

    try {
        const groups = []
        for (let index = 0; index < candidates.length; index += 10) {
            groups.push(candidates.slice(index, index + 10))
        }
        const monthName = capitalize(getSpanishMonthName(period))
        const infoMessage = await channel.send({
            components: [
                new ContainerBuilder()
                    .setAccentColor(0x8a8f98)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        buildStaffVoteContent(period, closeAt, candidates.length, candidates.length)
                    )),
            ],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: ["everyone"], roles: [] },
        })
        const pollMessages = []
        for (let index = 0; index < groups.length; index++) {
            const group = groups[index]
            const groupLabel = groups.length > 1 ? ` (grupo ${index + 1}/${groups.length})` : ""
            const pollMessage = await channel.send({
                content: groups.length > 1
                    ? `🛠️ **Votación del Staff del Mes — grupo ${index + 1}/${groups.length}**\nPodéis marcar a varias personas de este grupo. Los votos de todos los grupos se sumarán.`
                    : "🛠️ **Votación del Staff del Mes**\nPodéis marcar a varias personas.",
                poll: {
                    question: { text: truncatePollText(`¿Quién debe ser el Staff del Mes de ${monthName}?${groupLabel}`, 300) },
                    answers: group.map(candidate => ({ text: candidate.label })),
                    duration: Math.max(1, Math.ceil((closeAt.getTime() + 60 * 1000 - Date.now()) / (60 * 60 * 1000))),
                    allowMultiselect: true,
                },
                allowedMentions: { parse: [] },
            })
            pollMessages.push(pollMessage)
        }
        const vote = {
            period,
            channelId: channel.id,
            messageId: infoMessage.id,
            pollMessageIds: pollMessages.map(message => message.id),
            candidates,
            openedAt: Date.now(),
            closesAt: closeAt.getTime(),
            winnerId: null,
            winnerLabel: null,
            winnerVotes: null,
            tieBreak: false,
            results: [],
        }
        try {
            await client.db.update(guild.id, {
                $set: { "info.monthlyStaffVote": vote }
            }).exec()
        } catch (error) {
            return { error: error.message, vote, message: infoMessage, pollMessages }
        }
        return { vote, message: infoMessage, pollMessages }
    } catch (error) {
        return { error: error.message }
    }
}

async function resolveStaffVote(client, guild, server, period) {
    const vote = server?.info?.monthlyStaffVote
    if (!vote || String(vote.period) !== String(period)) return null
    if (vote.winnerId) return vote
    if (!vote.messageId) return { ...vote, error: "la votación no tiene mensaje" }

    const channel = await resolveChannel(client, vote.channelId || STAFF_VOTE_CHANNEL_ID)
    if (!channel || channel.guild?.id !== guild.id || !channel.isTextBased()) {
        return { ...vote, error: "no se encontró el canal de la votación" }
    }

    const messageIds = Array.isArray(vote.pollMessageIds) && vote.pollMessageIds.length
        ? vote.pollMessageIds
        : Array.isArray(vote.messageIds) && vote.messageIds.length
            ? vote.messageIds
        : [vote.messageId]
    const results = []
    let resultsFinalized = true
    for (let groupIndex = 0; groupIndex < messageIds.length; groupIndex++) {
        let message = await channel.messages.fetch(messageIds[groupIndex]).catch(() => null)
        if (!message?.poll) return { ...vote, error: "no se encontró una encuesta" }
        if (!message.poll.resultsFinalized) {
            const ended = await message.poll.end().catch(() => null)
            if (ended) message = ended
            if (!message.poll?.resultsFinalized) await message.poll?.fetch().catch(() => null)
        }
        resultsFinalized = resultsFinalized && message.poll?.resultsFinalized === true
        const groupCandidates = vote.candidates.slice(groupIndex * 10, groupIndex * 10 + 10)
        const answers = [...(message.poll?.answers?.values?.() || [])].sort((a, b) => a.id - b.id)
        results.push(...answers.map((answer, index) => ({
            id: groupCandidates[index]?.id || null,
            label: groupCandidates[index]?.label || truncatePollText(answer.text || ""),
            votes: Number(answer.voteCount) || 0,
        })).filter(item => item.id))
    }

    if (!results.length) return { ...vote, error: "la encuesta no tiene resultados" }

    const candidateById = new Map((vote.candidates || []).map(candidate => [String(candidate.id), candidate]))
    const ranked = results.slice().sort((a, b) => {
        const candidateA = candidateById.get(String(a.id)) || {}
        const candidateB = candidateById.get(String(b.id)) || {}
        const statsA = monthlyUserStats(server, period, a.id)
        const statsB = monthlyUserStats(server, period, b.id)
        return b.votes - a.votes
            || statsB.monthlyXP - statsA.monthlyXP
            || statsB.monthlyMessages - statsA.monthlyMessages
            || statsB.totalXP - statsA.totalXP
            || (Number(candidateA.joinedTimestamp) || 0) - (Number(candidateB.joinedTimestamp) || 0)
            || String(a.id).localeCompare(String(b.id))
    })

    const winner = ranked[0]
    const tied = results.filter(item => item.votes === winner.votes).length > 1
    const finalVote = {
        ...vote,
        results,
        winnerId: winner.id,
        winnerLabel: winner.label,
        winnerVotes: winner.votes,
        tieBreak: tied,
        resultsFinalized,
        closedAt: Date.now(),
    }

    await client.db.update(guild.id, {
        $set: { "info.monthlyStaffVote": finalVote }
    }).exec().catch(error => {
        console.warn(`Could not save monthly staff vote for ${guild.id}:`, error.message)
    })
    return finalVote
}

function buildStaffWinnerEntry(server, period, winnerId, level) {
    const stats = monthlyUserStats(server, period, winnerId)
    return {
        id: String(winnerId),
        level: Number(level) || 0,
        xp: stats.monthlyXP,
        messages: stats.monthlyMessages,
    }
}

function buildTopText(period, snapshot, emojis, options = {}) {
    const monthName = capitalize(getSpanishMonthName(period)).toUpperCase()
    const opening = options.opening || PUBLIC_OPENING
    const closing = options.closing || PUBLIC_CLOSING
    const rewards = options.rewards || buildRewardView(snapshot)
    return [
        `# 🏆  DESTACADOS DE ${monthName}`,
        "",
        opening,
        "",
        formatCategory("👥  MIEMBROS DEL MES", snapshot?.members, emojis, TOP_ROLES.members),
        "",
        formatCategory("🛠️  STAFF DEL MES", snapshot?.staff, emojis, TOP_ROLES.staff),
        "",
        buildRewardSection(rewards),
        "",
        closing,
    ].join("\n")
}

function buildAnnouncementTemplate(period, snapshot, emojis, options = {}) {
    const monthName = capitalize(getSpanishMonthName(period)).toUpperCase()
    const opening = options.opening || "[MENSAJE DE APERTURA - personalízalo antes de publicar]"
    const closing = options.closing || "[MENSAJE DE CIERRE - personalízalo antes de publicar]"
    const rewards = options.rewards || buildRewardView(snapshot)
    return [
        `# 🏆  DESTACADOS DE ${monthName}`,
        "",
        opening,
        "",
        formatCategory("👥  MIEMBROS DEL MES", snapshot?.members, emojis, TOP_ROLES.members),
        "",
        formatCategory("🛠️  STAFF DEL MES", snapshot?.staff, emojis, TOP_ROLES.staff),
        "",
        buildRewardSection(rewards),
        "",
        closing,
        "",
        "@everyone",
    ].join("\n")
}

function buildTopContainer(period, snapshot, emojis, options = {}) {
    const monthName = capitalize(getSpanishMonthName(period)).toUpperCase()
    const opening = options.opening || PUBLIC_OPENING
    const closing = options.closing || PUBLIC_CLOSING
    const rewards = options.rewards || buildRewardView(snapshot)
    const separator = () => new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    const text = content => new TextDisplayBuilder().setContent(content)

    const container = new ContainerBuilder()
        .setAccentColor(0x8ecae6)
        .addTextDisplayComponents(text(`# 🏆  DESTACADOS DE ${monthName}`))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(text(opening))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(text(formatCategory("👥  MIEMBROS DEL MES", snapshot?.members, emojis, TOP_ROLES.members)))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(text(formatCategory("🛠️  STAFF DEL MES", snapshot?.staff, emojis, TOP_ROLES.staff)))

    const rewardSection = buildRewardSection(rewards)
    if (rewardSection) {
        container
            .addSeparatorComponents(separator())
            .addTextDisplayComponents(text(rewardSection))
    }

    return container
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(text(closing))
}

async function resolveChannel(client, target) {
    if (!target) return null
    if (typeof target === "string") return client.channels.fetch(target).catch(() => null)
    return target
}

async function sendPublicTop(client, guild, channelTarget, snapshot, period, options = {}) {
    const channel = await resolveChannel(client, channelTarget)
    if (!channel || channel.guild?.id !== guild.id || !channel.isTextBased()) return false

    const emojis = await resolveEmojis(guild)
    const rewards = options.rewards ? buildRewardView(snapshot, options.rewards) : null
    const container = buildTopContainer(period, snapshot, emojis, {
        rewards,
        opening: options.opening,
        closing: options.closing,
    })

    try {
        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        })
        return true
    } catch (error) {
        console.warn(`Could not send monthly top to ${channel.id}:`, error.message)
        return false
    }
}

async function sendAdminTemplate(client, guild, channelTarget, snapshot, period, options = {}) {
    const channel = await resolveChannel(client, channelTarget)
    if (!channel || channel.guild?.id !== guild.id || !channel.isTextBased()) return false

    const emojis = await resolveEmojis(guild)
    const rewards = options.rewards ? buildRewardView(snapshot, options.rewards) : null
    const content = buildAnnouncementTemplate(period, snapshot, emojis, {
        rewards,
        opening: options.opening,
        closing: options.closing,
    })

    try {
        await channel.send({
            content,
            allowedMentions: { parse: [] },
        })
        return true
    } catch (error) {
        console.warn(`Could not send monthly announcement template to ${channel.id}:`, error.message)
        return false
    }
}

async function sendMonthlyTop(client, guild, snapshot, period, options = {}) {
    const [publicSent, adminSent] = await Promise.all([
        sendPublicTop(client, guild, CHANNELS.public, snapshot, period, options),
        sendAdminTemplate(client, guild, CHANNELS.admin, snapshot, period, options),
    ])
    return { public: publicSent, admin: adminSent }
}

async function giveMonthlyCoins(client, guild, snapshot, period, existingRewards = null) {
    const rewards = buildRewardView(snapshot, existingRewards)
    const summary = { rewards, given: 0, failed: 0, skipped: 0, error: null }
    const monthName = capitalize(getSpanishMonthName(period))
    const save = () => client.db.update(guild.id, {
        $set: { "info.monthlyTop.rewards": rewards }
    }).exec().catch(error => {
        console.warn(`Could not save monthly rewards for ${guild.id}:`, error.message)
    })

    if (!Drops.boatEnabled()) {
        summary.error = "la economía no está conectada"
        await save()
        return summary
    }

    for (const kind of ["members"]) {
        for (const reward of rewards[kind]) {
            if (reward.delivered) {
                summary.skipped++
                continue
            }
            if (Number(reward.coins) <= 0) continue

            const member = await guild.members.fetch(reward.userId).catch(() => null)
            if (!member || member.user?.bot) {
                summary.failed++
                continue
            }

            const kindLabel = kind === "members" ? "Miembro" : "Staff"
            try {
                await Drops.addBoatCoins(
                    guild.id,
                    reward.userId,
                    reward.coins,
                    `Top ${monthName} - ${kindLabel} #${reward.position}`,
                )
                reward.delivered = true
                summary.given++
                await save()
            } catch (error) {
                summary.failed++
                console.warn(`Could not give monthly coins to ${reward.userId}:`, error.message)
            }
        }
    }

    await save()
    return summary
}

function buildRoleAssignments(snapshot, roleIds = TOP_ROLES) {
    const assignments = []
    const collect = (kind, entries, roles) => {
        (roles || []).forEach((roleId, index) => {
            const user = entries?.[index]
            if (!roleId || !user?.id) return
            assignments.push({ kind, position: index + 1, roleId, userId: String(user.id) })
        })
    }

    collect("members", snapshot?.members, roleIds.members)
    collect("staff", snapshot?.staff, roleIds.staff)
    return assignments
}

async function assignTopRoles(guild, snapshot, period, roleIds = TOP_ROLES) {
    const assignments = buildRoleAssignments(snapshot, roleIds)
    const summary = { assigned: 0, removed: 0, skipped: 0, error: null }
    const configuredRoleIds = [...new Set([
        ...(roleIds.members || []),
        ...(roleIds.staff || []),
        ...LEGACY_STAFF_TOP_ROLES,
    ])].filter(Boolean)
    if (!configuredRoleIds.length) return summary

    const me = guild.members.me
    if (!me?.permissions?.has("ManageRoles")) {
        summary.error = "el bot no tiene permiso para gestionar roles"
        return summary
    }

    const roles = new Map()
    for (const roleId of configuredRoleIds) {
        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null)
        if (!role) continue
        if (role.position >= me.roles.highest.position) {
            console.warn(`Monthly top role ${roleId} is above the bot's highest role in ${guild.id}`)
            continue
        }
        roles.set(roleId, role)
    }

    if (!roles.size) {
        summary.error = "no se encontraron los roles configurados"
        return summary
    }

    const winnerByRole = new Map(assignments.map(item => [item.roleId, item.userId]))
    for (const [roleId, role] of roles) {
        const winnerId = winnerByRole.get(roleId)
        const holders = await guild.members.fetch({ role: roleId })
            .catch(() => guild.members.cache.filter(member => member.roles.cache.has(roleId)))

        for (const member of holders.values()) {
            if (String(member.id) === String(winnerId)) continue
            try {
                await member.roles.remove(role, `Top mensual ${period}: limpieza de roles`)
                summary.removed++
            } catch (error) {
                console.warn(`Could not remove monthly top role ${roleId} from ${member.id}:`, error.message)
            }
        }
    }

    for (const assignment of assignments) {
        const role = roles.get(assignment.roleId)
        if (!role) continue
        const member = await guild.members.fetch(assignment.userId).catch(() => null)
        if (!member || member.user?.bot) {
            summary.skipped++
            continue
        }
        if (member.roles.cache.has(assignment.roleId)) continue

        try {
            await member.roles.add(role, `Top mensual ${period}: ${assignment.kind} #${assignment.position}`)
            summary.assigned++
        } catch (error) {
            console.warn(`Could not assign monthly top role ${assignment.roleId} to ${member.id}:`, error.message)
            summary.skipped++
        }
    }

    return summary
}

module.exports = {
    MAIN_GUILD_ID,
    TOP_SIZE,
    PODIUM_SIZE,
    CHANNELS,
    TOP_ROLES,
    STAFF_ROLE_IDS,
    LEGACY_STAFF_TOP_ROLES,
    STAFF_VOTE_CHANNEL_ID,
    STAFF_VOTE_DAYS_BEFORE_END,
    REWARD_COINS,
    buildTopText,
    buildAnnouncementTemplate,
    buildTopContainer,
    buildRewardView,
    buildRewardSection,
    buildRoleAssignments,
    buildStaffCandidates,
    buildStaffVoteContent,
    buildStaffWinnerEntry,
    startStaffVote,
    resolveStaffVote,
    resolveEmojis,
    sendPublicTop,
    sendAdminTemplate,
    sendMonthlyTop,
    giveMonthlyCoins,
    assignTopRoles,
    getSpanishMonthName,
    commafy,
}
