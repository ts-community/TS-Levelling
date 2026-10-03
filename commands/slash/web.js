module.exports = {
metadata: {
    name: "web",
    description: "Ver el dashboard web del servidor (clasificación, rango y Records).",
},

async run(client, int, tools) {
    // Respuesta pública: los enlaces son los mismos para todo el mundo.
    const guildId = int.guild.id
    const buttons = tools.row(tools.button([
        { style: "Link", label: "Clasificación", emoji: "🏆", url: `${tools.WEBSITE}/leaderboard/${guildId}` },
        { style: "Link", label: "Mi rango", emoji: "📇", url: `${tools.WEBSITE}/rank/${guildId}` },
        { style: "Link", label: "Mis Records", emoji: "⭐", url: `${tools.WEBSITE}/records/${guildId}` },
    ]))

    return int.reply({
        content: "🌎 **Aquí tienes el dashboard web del servidor:**",
        components: buttons,
    })
}}
