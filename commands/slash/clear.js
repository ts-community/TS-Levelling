module.exports = {
metadata: {
    permission: "ManageGuild",
    name: "clear",
    description: "Quita el cooldown a un miembro. (requiere permiso de gestionar el servidor)",
    args: [
        { type: "user", name: "member", description: "A qué miembro quitarle el cooldown", required: true }
    ]
},

async run(client, int, tools) {

    const user = int.options.get("member")?.user
    if (!user) return tools.warn("No se ha encontrado a ese miembro.")

    let db = await tools.fetchSettings(user.id)
    if (!db) return tools.warn("*noData")
    else if (!tools.canManageServer(int.member, db.settings.manualPerms)) return tools.warn("*notMod")
    else if (!db.settings.enabled) return tools.warn("*xpDisabled")

    if (user.bot) return tools.warn("¡Los bots no tienen cooldowns, bobo!")

    let current = db.users[user.id]
    let cooldown = current?.cooldown
    if (!cooldown || cooldown <= Date.now()) return tools.warn("¡Este miembro no tiene ningún cooldown activo!")

    client.db.update(int.guild.id, { $set: { [`users.${user.id}.cooldown`]: 0 } }).then(() => {
        int.reply(`🔄 **¡Cooldown de ${tools.pluralS(user.displayName)} reiniciado!** (antes ${tools.timestamp(cooldown - Date.now())})`)
    }).catch(() => tools.warn("¡Algo ha salido mal al reiniciar el cooldown!"))

}}