const rank = require('../slash/rank.js')
const { MessageFlags } = require('discord.js')

module.exports = {
    metadata: { name: 'button:rank_style' },
    async run(client, int, tools) {
        const [, ownerId, targetId, style] = int.customId.split('~')
        if (ownerId !== int.user.id) {
            return int.reply({ content: 'Abre tu propio /rank para cambiar tu estilo.', flags: MessageFlags.Ephemeral })
        }
        if (!/^\d{17,20}$/.test(targetId || '') || !['old', 'new'].includes(style)) return
        await int.deferUpdate()
        await client.db.update(int.guild.id, {
            $set: { [`users.${int.user.id}.rankStyle`]: style }
        }).exec()
        // run reutiliza el renderizado de /rank conservando el miembro consultado.
        return rank.run(client, int, tools, { targetId, style, update: true })
    }
}
