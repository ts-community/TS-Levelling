// Tracker central de récords: helpers puros (testeables) + entrega de recompensas.
// El progreso vive en users.<id> (streak, reactionsSent, channels, countingSent,
// voiceMinutes, voiceJoined) y el flag completado en users.<id>.records["id:threshold"].

const recordsConfig = require("../config/records.js")
const { ContainerBuilder, TextDisplayBuilder, ThumbnailBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js")
const RecordUnlockMessage = require("./RecordUnlockMessage.js")
const Tools = require("./Tools.js")
const ranks = require("../consts/ranks.js")
const LevelUpMessage = require("./LevelUpMessage.js")
const OvertakeMessage = require("./OvertakeMessage.js")

const XP_EMOJI = "<:XP:1467192533812645939>"

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

function getMadridMonth(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]))
    return `${values.year}-${values.month}`
}

// Reset lógico: la verdad no es poner a 0 a todos en DB, sino el marcador
// de periodo. Si el marcador del usuario (y de fallback el global) no es el
// actual, el valor efectivo es 0 aunque en DB siga lo de ayer/el mes pasado.
// El marcador por usuario se autocura en el siguiente write ($set a 1).
function isDailyStale(userData, info, now = new Date()) {
    const today = typeof now === "string" ? now : getMadridDay(now)
    if (userData?.dailyPeriod) return String(userData.dailyPeriod) !== today
    // Sin marcador propio no hay prueba de actividad de hoy (usuarios de
    // antes del reset lógico). El global no prueba nada del usuario.
    return true
}

function isMonthlyStale(userData, info, now = new Date()) {
    const month = typeof now === "string" ? now : getMadridMonth(now)
    if (userData?.monthlyPeriod) return String(userData.monthlyPeriod) !== month
    return true
}

function getEffectiveDailyMessages(userData, info, now = new Date()) {
    if (info && isDailyStale(userData, info, now)) return 0
    return Number(userData?.dailyMessages) || 0
}

function getEffectiveDailyXP(userData, info, now = new Date()) {
    if (info && isDailyStale(userData, info, now)) return 0
    return Number(userData?.dailyXP) || 0
}

function getEffectiveMonthlyMessages(userData, info, now = new Date()) {
    if (info && isMonthlyStale(userData, info, now)) return 0
    return Number(userData?.monthlyMessages) || 0
}

function getEffectiveMonthlyXP(userData, info, now = new Date()) {
    if (info && isMonthlyStale(userData, info, now)) return 0
    return Number(userData?.monthlyXP) || 0
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

// Captura de Pokétwo: el bot felicita con "Congratulations <@id>! You caught
// a ...". Devuelve el ID del que capturó o null. Solo vale en el canal de
// #poketwo y del bot de Pokétwo (el autor es el bot, no el que captura).
function parsePoketwoCatch(content = "") {
    const match = String(content || "").match(/Congratulations\s+<@!?(\d+)>\s*!\s*You caught a\s+/i)
    return match ? match[1] : null
}

function isPoketwoCatchMessage(message, poketwoChannelId, poketwoBotId) {
    if (!poketwoChannelId || !poketwoBotId) return null
    if (String(message?.channelId || message?.channel?.id) !== String(poketwoChannelId)) return null
    if (String(message?.author?.id) !== String(poketwoBotId)) return null
    const texts = [String(message?.content || "")]
    try {
        for (const e of message?.embeds || []) {
            if (e.description) texts.push(e.description)
        }
    } catch {}
    for (const text of texts) {
        const catcherId = parsePoketwoCatch(text)
        if (catcherId) return catcherId
    }
    return null
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

// ¿La reacción cuenta como RECIBIDA para el autor del mensaje?
// Como en el lado de enviadas: las auto-reacciones no cuentan.
// (Las reacciones de bots al autor sí se mantienen como antes.)
function isValidReceivedReaction(message, reactor) {
    const authorId = message?.author?.id
    if (!authorId || message?.author?.bot) return false
    if (!reactor) return false
    return String(authorId) !== String(reactor.id)
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

// Candado por (servidor, usuario, logro): dos eventos concurrentes (dos
// mensajes seguidos, doble clic en /easteregg, reacción + mensaje...) no
// pueden conceder el mismo nivel dos veces. El segundo espera al primero
// y revalida el flag antes de decidir.
const inflightGrants = new Map()

// Entrega un nivel: marca flag + suma XP (+ mensual) + rol de
// récord. Devuelve el objeto de desbloqueo si fue nuevo, o null si ya estaba.
// El envío del anuncio se hace aparte para poder agrupar varios.
async function grantRecord(client, guild, guildId, userId, recordId, threshold) {
    const found = recordsConfig.allRecords().find(x => x.record.id === recordId)
    const tier = found?.record.tiers.find(t => t.threshold === threshold)
    if (!tier) return null

    const resolvedGuildId = String(guild?.id || guildId || "")
    if (!resolvedGuildId) return null

    const key = `${recordId}:${threshold}`
    const lockKey = `${resolvedGuildId}:${String(userId)}:${key}`

    while (inflightGrants.has(lockKey)) {
        try { await inflightGrants.get(lockKey) } catch {}
        const check = await client.db.fetch(resolvedGuildId).exec().catch(() => null)
        if (check?.users?.[String(userId)]?.records?.[key]) return null
    }

    let release
    inflightGrants.set(lockKey, new Promise(resolve => { release = resolve }))
    try {
        return await grantRecordInner(client, guild, resolvedGuildId, userId, found, tier, key)
    } finally {
        inflightGrants.delete(lockKey)
        release()
    }
}

async function grantRecordInner(client, guild, resolvedGuildId, userId, found, tier, key) {
    const recordId = found.record.id
    const threshold = tier.threshold

    const fresh = await client.db.fetch(resolvedGuildId).exec().catch(() => null)
    if (fresh?.users?.[String(userId)]?.records?.[key]) return null

    const settings = fresh?.settings
    const beforeUser = fresh?.users?.[String(userId)] || {}
    const oldXP = Number(beforeUser.xp) || 0
    const oldLevel = settings ? Tools.global.getLevel(oldXP, settings) : 0

    // XP de récords period-aware: si el marcador del usuario (fallback el
    // global) no es el actual, su daily/monthly es de otro periodo y se
    // empieza en tier.xp en vez de incrementar lo viejo. Sin esto, un récord
    // ganado en el primer mensaje del día/mes sumaría sobre lo de ayer.
    const updates = { $set: { [`users.${userId}.records.${key}`]: true } }
    if (tier.xp > 0) {
        let dailyStale = false
        let monthlyStale = false
        try {
            const today = getMadridDay(new Date())
            const month = getMadridMonth(new Date())
            dailyStale = beforeUser.dailyPeriod
                ? String(beforeUser.dailyPeriod) !== today
                : true
            monthlyStale = beforeUser.monthlyPeriod
                ? String(beforeUser.monthlyPeriod) !== month
                : true
            if (dailyStale) {
                updates.$set[`users.${userId}.dailyXP`] = tier.xp
                updates.$set[`users.${userId}.dailyPeriod`] = today
            }
            if (monthlyStale) {
                updates.$set[`users.${userId}.monthlyXP`] = tier.xp
                updates.$set[`users.${userId}.monthlyPeriod`] = month
            }
        } catch {}
        updates.$inc = {
            [`users.${userId}.xp`]: tier.xp,
            ...(!monthlyStale ? { [`users.${userId}.monthlyXP`]: tier.xp } : {}),
            ...(!dailyStale ? { [`users.${userId}.dailyXP`]: tier.xp } : {}),
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
    const unlockedKeys = new Set(keys)
    // done cuenta solo tiers del catálogo actual: los flags huérfanos de
    // catálogos viejos no deben inflar el "x/y fases" (p. ej. 4/3).
    const done = Math.min(
        found.record.tiers.filter(t => unlockedKeys.has(`${recordId}:${t.threshold}`)).length || 1,
        found.record.tiers.length
    )
    // Totales globales del usuario (como /records: los ocultos siempre cuentan en el total).
    const doneVisible = recordsConfig.visibleRecords().reduce((n, { record }) =>
        n + record.tiers.filter(t => unlockedKeys.has(`${record.id}:${t.threshold}`)).length, 0)
    const doneHidden = recordsConfig.hiddenRecords().reduce((n, { record }) =>
        n + record.tiers.filter(t => unlockedKeys.has(`${record.id}:${t.threshold}`)).length, 0)
    const totalCompleted = doneVisible + doneHidden
    const totalVisible = recordsConfig.countTiers(recordsConfig.allRecords())

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
// monthlyMessages, dailyMessages, rachas, reacciones, canales, counting,
// voz ni cooldown. El dailyXP sí se ajusta (lleva XP de récords, igual que
// xp y monthlyXP); de todos modos se resetea cada medianoche.
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
                [`users.${userId}.dailyXP`]: Math.max(0, Math.round((Number(userData?.dailyXP) || 0) - removedXp)),
            },
        },
        removedXp,
        count: keys.length,
    }
}

// Campos que solo existen por los récords (progreso). messages y
// monthlyMessages NO están aquí a propósito: hay que mantenerlos.
const PROGRESS_FIELDS = ['streak', 'reactionsSent', 'reactionsReceived', 'channels', 'countingSent', 'pokemonCaught', 'voiceMinutes', 'voiceJoined']

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
// Además avisa por DM al autor con la condición real de cada oculto (en
// público solo sale el announce): así sabe por qué lo consiguió sin
// filtrarlo. Si tiene los DMs cerrados no llega y no pasa nada.
async function sendHiddenDm(client, userId, unlocks, avatarUrl = "") {
    const hidden = (unlocks || []).filter(u => u.category?.hidden || u.category?.id === "hidden")
    if (!hidden.length) return false
    try {
        const user = await client?.users?.fetch(String(userId)).catch(() => null)
        if (!user?.send) return false
        // Sin totales X/Y: el DM es del desbloqueo de ahora (ya salen en el
        // canal) y así no hay que cuadrar saltos de línea.
        const titleLine = `## 🎉 ¡Record oculto desbloqueado!`
        const blocks = hidden.map(u => {
            const total = u.total ?? 1
            const rewards = []
            if ((u.tier?.xp || 0) > 0) rewards.push(`${XP_EMOJI} **+${Tools.global.commafy(u.tier.xp)} XP**`)
            return [
                `### ${u.record?.emoji || "🕵️"} **${u.tier?.name}** - ${u.done ?? 1}/${total} ${total === 1 ? "fase" : "fases"}`,
                `> ${u.tier?.desc}`,
                rewards.length ? `-# 🕵️ Ocultos - ${rewards.join(" + ")}` : `-# 🕵️ Ocultos`,
            ].join("\n")
        })
        const recordsChannelId = getRecordIds().channelId
        const where = recordsChannelId ? `<#${recordsChannelId}>` : "#records"
        const footer = `-# En ${where} no se dice cómo lo conseguiste… aquí sí. Shhh, no lo cuentes por ahí.`
        const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        const text = content => new TextDisplayBuilder().setContent(content)
        const container = new ContainerBuilder().setAccentColor(0x8a8f98)
        // Cabecera y primer bloque comparten TextDisplay (igual que #records).
        const first = `${titleLine}\n${blocks[0]}`
        if (avatarUrl) {
            container.addSectionComponents(new SectionBuilder()
                .addTextDisplayComponents(text(first))
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: avatarUrl } })))
        } else {
            container.addTextDisplayComponents(text(first))
        }
        for (const block of blocks.slice(1)) {
            container.addSeparatorComponents(sep())
            container.addTextDisplayComponents(text(block))
        }
        container.addSeparatorComponents(sep())
        container.addTextDisplayComponents(text(footer))
        await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {})
        return true
    } catch {}
    return false
}

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
    await sendHiddenDm(client, userId, unlocks, avatarUrl)
}

// --- Saneado único de la migración al reset lógico --------------------------
// Plan puro (testeable sin DB) para backfill-periods.js: si el marcador del
// usuario no es el periodo actual, sus contadores son brutos viejos y hay
// que ponerlos a 0 sellando el marcador. Null si ya está al día.
function planUserPeriodReset(userId, userData, today, month) {
    const monthlyStale = String(userData?.monthlyPeriod || "") !== String(month)
    const dailyStale = String(userData?.dailyPeriod || "") !== String(today)
    if (!monthlyStale && !dailyStale) return null

    const set = {}
    if (monthlyStale) {
        set[`users.${userId}.monthlyMessages`] = 0
        set[`users.${userId}.monthlyXP`] = 0
        set[`users.${userId}.monthlyPeriod`] = String(month)
    }
    if (dailyStale) {
        set[`users.${userId}.dailyMessages`] = 0
        set[`users.${userId}.dailyXP`] = 0
        set[`users.${userId}.dailyPeriod`] = String(today)
    }
    return {
        userId,
        monthly: monthlyStale,
        daily: dailyStale,
        update: { $set: set },
        zeroedMonthlyMessages: monthlyStale ? (Number(userData?.monthlyMessages) || 0) : 0,
        zeroedMonthlyXP: monthlyStale ? (Number(userData?.monthlyXP) || 0) : 0,
        zeroedDailyMessages: dailyStale ? (Number(userData?.dailyMessages) || 0) : 0,
    }
}

module.exports = {
    getMadridDay,
    getMadridMonth,
    getMadridHour,
    isDailyStale,
    isMonthlyStale,
    getEffectiveDailyMessages,
    getEffectiveDailyXP,
    getEffectiveMonthlyMessages,
    getEffectiveMonthlyXP,
    getRecordIds,
    computeStreakUpdate,
    getStreakCurrent,
    countDistinctChannels,
    isCountingMessage,
    parsePoketwoCatch,
    isPoketwoCatchMessage,
    didTalkToIA,
    parseStarboardMessageId,
    isValidRecordReaction,
    isValidReceivedReaction,
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
    planUserPeriodReset,
    sendHiddenDm,
    sendBatchedUnlocks,
}
