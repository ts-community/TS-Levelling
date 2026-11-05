const NICO_ID = "1274473642998108260"

module.exports = {
    metadata: {
        permission: "ManageGuild",
        name: "arreglar-nico",
        description: "Reinicia el máximo de monedas de registros de Nico.",
        args: [],
    },

    async run(client, int, tools) {
        if (!tools.canManageServer(int.member)) return tools.warn("*notMod")

        const guildId = int.guild?.id
        if (!guildId) return tools.warn("Este comando solo puede usarse dentro de un servidor.")

        await int.deferReply({ ephemeral: true })

        try {
            await client.db.update(guildId, {
                $set: {
                    [`users.${NICO_ID}.coinsMax`]: 0,
                    [`users.${NICO_ID}.coinsSyncAt`]: 0,
                },
            }, { upsert: true }).exec()
            return int.editReply({
                content: `✅ Máximo de monedas de registros reiniciado para <@${NICO_ID}>. Su siguiente mensaje volverá a sincronizarlo.`,
            })
        } catch (error) {
            console.warn(`Could not reset coin record maximum for ${NICO_ID} in ${guildId}:`, error.message)
            return int.editReply({ content: "No se pudo reiniciar el máximo de monedas de registros." })
        }
    },
}
