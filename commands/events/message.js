const LevelUpMessage = require("../../classes/LevelUpMessage.js")
const config = require("../../config.json")

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
            // userData viene de antes del $inc de este mensaje: sumar 1 en
            // memoria para que el contador salga correcto en la tarjeta
            userData.messages = (userData.messages || 0) + 1
            userData.monthlyMessages = (userData.monthlyMessages || 0) + 1
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

}}