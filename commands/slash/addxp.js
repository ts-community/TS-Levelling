const LevelUpMessage = require("../../classes/LevelUpMessage.js")
const OvertakeMessage = require("../../classes/OvertakeMessage.js")
const { isProRank, getOvertakenIds, withAuthorLock } = require("../events/message.js")

module.exports = {
metadata: {    permission: "ManageGuild",
    name: "addxp",
    description: "Añade o quita XP a un miembro. (requiere permiso de gestionar el servidor)",
    args: [
        { type: "user", name: "member", description: "A qué miembro modificar", required: true },
        { type: "integer", name: "xp", description: "Cuánto XP añadir (negativo para quitar)", min: -1e10, max: 1e10, required: true },
        { type: "string", name: "operation", description: "Cómo interpretar la cantidad", required: false, choices: [
            {name: "Añadir XP", value: "add_xp"},
            {name: "Fijar XP en", value: "set_xp"},
            {name: "Añadir niveles", value: "add_level"},
            {name: "Fijar nivel en", value: "set_level"},
        ]},
    ]
},

async run(client, int, tools) {
    const lockUser = int.options.get("member")?.member?.user
    if (!lockUser) return tools.warn("No se ha encontrado a ese miembro.")
    return withAuthorLock(int.guild?.id, lockUser.id, () => module.exports.runInner(client, int, tools))
},

async runInner(client, int, tools) {

    const member = int.options.get("member")?.member
    const amount = int.options.get("xp")?.value
    const operation = int.options.get("operation")?.value || "add_xp"

    let user = member?.user
    if (!user) return tools.warn("No se ha encontrado a ese miembro.")

    let db = await tools.fetchSettings(user.id)
    if (!db) return tools.warn("*noData")
    else if (!tools.canManageServer(int.member, db.settings.manualPerms)) return tools.warn("*notMod")
    else if (!db.settings.enabled) return tools.warn("*xpDisabled")

    if (amount === 0 && operation.startsWith("add")) return tools.warn("¡Cantidad de XP no válida!")
    else if (user.bot) return tools.warn("¡No puedes dar XP a bots, bobo!")

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
        int.reply(`${newXP > xp ? "⏫" : "⏬"} ¡${user.displayName} ahora tiene **${tools.commafy(newXP)}** de XP${newLevel != level ? ` y es **nivel ${newLevel}**` : ""}! (antes ${tools.commafy(xp)}, ${xpDiff >= 0 ? "+" : ""}${tools.commafy(xpDiff)})`)

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
}).catch(() => {
    tools.warn("¡Algo ha salido mal al modificar el XP!");
})
}}