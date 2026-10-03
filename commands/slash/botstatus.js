const { dependencies } = require('../../package.json');
const config = require("../../config.json")

module.exports = {
metadata: {
    name: "botstatus",
    description: "View some details about the bot"
},

async run(client, int, tools) {

    let versionNumber = client.version.version != Math.round(client.version.version) ? client.version.version : client.version.version.toFixed(1)

    // Sin sharding (desarrollo local): evita el crash de client.shard undefined.
    let totalServers = client.guilds.cache.size
    let shardLine = null
    if (client.shard) {
        try {
            let stats = await client.shard.broadcastEval(cl => ({ guilds: cl.guilds.cache.size, users: cl.users.cache.size }))
            totalServers = stats.reduce((a, b) => a + b.guilds, 0)
            shardLine = `**Fragmento:** ${client.shard.id}/${client.shard.count - 1}`
        } catch {}
    }

    const uptimeSecs = Math.floor((client.uptime || 0) / 1000)
    const uptimeStr = uptimeSecs < 60 ? `${uptimeSecs} seg`
        : uptimeSecs < 3600 ? `${Math.floor(uptimeSecs / 60)} min`
        : uptimeSecs < 86400 ? `${Math.floor(uptimeSecs / 3600)} h` : `${Math.floor(uptimeSecs / 86400)} días`

    let botStatus = [
        `**Creador original:** **[Colon](https://gdcolon.com)** 🦊⛩️`,
        `**Versión:** v${versionNumber} - actualizada <t:${Math.round(client.version.updated / 1000)}:R>`,
        ...(shardLine ? [shardLine] : []),
        `**En línea desde hace:** ${uptimeStr}`,
        `**Servidores:** ${tools.commafy(totalServers)}${client.shard && client.shard.count != 1 ? ` (en este fragmento: ${tools.commafy(client.guilds.cache.size)})` : ""}`,
        `**Memoria usada:** ${Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2))} MB`
    ]

    let embed = tools.createEmbed({
        author: { name: client.user.displayName, iconURL: client.user.avatarURL() },
        color: tools.COLOR, timestamp: true, footer: "Midiendo ping...",
        description: botStatus.join("\n")
    })

    let infoButtons = [{style: "Link", label: "Website", url: `${tools.WEBSITE}`}]
    if (config.changelogURL) infoButtons.push({style: "Link", label: "Changelog", url: config.changelogURL})
    if (config.supportURL) infoButtons.push({style: "Link", label: "Support", url: config.supportURL})

    int.reply({embeds: [embed], components: tools.row(tools.button(infoButtons)), fetchReply: true}).then(msg => {
        embed.setFooter({ text: `Ping: ${tools.commafy(msg.createdTimestamp - int.createdTimestamp)}ms`})
        int.editReply({ embeds: [embed], components: msg.components })
    })

}}