const LevelUpMessage = require("../../classes/LevelUpMessage.js")
const OvertakeMessage = require("../../classes/OvertakeMessage.js")
const { isProRank, getOvertakenIds } = require("../events/message.js")

module.exports = {
metadata: {    permission: "ManageGuild",
    name: "addxp",
    description: "Add or remove XP from a member. (requires manage server permission)",
    args: [
        { type: "user", name: "member", description: "Which member to modify", required: true },
        { type: "integer", name: "xp", description: "How much XP to add (negative number to remove XP)", min: -1e10, max: 1e10, required: true },
        { type: "string", name: "operation", description: "How the XP amount should be interpreted", required: false, choices: [
            {name: "Add XP", value: "add_xp"},
            {name: "Set XP to", value: "set_xp"},
            {name: "Add levels", value: "add_level"},
            {name: "Set level to", value: "set_level"},
        ]},
    ]
},

async run(client, int, tools) {

    const member = int.options.get("member")?.member
    const amount = int.options.get("xp")?.value
    const operation = int.options.get("operation")?.value || "add_xp"

    let user = member?.user
    if (!user) return tools.warn("I couldn't find that member!")

    let db = await tools.fetchSettings(user.id)
    if (!db) return tools.warn("*noData")
    else if (!tools.canManageServer(int.member, db.settings.manualPerms)) return tools.warn("*notMod")
    else if (!db.settings.enabled) return tools.warn("*xpDisabled")

    if (amount === 0 && operation.startsWith("add")) return tools.warn("Invalid amount of XP!")
    else if (user.bot) return tools.warn("You can't give XP to bots, silly!")

    let currentXP = db.users[user.id]
    let xp = currentXP?.xp || 0
    let level = tools.getLevel(xp, db.settings)

    let newXP = xp
    let newLevel = level

    switch (operation) {
        case "add_xp": newXP += amount; break;
        case "set_xp": newXP = amount; break;
        case "add_level": newLevel += amount; break;
        case "set_level": newLevel = amount; break;
    }

    newXP = Math.max(0, newXP) // min 0
    newLevel = tools.clamp(newLevel, 0, db.settings.maxLevel) // between 0 and max level

    if (newXP != xp) newLevel = tools.getLevel(newXP, db.settings)
    else if (newLevel != level) newXP = tools.xpForLevel(newLevel, db.settings)

    let syncMode = db.settings.rewardSyncing.sync
    if (syncMode == "xp" || (syncMode == "level" && newLevel != level) || (newLevel > level)) { 
        let roleCheck = tools.checkLevelRoles(int.guild.roles.cache, member.roles.cache, newLevel, db.settings.rewards)
        tools.syncLevelRoles(member, roleCheck).catch(() => {})
    }
    let xpDiff = newXP - xp

    client.db.update(int.guild.id, { $set: { [`users.${user.id}.xp`]: newXP } }).then(async () => {
        int.reply(`${newXP > xp ? "⏫" : "⏬"} ${user.displayName} now has **${tools.commafy(newXP)}** XP${newLevel != level ? ` and is **level ${newLevel}**` : ""}! (previously ${tools.commafy(xp)}, ${xpDiff >= 0 ? "+" : ""}${tools.commafy(xpDiff)})`)

        let pseudoMessage = {
            id: null, content: "",
            attachments: { size: 0 }, stickers: { size: 0 }, embeds: [],
            author: user, member, guild: int.guild, channel: int.channel, client,
        }
        // pasar el registro completo (mensajes incluidos), no solo xp,
        // para que los contadores no salgan a 0 en la tarjeta
        let lvlUserData = { ...(currentXP || {}), xp: newXP }

        // el ranking (para el TOP y para detectar adelantamientos) se lee una
        // sola vez y ya incluye el XP nuevo (el $set de arriba ya se aplico)
        const needLevelCard = newLevel > level && db.settings.levelUp.enabled
        const authorIsPro = db.settings.levelUp.enabled && isProRank(member, newLevel, db.settings)
        let boardDb = null
        if (needLevelCard || authorIsPro) {
            boardDb = await tools.fetchAll(int.guild.id).catch(() => null)
        }

        // level up card (sin mensaje origen: la cita se omite en ese caso)
        if (needLevelCard) {
            let useMultiple = (db.settings.levelUp.multiple > 1 && (db.settings.levelUp.multipleUntil == 0 || (newLevel < db.settings.levelUp.multipleUntil)))
            if (!useMultiple || (newLevel % db.settings.levelUp.multiple == 0)) {
                // todos los usuarios para poder calcular el TOP #rank
                let lvlMessage = new LevelUpMessage(db.settings, pseudoMessage, { oldLevel: level, level: newLevel, userData: lvlUserData, allUsers: boardDb?.users || null, client })
                lvlMessage.send()
            }
        }

        // aviso de adelantamiento (igual que en el flujo de mensajes: solo si
        // el autor es rango Pro y ha subido puestos en la clasificacion).
        // Tambien salta sin subir de nivel, basta con adelantar a alguien.
        if (authorIsPro && boardDb?.users) {
            try {
                const newUsers = boardDb.users
                const newEntry = newUsers[user.id] || {}
                const oldUsers = { ...newUsers, [user.id]: { ...newEntry, xp, hidden: currentXP?.hidden ?? newEntry.hidden } }
                const overtake = getOvertakenIds(oldUsers, newUsers, user.id, db.settings)
                if (overtake) {
                    const overtakeMsg = new OvertakeMessage(db.settings, pseudoMessage, {
                        oldPos: overtake.oldPos,
                        newPos: overtake.newPos,
                        overtakenIds: overtake.overtakenIds,
                        level: newLevel,
                        userData: lvlUserData,
                        client,
                    })
                    overtakeMsg.send()
                }
            } catch {}
        }
}).catch((e) => {
    const msg = `Something went wrong while trying to modify XP! \`\`\`${e.message}\`\`\``;
    tools.warn(msg.length > 2000 ? msg.substring(0, 1997) + '...' : msg);
})
}}