const Discord = require('discord.js')
module.exports = {
metadata: {
    name: "sync",
    description: "Sincroniza tus roles de nivel (añade los que falten y quita los que sobren).",
    args: [
        { type: "user", name: "member", description: "Qué miembro sincronizar (requiere permiso de gestionar el servidor)", required: false }
    ]
},

async run(client, int, tools) {

    let foundUser = int.options?.get?.("member")
    let member = foundUser ? foundUser.member : int.member
    // El miembro puede ser null si salió del servidor: sin esto revienta member.id.
    if (!member) return tools.warn("No se ha encontrado a ese miembro en el servidor.")
    if (!int.guild.members.me.permissions.has(Discord.PermissionFlagsBits.ManageRoles)) return tools.warn("*cantManageRoles")

    let db = await tools.fetchSettings(member.id)
    if (!db) return tools.warn("*noData")
    else if (!db.settings.enabled) return tools.warn("*xpDisabled")

    let isMod = db.settings.manualPerms ? tools.canManageRoles() : tools.canManageServer()
    if (member.id != int.user.id && !isMod) return tools.warn("No tienes permiso para sincronizar los roles de otra persona.")

    else if (db.settings.noManual && !isMod) return tools.warn("No tienes permiso para sincronizar tus roles de nivel.")
    else if (!db.settings.rewards.length) return tools.warn("Este servidor no tiene roles de recompensa.")

    let currentXP = db.users[member.id]
    if (!currentXP || !currentXP.xp) return tools.noXPYet(member.user)

    let xp = currentXP.xp
    let level = tools.getLevel(xp, db.settings)

    let currentRoles = member.roles.cache
    let roleCheck = tools.checkLevelRoles(int.guild.roles.cache, currentRoles, level, db.settings.rewards)
    if (!roleCheck.incorrect.length && !roleCheck.missing.length) return int.reply("✅ ¡Tus roles de nivel ya están sincronizados!")

    tools.syncLevelRoles(member, roleCheck).then(() => {
        let replyStr = ["🔄 **¡Roles de nivel sincronizados!**"]
        if (roleCheck.missing.length) replyStr.push(`Añadidos: ${roleCheck.missing.map(x => `<@&${x.id}>`).join(" ")}`)
        if (roleCheck.incorrect.length) replyStr.push(`Quitados: ${roleCheck.incorrect.map(x => `<@&${x.id}>`).join(" ")}`)
        return int.reply(replyStr.join("\n"))
    }).catch(() => int.reply("¡Error al sincronizar los roles!"))

}}