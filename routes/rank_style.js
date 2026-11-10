// La misma preferencia por servidor y usuario que utiliza /rank.
module.exports = function rankStyleRoute(client, getDiscordInfo) {
    return async function(req, res) {
        const guildID = req.method === 'POST' ? req.body?.guildID : req.query.guildID
        const style = req.body?.style
        if (!/^\d{17,20}$/.test(guildID || '')) return res.status(400).json({ apiError: true, message: 'Servidor inválido.' })
        if (req.method === 'POST' && !['old', 'new'].includes(style)) return res.status(400).json({ apiError: true, message: 'Estilo inválido.' })
        const [user, guilds] = await getDiscordInfo(req)
        if (!user || !guilds) return res.status(401).json({ apiError: true, message: 'Inicia sesión para guardar tu preferencia.' })
        if (!guilds.some(g => g.id === guildID)) return res.status(403).json({ apiError: true, message: 'No estás en el servidor.' })
        res.set('Cache-Control', 'no-store')
        if (req.method === 'POST') {
            await client.db.update(guildID, { $set: { [`users.${user.id}.rankStyle`]: style } }).exec()
            return res.json({ style })
        }
        const data = await client.db.fetch(guildID, [`users.${user.id}.rankStyle`])
        return res.json({ style: data?.users?.[user.id]?.rankStyle === 'old' ? 'old' : 'new' })
    }
}
