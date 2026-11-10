const rank = require('../slash/rank.js')
const ranks = require('../../consts/ranks')
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
        const save = client.db.update(int.guild.id, {
            $set: { [`users.${int.user.id}.rankStyle`]: style }
        }).exec()
        const components = int.message?.components?.map(c => c.toJSON())
        const container = components?.find(c => c.type === 17)
        if (container) {
            // Solo cambia la presentación: conserva los datos, el avatar y el banner adjunto.
            const modern = style === 'new'
            const section = container.components.find(c => c.type === 9)
            const text = section?.components?.find(c => c.type === 10)
            const tier = ranks.find(r => r.roles.some(role => text?.content.includes(`<@&${role.id}>`)))
            const role = tier?.roles.find(role => text.content.includes(`<@&${role.id}>`))
            const colors = { bronze: '#e08a45', silver: '#6f9cff', gold: '#f7c844', diamond: '#4fd0f5', mythic: '#d45cff', legendary: '#ff4a3d', masters: '#62d64a', pro: '#d9dde6' }
            if (role) {
                text.content = text.content.replace(/^## <a?:[^>]+>/, `## ${modern ? role.emoji : (role.legacyEmoji || role.emoji)}`)
                container.accent_color = parseInt((modern ? colors[tier.rank] : tier.color).slice(1), 16)
            }
            const row = container.components.find(c => c.type === 1 && c.components.some(b => b.custom_id?.startsWith('rank_style~')))
            const button = row?.components.find(b => b.custom_id?.startsWith('rank_style~'))
            if (button) {
                button.custom_id = `rank_style~${ownerId}~${targetId}~${modern ? 'old' : 'new'}`
                button.label = modern ? 'Cambiar a Vista Legacy' : 'Cambiar a Vista Predeterminada'
                const emoji = modern ? (role?.legacyEmoji || role?.emoji) : role?.emoji
                const match = emoji?.match(/<(a?):([^:]+):(\d+)>/)
                if (match) button.emoji = { animated: !!match[1], name: match[2], id: match[3] }
                await Promise.all([save, int.message.edit({ components, allowedMentions: { parse: [] } })])
                return
            }
        }
        await save
        return rank.run(client, int, tools, { targetId, style, update: true })
    }
}
