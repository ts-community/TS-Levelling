const LevelUpMessage = require("../../classes/LevelUpMessage.js")
const OvertakeMessage = require("../../classes/OvertakeMessage.js")
const Tools = require("../../classes/Tools.js")
const config = require("../../config.json")
const recordsConfig = require("../../config/records.js")
const tracker = require("../../classes/RecordTracker.js")

// Helpers compartidos (viven en RecordTracker para que grantRecord pueda
// comprobar level-up/adelantamiento sin ciclos de require).
const { isProRank, getOvertakenIds } = tracker
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000

// Candado por (servidor, autor): los eventos del mismo usuario se procesan
// en serie. Sin esto, dos mensajes (o dos /addxp) seguidos pueden leerse
// mutuamente antes de que el write del XP llegue a la DB y anunciar dos
// veces el mismo level-up o el mismo adelantamiento.
const authorLocks = new Map()

async function withAuthorLock(guildId, userId, fn) {
    const key = `${guildId}:${userId}`
    const prev = authorLocks.get(key)
    if (prev) { try { await prev } catch {} }
    let release
    const mine = new Promise(resolve => { release = resolve })
    authorLocks.set(key, mine)
    try {
        return await fn()
    } finally {
        if (authorLocks.get(key) === mine) authorLocks.delete(key)
        release()
    }
}

module.exports = {

async run(client, message, tools) {
    return withAuthorLock(message.guild?.id, message.author?.id, () => module.exports.runInner(client, message, tools))
},

async runInner(client, message, tools) {

    if (config.lockBotToDevOnly && !tools.isDev(message.author)) return

    // fetch server xp settings fresh from the db on every message,
    // so settings changes always apply immediately (no caching here)
    const author = message.author.id
    let db = await tools.fetchSettings(author, message.guild.id)
    if (!db || !db.settings?.enabled) return

    // pass the full server document so monthly maintenance can compare
    // periods and snapshot all users without extra reads or spurious writes
    const fullServer = await client.db.fetch(message.guild.id).exec()
    await client.monthlyMaintenance(message.guild, fullServer)
    db = await tools.fetchSettings(author, message.guild.id)

    let settings = db.settings

    // fetch user's xp, or give them 0
    let userData = db.users[author] || { xp: 0, cooldown: 0 }

    // Sin miembro no hay roles ni XP que asignar (webhooks o usuarios que
    // ya no están en el servidor): se intenta una vez desde la API y si
    // sigue sin haberlo se ignora el mensaje antes de contar nada.
    if (!message.member && message.guild) {
        try { message.member = await message.guild.members.fetch(author).catch(() => null) } catch {}
    }
    if (!message.member) return

    await client.db.update(message.guild.id, {
        $inc: {
            [`users.${author}.messages`]: 1,
            [`users.${author}.monthlyMessages`]: 1,
            [`users.${author}.dailyMessages`]: 1
        }
    }).exec()

    // Progreso de récords (cuenta aunque el XP esté en cooldown).
    // No bloquea el XP si falla: todo va en try/catch.
    const pendingUnlocks = []
    try {
        const countingId = tracker.getRecordIds().countingChannelId
            || recordsConfig.allRecords().find(x => x.record.id === "counting")?.record.mechanic.channelId
        let previousCountingMessage = null
        if (String(message.channelId) === String(countingId) && message.channel?.messages?.fetch) {
            previousCountingMessage = await message.channel.messages.fetch({ limit: 1, before: message.id })
                .then(messages => messages.first?.() || null)
                .catch(() => null)
        }
        const isCounting = tracker.isCountingMessage(message, countingId, previousCountingMessage)
        const streakUpdate = tracker.computeStreakUpdate(userData.streak)
        const channelKey = `users.${author}.channels.${message.channelId}`
        const progressUpdate = { $set: { [`users.${author}.streak`]: streakUpdate } }
        progressUpdate.$inc = { [channelKey]: 1 }
        if (isCounting) progressUpdate.$inc[`users.${author}.countingSent`] = 1
        client.db.update(message.guild.id, progressUpdate).exec().catch(() => {})

        // Snapshot en memoria para comprobar umbrales sin otra lectura.
        const messagesNow = (userData.messages || 0) + 1
        const monthlyNow = (userData.monthlyMessages || 0) + 1
        const dailyNow = (userData.dailyMessages || 0) + 1
        const countingNow = (userData.countingSent || 0) + (isCounting ? 1 : 0)
        const streakNow = streakUpdate.current
        const channelsNow = tracker.countDistinctChannels(userData.channels) +
            (userData.channels?.[message.channelId] ? 0 : 1)
        const tenureNow = message.member?.joinedTimestamp
            ? (Date.now() - message.member.joinedTimestamp) / MS_PER_YEAR
            : 0
        const unlocked = tracker.unlockedIdSet(userData)
        const byId = Object.fromEntries(recordsConfig.allRecords().map(({ record }) => [record.id, record]))
        const counterChecks = [
            [byId.messages, messagesNow],
            [byId.monthly_messages, monthlyNow],
            [byId.daily_messages, dailyNow],
            [byId.counting, countingNow],
            [byId.streak, streakNow],
            [byId.distinct_channels, channelsNow],
            [byId.tenure, tenureNow],
        ]
        for (const [record, value] of counterChecks) {
            if (!record) continue
            for (const threshold of tracker.newlyReachedThresholds(record, value, unlocked)) {
                unlocked.add(`${record.id}:${threshold}`)
                const unlockInfo = await tracker.grantRecord(client, message.guild, message.guild.id, author, record.id, threshold)
                if (unlockInfo) pendingUnlocks.push(unlockInfo)
            }
        }

        // Eventos puros por mensaje.
        const nightRecord = byId.night_owl
        if (nightRecord) {
            const hour = tracker.getMadridHour(new Date())
            const { startHour = 4, endHour = 5 } = nightRecord.mechanic || {}
            if (hour >= startHour && hour < endHour && !unlocked.has(`night_owl:${nightRecord.tiers[0].threshold}`)) {
                unlocked.add(`night_owl:${nightRecord.tiers[0].threshold}`)
                const unlockInfo = await tracker.grantRecord(client, message.guild, message.guild.id, author, "night_owl", nightRecord.tiers[0].threshold)
                if (unlockInfo) pendingUnlocks.push(unlockInfo)
            }
        }

        const talkRecord = byId.talk_to
        if (talkRecord && !unlocked.has(`talk_to:${talkRecord.tiers[0].threshold}`)) {
            const iaBotId = tracker.getRecordIds().iaBotId || talkRecord.mechanic?.userId
            let isTalk = tracker.didTalkToIA(message, iaBotId)
            if (!isTalk && message.reference?.messageId) {
                try {
                    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
                    if (ref && String(ref.author?.id) === String(iaBotId)) isTalk = true
                } catch {}
            }
            if (isTalk) {
                unlocked.add(`talk_to:${talkRecord.tiers[0].threshold}`)
                const unlockInfo = await tracker.grantRecord(client, message.guild, message.guild.id, author, "talk_to", talkRecord.tiers[0].threshold)
                if (unlockInfo) pendingUnlocks.push(unlockInfo)
            }
        }

        // Comando escondido /roger
        const hiddenCmdRecord = byId.hidden_command
        if (hiddenCmdRecord && !unlocked.has(`hidden_command:${hiddenCmdRecord.tiers[0].threshold}`)) {
            if (message.content?.startsWith("/roger") || message.content?.startsWith("</roger:")) {
                unlocked.add(`hidden_command:${hiddenCmdRecord.tiers[0].threshold}`)
                const unlockInfo = await tracker.grantRecord(client, message.guild, message.guild.id, author, "hidden_command", hiddenCmdRecord.tiers[0].threshold)
                if (unlockInfo) pendingUnlocks.push(unlockInfo)
            }
        }

        // Palabra secreta "lentejas"
        const secretRecord = byId.secret_word
        if (secretRecord && !unlocked.has(`secret_word:${secretRecord.tiers[0].threshold}`)) {
            const phrase = secretRecord.mechanic?.phrase?.toLowerCase()
            if (phrase && message.content?.toLowerCase().includes(phrase)) {
                unlocked.add(`secret_word:${secretRecord.tiers[0].threshold}`)
                const unlockInfo = await tracker.grantRecord(client, message.guild, message.guild.id, author, "secret_word", secretRecord.tiers[0].threshold)
                if (unlockInfo) pendingUnlocks.push(unlockInfo)
            }
        }

        // Economía: cualquier mensaje del canal dedicado cuenta como participación.
        const economyRecord = byId.economy_participation
        const economyChannelId = economyRecord?.mechanic?.channelId
        if (economyRecord && economyChannelId && String(message.channelId) === String(economyChannelId)) {
            const threshold = economyRecord.tiers[0].threshold
            const key = `${economyRecord.id}:${threshold}`
            if (!unlocked.has(key)) {
                unlocked.add(key)
                const unlockInfo = await tracker.grantRecord(
                    client, message.guild, message.guild.id, author,
                    economyRecord.id, threshold,
                )
                if (unlockInfo) pendingUnlocks.push(unlockInfo)
            }
        }
    } catch {}

    // Enviar todos los desbloqueos de golpe (batching)
    if (pendingUnlocks.length) {
        try {
            let avatarUrl = ""
            try {
                if (message.member && typeof message.member.displayAvatarURL === "function") {
                    avatarUrl = message.member.displayAvatarURL({ format: "png", dynamic: true })
                }
            } catch {}
            await tracker.sendBatchedUnlocks({ client, userId: author, avatarUrl, unlocks: pendingUnlocks })
        } catch {}
    }

    const milestoneRoleId = config.roles?.milestones?.id
    if (milestoneRoleId) {
        const role = message.guild.roles.cache.get(milestoneRoleId)
        if (role && !message.member.roles.cache.has(milestoneRoleId)) {
            message.member.roles.add(role).catch(() => {})
        }
    }

    if (userData.cooldown > Date.now()) return // on cooldown, stop here

    // check role+channel multipliers, exit if 0x
    let multiplierData = tools.getMultiplier(message.member, settings, message.channel)
    if (multiplierData.multiplier <= 0) return

    // Obtener el XP actual de la DB (incluye XP de récords añadidos por grantRecord)
    // antes de calcular el XP del mensaje.
    const freshUser = await client.db.fetch(message.guild.id, [`users.${author}.xp`]).exec()
    let oldXP = freshUser?.users?.[author]?.xp ?? userData.xp
    
    // randomly choose an amount of XP to give
    let xpRange = [settings.gain.min, settings.gain.max].map(x => Math.round(x * multiplierData.multiplier))
    let xpGained = tools.rng(...xpRange) // number between min and max, inclusive

    if (xpGained > 0) userData.xp += Math.round(xpGained)
    else return

    const awardedXP = Math.round(xpGained)
    userData.xp = oldXP + awardedXP
    
    // set xp cooldown
    if (settings.gain.time > 0) userData.cooldown = Date.now() + (settings.gain.time * 1000)
    
    // if hidden from leaderboard, unhide since they're no longer inactive
    if (userData.hidden) userData.hidden = false

    // database update: usa $inc para el XP del mensaje, así se suma al XP
    // actual de la DB (incluyendo el XP de récords que pudo añadir grantRecord).
    client.db.update(message.guild.id, {
        $inc: {
            [`users.${author}.xp`]: awardedXP,
            [`users.${author}.monthlyXP`]: awardedXP,
            [`users.${author}.dailyXP`]: awardedXP
        },
        $set: {
            [`users.${author}.cooldown`]: userData.cooldown,
            [`users.${author}.hidden`]: userData.hidden || false
        }
    }).exec();

    // Actualizar userData.xp en memoria para el level-up check
    userData.xp = oldXP + awardedXP

    // check for level up
    let oldLevel = tools.getLevel(oldXP, settings)
    let newLevel = tools.getLevel(userData.xp, settings)
    let levelUp = newLevel > oldLevel

    // userData viene de antes del $inc de este mensaje: sumar 1 en memoria
    // para que el contador de mensajes salga correcto en las tarjetas
    // (level up y adelantamiento comparten este userData)
    userData.messages = (userData.messages || 0) + 1
    userData.monthlyMessages = (userData.monthlyMessages || 0) + 1

    // auto sync roles on xp gain or level up
    let syncMode = settings.rewardSyncing.sync
    if (syncMode == "xp" || (syncMode == "level" && levelUp)) { 
        let roleCheck = tools.checkLevelRoles(message.guild.roles.cache, message.member.roles.cache, newLevel, settings.rewards, null, oldLevel)
        tools.syncLevelRoles(message.member, roleCheck).catch(() => {})
    }

    // level up message (solo se muestra al conseguir nuevo rol: LevelUpMessage
    // se marca invalido si el salto no da rol; el texto custom del dashboard
    // ya no se renderiza)
    if (levelUp && settings.levelUp.enabled) {
        let useMultiple = (settings.levelUp.multiple > 1 && (settings.levelUp.multipleUntil == 0 || (newLevel < settings.levelUp.multipleUntil)))
        if (!useMultiple || (newLevel % settings.levelUp.multiple == 0)) {
            // ranking con datos frescos (igual que /rank): allUsers es previo
            // al XP de este mensaje y al desocultado, parchearlo en memoria
            let rankUsers = fullServer?.users || null
            if (rankUsers) {
                rankUsers = { ...rankUsers, [author]: { ...rankUsers[author], xp: userData.xp, hidden: false } }
            }
            let lvlMessage = new LevelUpMessage(settings, message, { oldLevel, level: newLevel, userData, allUsers: rankUsers, client })
            lvlMessage.send()
        }
    }

    // Aviso de adelantamiento: si el autor es rango Pro y con el XP de este
    // mensaje ha subido puestos en la clasificacion global, se anuncia en el
    // mismo canal de level up. Da juego/pique en la parte alta del top.
    // Sin cooldowns: cada adelantamiento se anuncia en el momento.
    if (settings.levelUp?.enabled && fullServer?.users && isProRank(message.member, newLevel, settings)) {
        try {
            const oldUsers = fullServer.users
            const newUsers = { ...oldUsers, [author]: { ...oldUsers[author], xp: userData.xp, hidden: false } }
            const overtake = getOvertakenIds(oldUsers, newUsers, author, settings)
            if (overtake) {
                const overtakeMsg = new OvertakeMessage(settings, message, {
                    oldPos: overtake.oldPos,
                    newPos: overtake.newPos,
                    overtakenIds: overtake.overtakenIds,
                    level: newLevel,
                    userData,
                    client,
                })
                overtakeMsg.send()
            }
        } catch {}
    }

}}

module.exports.isProRank = isProRank
module.exports.getOvertakenIds = getOvertakenIds
module.exports.withAuthorLock = withAuthorLock