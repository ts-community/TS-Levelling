const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} = require("discord.js")

module.exports = {
    metadata: {
        name: "web",
        description: "Ver el dashboard web del servidor (clasificación, rango y Records).",
    },

    async run(client, int, tools) {
        // Respuesta pública: los enlaces son los mismos para todo el mundo.
        // En Components V2, los enlaces son botones de enlace.
        const guildId = int.guild.id
        const text = content => new TextDisplayBuilder().setContent(content)
        const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        const link = (label, emoji, url) =>
            new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url).setEmoji({ name: emoji })

        const container = new ContainerBuilder()
            .setAccentColor(0x87f3ff)
            .addTextDisplayComponents(text("## 🌎 Dashboard web"))
            .addTextDisplayComponents(text(
                "Todo lo del bot, también en el navegador: el top con varias categorías, tu rango, el progreso por niveles, los roles de recompensa y tus Records con sus estadísticas."
            ))
            .addSeparatorComponents(sep())
            .addActionRowComponents(new ActionRowBuilder().addComponents(
                link("Clasificación", "🏆", `${tools.WEBSITE}/leaderboard/${guildId}`),
                link("Mi rango", "📇", `${tools.WEBSITE}/rank/${guildId}`),
                link("Mis Records", "⭐", `${tools.WEBSITE}/records/${guildId}`),
            ))
            .addSeparatorComponents(sep())
            .addTextDisplayComponents(text(
                "-# En la web puedes cambiar la categoría del top (XP, mensajes, Poketwo, voz, monedas…) con el botón flotante del clasificador."
            ))

        return int.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        })
    }
}
