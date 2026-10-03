const Discord = require('discord.js')
module.exports = {
metadata: {
    name: "button:toggle_xp",
},

async run(client, int, tools) {
    let enabled = int.component.style == Discord.ButtonStyle.Success
    let db = await tools.fetchSettings()
    if (!db) return tools.warn("*noData")

    let settings = db.settings

    if (!tools.canManageServer(int.member, settings.manualPerms)) return tools.warn("*notMod")

    if (enabled == settings.enabled) return tools.warn(`¡El XP ya está ${enabled ? "activado" : "desactivado"} en este servidor!`)

    client.db.update(int.guild.id, { $set: { 'settings.enabled': enabled, 'info.lastUpdate': Date.now() }}).then(() => {
        int.reply(`✅ **¡XP ${enabled ? "activado" : "desactivado"} en este servidor!**`)
    }).catch(() => tools.warn("¡Algo ha salido mal al cambiar el XP!"))
}}