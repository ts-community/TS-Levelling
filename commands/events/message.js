const LevelUpMessage = require("../../classes/LevelUpMessage.js")
const OvertakeMessage = require("../../classes/OvertakeMessage.js")
const Tools = require("../../classes/Tools.js")
const ranks = require("../../consts/ranks.js")
const config = require("../../config.json")

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
// global (misma regla que /rank) antes y despues del XP de este mensaje.
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

module.exports = {

async run(client, message, tools) {

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

    await client.db.update(message.guild.id, { 
        $inc: {
            [`users.${author}.messages`]: 1,
            [`users.${author}.monthlyMessages`]: 1
        }
    }).exec()

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

    // randomly choose an amount of XP to give
    let oldXP = userData.xp
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

    // database update
    client.db.update(message.guild.id, {
        $set: {
            [`users.${author}.xp`]: userData.xp,
            [`users.${author}.cooldown`]: userData.cooldown,
            [`users.${author}.hidden`]: userData.hidden || false
        },
        $inc: { [`users.${author}.monthlyXP`]: awardedXP }
    }).exec();

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