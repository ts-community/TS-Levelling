// Tracker central de récords: helpers puros (testeables) + entrega de recompensas.
// El progreso vive en users.<id> (streak, reactionsSent, channels, countingSent,
// voiceMinutes, voiceJoined) y el flag completado en users.<id>.records["id:threshold"].

const recordsConfig = require("../config/records.js")
const RecordUnlockMessage = require("./RecordUnlockMessage.js")
const Tools = require("./Tools.js")
const ranks = require("../consts/ranks.js")
const LevelUpMessage = require("./LevelUpMessage.js")
const OvertakeMessage = require("./OvertakeMessage.js")

// IDs canónicos en config/records.js (CHANNELS). Se acepta el antiguo
// config.json.records como fallback por si alguien no ha migrado.
function getRecordIds() {
    try {
        const legacy = require("../config.json").records || {}
        return { ...legacy, ...(recordsConfig.CHANNELS || {}) }
    } catch {
        return { ...(recordsConfig.CHANNELS || {}) }
    }
}

function getMadridParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en", {
        timeZone: "Europe/Madrid",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
    }).formatToParts(date)
    return Object.fromEntries(parts.map(p => [p.type, p.value]))
}

function getMadridDay(date = new Date()) {
    const p = getMadridParts(date)
    return `${p.year}-${p.month}-${p.day}`
}

function getMadridHour(date = new Date()) {
    return Number(getMadridParts(date).hour)
}

// Ayer en Madrid (para saber si la racha sigue o se rompe).
function getMadridYesterday(date = new Date()) {
    return getMadridDay(new Date(date.getTime() - 24 * 60 * 60 * 1000))
}

// Calcula la racha nueva a partir de la guardada. Día en TZ Europe/Madrid.
function computeStreakUpdate(streak, now = new Date()) {
    const today = getMadridDay(now)
    const current = Number(streak?.current) || 0
    const previousMax = Number(streak?.max ?? streak?.maximum ?? streak?.best) || current
    const lastDay = streak?.lastDay || null
    const nextCurrent = lastDay === today
        ? (current || 1)
        : lastDay === getMadridYesterday(now)
            ? (current + 1 || 1)
            : 1
    return { current: nextCurrent, max: Math.max(previousMax, nextCurrent), lastDay: today }
}

function getStreakCurrent(streak) {
    if (streak == null) return 0
    if (typeof streak === "object") return Number(streak.current ?? streak.days) || 0
    return Number(streak) || 0
}

// Nº de canales distintos donde ha escrito.
function countDistinctChannels(channels) {
    if (channels == null) return 0
    if (typeof channels === "number") return channels
    if (channels instanceof Set || channels instanceof Map) return channels.size
    if (Array.isArray(channels)) return channels.length
    if (typeof channels === "object") return Object.keys(channels).length
    return 0
}

// ¿Es un número válido de counting? Solo cuenta mensajes de usuarios
// (no bots) en el canal de counting que empiecen por un número.
function isCountingMessage(message, countingChannelId, previousMessage = null) {
    if (!countingChannelId) return false
    if (String(message?.channelId || message?.channel?.id) !== String(countingChannelId)) return false
    if (message?.author?.bot) return false
    const content = String(message?.content || "").trim()
    const previousContent = String(previousMessage?.content || "").trim()
    if (!/^\d+$/.test(content) || !/^\d+$/.test(previousContent)) return false
    try {
        return BigInt(content) === BigInt(previousContent) + 1n
    } catch {
        return false
    }
}

// ¿Habla con la IA? Menciona a Nova con @ o responde a uno de sus mensajes.
function didTalkToIA(message, iaBotId) {
    if (!iaBotId || message?.author?.bot) return false
    try {
        const mentions = message?.mentions?.users
        if (mentions) {
            if (typeof mentions.has === "function" && mentions.has(String(iaBotId))) return true
            if (typeof mentions.some === "function" && mentions.some(u => String(u?.id) === String(iaBotId))) return true
        }
    } catch {}
    try {
        const refAuthor = message?.reference?.messageId ? message?._referencedAuthorId : null
        if (refAuthor && String(refAuthor) === String(iaBotId)) return true
    } catch {}
    return false
}

// Extrae el ID del mensaje original de un post del starboard.
// Formato: "...\n<messageId>•fecha" o link con el ID. Tolerante a ediciones.
function parseStarboardMessageId(content = "", embeds = []) {
    const texts = [String(content || "")]
    try {
        for (const e of embeds || []) {
            if (e?.description) texts.push(String(e.description))
            if (e?.footer?.text) texts.push(String(e.footer.text))
            for (const f of e?.fields || []) if (f?.value) texts.push(String(f.value))
        }
    } catch {}
    const joined = texts.join("\n")
    const ids = joined.match(/\b\d{17,20}\b/g) || []
    return ids.length ? ids[0] : null
}

// ¿La reacción cuenta para récords? Vale cualquier emoji menos
// self (reaccionar a tu propio mensaje) y bots.
function isValidRecordReaction(reaction, user) {
    if (!user || user.bot) return false
    const authorId = reaction?.message?.author?.id
    if (authorId && String(authorId) === String(user.id)) return false
    return true
}

// Umbrales recién alcanzados por un contador (sin contar los ya desbloqueados).
function newlyReachedThresholds(record, progressValue, unlockedIds) {
    const value = Number(progressValue) || 0
    return record.tiers
        .filter(t => value >= t.threshold && !unlockedIds?.has(`${record.id}:${t.threshold}`))
        .map(t => t.threshold)
}

function unlockedIdSet(userData) {
    return new Set(Object.keys(userData?.records || {}))
}

// El autor es rango Pro si su nivel efectivo da el rol Pro o si ya lleva el
// rol Pro puesto (por si el sync de roles aun no se aplico).
function isProRank(member, level, settings) {
    try {
        const proRank = ranks.find(r => r.rank === "pro")
        const proIds = new Set((proRank?.roles || []).map(r => String(r.id)))
        if (!proIds.size) return false
        const currentRoles = Tools.global.getRolesForLevel(level, settings.rewards)
        if ((currentRoles || []).some(r => proIds.has(String(r.id)))) return true
        const cache = member?.roles?.cache
        if (cache) {
            if (typeof cache.has === "function") {
                for (const id of proIds) if (cache.has(id)) return true
            } else if (typeof cache.some === "function") {
                if (cache.some(r => proIds.has(String(r?.id)))) return true
            }
        }
    } catch {}
    return false
}

// Detecta a quienes ha adelantado el autor comparando la clasificacion
// global (misma regla que /rank) antes y despues de un cambio de XP.
// Solo cuenta si ya estaba en el top y ahora esta mas arriba.
function getOvertakenIds(oldUsers, newUsers, authorId, settings) {
    try {
        const oldBoard = Tools.global.getLeaderboard(oldUsers || {}, settings)
        const newBoard = Tools.global.getLeaderboard(newUsers || {}, settings)
        const oldIdx = oldBoard.findIndex(u => String(u.id) === String(authorId))
        const newIdx = newBoard.findIndex(u => String(u.id) === String(authorId))
        if (oldIdx === -1 || newIdx === -1 || newIdx >= oldIdx) return null
        const oldPos = oldIdx + 1
        const newPos = newIdx + 1
        // Candidatos: estaban por delante antes (indices newPos-1..oldPos-2)
        const candidates = oldBoard.slice(newPos - 1, oldPos - 1)
            .filter(u => String(u.id) !== String(authorId))
            .map(u => String(u.id))
        // Solo los que ahora estan por detras del autor
        const newPositions = new Map(newBoard.map((u, i) => [String(u.id), i]))
        const authorNewIdx = newPositions.get(String(authorId))
        const overtaken = candidates.filter(id => (newPositions.get(id) ?? -1) > authorNewIdx)
        if (!overtaken.length) return null
        return { oldPos, newPos, overtakenIds: overtaken }
    } catch {
        return null
    }
}

// Entrega un nivel: marca flag + suma XP (+ mensual) + rol de
// récord. Devuelve el objeto de desbloqueo si fue nuevo, o null si ya estaba.
// El envío del anuncio se hace aparte para poder agrupar varios.
async function grantRecord(client, guild, guildId, userId, recordId, threshold) {
    const found = recordsConfig.allRecords().find(x => x.record.id === recordId)
    const tier = found?.record.tiers.find(t => t.threshold === threshold)
    if (!tier) return null

    const resolvedGuildId = String(guild?.id || guildId || "")
    if (!resolvedGuildId) return null

    const fresh = await client.db.fetch(resolvedGuildId).exec().catch(() => null)
    const key = `${recordId}:${threshold}`
    if (fresh?.users?.[String(userId)]?.records?.[key]) return null

    const settings = fresh?.settings
    const beforeUser = fresh?.users?.[String(userId)] || {}
    const oldXP = Number(beforeUser.xp) || 0
    const oldLevel = settings ? Tools.global.getLevel(oldXP, settings) : 0

    const updates = { $set: { [`users.${userId}.records.${key}`]: true } }
    if (tier.xp > 0) {
        updates.$inc = {
            [`users.${userId}.xp`]: tier.xp,
            [`users.${userId}.monthlyXP`]: tier.xp,
        }
    }
    await client.db.update(resolvedGuildId, updates).exec().catch(() => null)

    const after = await client.db.fetch(resolvedGuildId).exec().catch(() => null)
    const afterUser = after?.users?.[String(userId)] || {}
    const newXP = Number(afterUser.xp) || 0
    const newLevel = settings ? Tools.global.getLevel(newXP, settings) : 0
    const levelUp = newLevel > oldLevel

    let member = null
    try {
        if (guild?.members) member = await guild.members.fetch(String(userId)).catch(() => null)
    } catch {}

    // Rol de recompensa si el tier lo define.
    try {
        if (tier.roleId && member) {
            const role = guild.roles?.cache?.get(String(tier.roleId))
            if (role && !member.roles.cache.has(role.id)) {
                await member.roles.add(role).catch(() => {})
            }
        }
    } catch {}

    // Canal de récords (también sirve de fallback para el level-up cuando
    // settings.levelUp.channel es "current" y no hay mensaje origen).
    let recordsChannel = null
    try {
        const channelId = getRecordIds().channelId
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null
        if (channel && channel.guild?.id === resolvedGuildId && channel.isTextBased?.()) recordsChannel = channel
    } catch {}

    // Prepara info del desbloqueo para que el caller lo envíe (batching).
    const keys = Object.keys(afterUser.records || {})
    const done = keys.filter(k => k.startsWith(`${recordId}:`)).length || 1
    // Totales globales del usuario (como /records: visibles + ocultos ya descubiertos).
    const unlockedKeys = new Set(keys)
    const doneVisible = recordsConfig.visibleRecords().reduce((n, { record }) =>
        n + record.tiers.filter(t => unlockedKeys.has(`${record.id}:${t.threshold}`)).length, 0)
    const doneHidden = recordsConfig.hiddenRecords().reduce((n, { record }) =>
        n + record.tiers.filter(t => unlockedKeys.has(`${record.id}:${t.threshold}`)).length, 0)
    const totalCompleted = doneVisible + doneHidden
    const totalVisible = recordsConfig.countTiers(recordsConfig.visibleRecords()) + doneHidden

    // Sync de roles de nivel con el XP nuevo (igual que el flujo de mensajes).
    try {
        if (settings && member) {
            const syncMode = settings.rewardSyncing?.sync
            if (syncMode == "xp" || (syncMode == "level" && levelUp)) {
                const roleCheck = Tools.global.checkLevelRoles(guild.roles.cache, member.roles.cache, newLevel, settings.rewards, null, oldLevel)
                await Tools.global.syncLevelRoles(member, roleCheck).catch(() => {})
            }
        }
    } catch {}

    // Pseudo-mensaje sin id ni contenido: LevelUpMessage/OvertakeMessage lo
    // aceptan y omiten la cita ("Sin mensaje (XP manual)"), como en /addxp.
    // Si el level-up va a "current", cae al canal de récords para no perderse.
    const pseudoMessage = {
        id: null, content: "",
        attachments: { size: 0 }, stickers: { size: 0 }, embeds: [],
        author: member?.user || { id: String(userId) },
        member, guild, channel: recordsChannel, client,
    }
    const leveledUserData = { ...afterUser, xp: newXP }

    if (settings?.levelUp?.enabled && levelUp) {
        try {
            const useMultiple = (settings.levelUp.multiple > 1 && (settings.levelUp.multipleUntil == 0 || (newLevel < settings.levelUp.multipleUntil)))
            if (!useMultiple || (newLevel % settings.levelUp.multiple == 0)) {
                const lvlMessage = new LevelUpMessage(settings, pseudoMessage, {
                    oldLevel, level: newLevel, userData: leveledUserData,
                    allUsers: after?.users || null, client,
                })
                await lvlMessage.send()
            }
        } catch {}
    }

    return {
        record: found.record,
        category: found.category,
        tier,
        done,
        total: found.record.tiers.length,
        totalCompleted,
        totalVisible,
        recordsChannel,
        member,
    }
}

// --- Revert de testing ------------------------------------------------------
// XP que dio un flag "recordId:threshold" según el catálogo actual.
function recordXpForKey(key) {
    const sep = String(key).lastIndexOf(":")
    if (sep === -1) return 0
    const record = recordsConfig.allRecords().find(x => x.record.id === String(key).slice(0, sep))?.record
    const tier = record?.tiers.find(t => String(t.threshold) === String(key).slice(sep + 1))
    return Number(tier?.xp) || 0
}

// Update mongo que revierte SOLO lo de récords: quita flags y
// resta el XP que dieron los logros (clamp a 0). No toca messages,
// monthlyMessages, rachas, reacciones, canales, counting, voz ni cooldown.
// Devuelve null si el usuario no tiene nada que revertir.
function buildRecordResetUpdate(userId, userData) {
    const keys = Object.keys(userData?.records || {})
    if (!keys.length) return null
    const removedXp = keys.reduce((sum, k) => sum + recordXpForKey(k), 0)
    return {
        update: {
            $unset: {
                [`users.${userId}.records`]: 1,
            },
            $set: {
                [`users.${userId}.xp`]: Math.max(0, Math.round((Number(userData?.xp) || 0) - removedXp)),
                [`users.${userId}.monthlyXP`]: Math.max(0, Math.round((Number(userData?.monthlyXP) || 0) - removedXp)),
            },
        },
        removedXp,
        count: keys.length,
    }
}

// Campos que solo existen por los récords (progreso). messages y
// monthlyMessages NO están aquí a propósito: hay que mantenerlos.
const PROGRESS_FIELDS = ['streak', 'reactionsSent', 'reactionsReceived', 'channels', 'countingSent', 'voiceMinutes', 'voiceJoined']

// Versión completa para el reset de terminal: como buildRecordResetUpdate
// pero además quita el progreso de récords (salvo keepProgress). Lo único
// que ajusta es xp/monthlyXP; messages/monthlyMessages jamás se tocan.
// Devuelve null si no hay nada que revertir.
function planUserReset(userId, userData, keepProgress = false) {
    const base = buildRecordResetUpdate(userId, userData)
    const hasProgress = PROGRESS_FIELDS.some(f => userData?.[f] !== undefined)
    if (!base && !(hasProgress && !keepProgress)) return null

    const unset = { ...(base?.update.$unset || {}) }
    const set = { ...(base?.update.$set || {}) }
    if (!keepProgress) {
        for (const f of PROGRESS_FIELDS) {
            if (userData?.[f] !== undefined) unset[`users.${userId}.${f}`] = 1
        }
    }
    if (!base) {
        // Solo había progreso, sin flags: no hay XP que restar.
        set[`users.${userId}.xp`] = Math.round(Number(userData?.xp) || 0)
        set[`users.${userId}.monthlyXP`] = Math.round(Number(userData?.monthlyXP) || 0)
    }
    return {
        userId,
        levels: base?.count || 0,
        removedXp: base?.removedXp || 0,
        unset,
        set,
    }
}

// Concede el logro de participación en economía (evento único, flag en records).
// Se llama desde los comandos de economía (comprar, vender, apostar, etc.).
async function grantEconomyParticipation(client, guild, guildId, userId) {
    const recordId = "economy_participation"
    const threshold = 1
    return grantRecord(client, guild, guildId, userId, recordId, threshold)
}

// Envía todos los desbloqueos pendientes de golpe en un solo mensaje.
// unlocks: array de lo que devuelve grantRecord (con recordsChannel, member, etc.)
async function sendBatchedUnlocks({ client, userId, avatarUrl, unlocks }) {
    if (!unlocks?.length) return
    // Tomar el primer canal válido (deberían ser todos iguales)
    const channel = unlocks.find(u => u.recordsChannel)?.recordsChannel
    if (!channel) return

    const unlockMsg = new (require("./RecordUnlockMessage.js"))({
        client,
        userId: String(userId),
        avatarUrl,
        unlocks: unlocks.map(u => ({
            record: u.record,
            category: u.category,
            tier: u.tier,
            done: u.done,
            total: u.total,
            totalCompleted: u.totalCompleted,
            totalVisible: u.totalVisible,
        })),
    })
    await unlockMsg.send(channel).catch(() => {})
}

module.exports = {
    getMadridDay,
    getMadridHour,
    getRecordIds,
    computeStreakUpdate,
    getStreakCurrent,
    countDistinctChannels,
    isCountingMessage,
    didTalkToIA,
    parseStarboardMessageId,
    isValidRecordReaction,
    isProRank,
    getOvertakenIds,
    newlyReachedThresholds,
    unlockedIdSet,
    grantRecord,
    grantEconomyParticipation,
    recordXpForKey,
    buildRecordResetUpdate,
    PROGRESS_FIELDS,
    planUserReset,
    sendBatchedUnlocks,
}
