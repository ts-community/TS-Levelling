const MonthlyTop = require("../../classes/MonthlyTop.js")

module.exports = {
    metadata: {
        permission: "ManageGuild",
        name: "topmensual",
        description: "Envía el top del último mes cerrado al canal que elijas.",
        args: [
            { type: "channel", name: "canal", description: "Canal donde enviar el mensaje", required: true },
            { type: "string", name: "tipo", description: "Qué mensaje enviar (por defecto: ambos)", required: false, choices: [
                { name: "Top público", value: "publico" },
                { name: "Plantilla para #anuncios", value: "anuncio" },
                { name: "Ambos", value: "ambos" },
            ]},
            { type: "bool", name: "roles", description: "Reasignar los roles de miembros y del staff del mes", required: false },
            { type: "bool", name: "monedas", description: "Entregar las monedas a los ganadores si no se entregaron", required: false },
            { type: "string", name: "apertura", description: "Texto de apertura para el mensaje", required: false },
            { type: "string", name: "cierre", description: "Texto de cierre para el mensaje", required: false },
            { type: "bool", name: "simular", description: "Probar el estilo sin entregar monedas ni tocar roles", required: false },
        ]
    },

    async run(client, int, tools) {
        if (!tools.canManageServer(int.member)) return tools.warn("*notMod")
        if (int.guild.id !== MonthlyTop.MAIN_GUILD_ID) return tools.warn("Este comando solo funciona en el servidor principal.")

        await int.deferReply({ flags: 64 })

        // Si el bot estuvo apagado durante el cambio de mes, el rollover no
        // pudo ejecutarse desde el scheduler. Fuerza aquí el mantenimiento
        // antes de leer el snapshot para que el comando use el último mes
        // cerrado disponible.
        if (typeof client.monthlyMaintenance === "function") {
            await client.monthlyMaintenance(int.guild)
        }

        const db = await tools.fetchAll()
        const snapshot = db?.info?.monthlyTop
        if (!snapshot?.period || (!snapshot.members?.length && !snapshot.staff?.length)) {
            return int.editReply({
                content: "Todavía no hay un top mensual cerrado. Espera al cambio de mes o usa /top para forzar el mantenimiento."
            })
        }

        const channel = int.options.getChannel("canal")
        const type = int.options.getString("tipo") || "ambos"
        const reassignRoles = !!int.options.getBoolean("roles")
        const giveCoins = !!int.options.getBoolean("monedas")
        const opening = int.options.getString("apertura") || undefined
        const closing = int.options.getString("cierre") || undefined
        const simulate = !!int.options.getBoolean("simular")

        const results = []
        const hasSavedRewards = !!snapshot.rewards && ["members", "staff"].some(kind =>
            (snapshot.rewards[kind] || []).length > 0)
        let rewards = hasSavedRewards ? MonthlyTop.buildRewardView(snapshot, snapshot.rewards) : null

        if (simulate) {
            rewards = MonthlyTop.buildRewardView(snapshot)
            for (const kind of ["members", "staff"]) {
                for (const reward of rewards[kind]) reward.delivered = true
            }
            if (reassignRoles || giveCoins) {
                results.push("🧪 Modo simulación: no se entregan monedas ni se tocan roles.")
            }
        }

        if (reassignRoles && !simulate) {
            const roles = await MonthlyTop.assignTopRoles(int.guild, snapshot, snapshot.period)
            results.push(roles.error
                ? `❌ Roles: ${roles.error}.`
                : `✅ Roles actualizados: ${roles.assigned} asignados, ${roles.removed} retirados.`)
        }
        if (giveCoins && !simulate) {
            const coins = await MonthlyTop.giveMonthlyCoins(client, int.guild, snapshot, snapshot.period, snapshot.rewards)
            rewards = coins.rewards
            results.push(coins.error
                ? `❌ Monedas: ${coins.error}.`
                : `✅ Monedas entregadas: ${coins.given}, fallidas: ${coins.failed}.`)
        }

        if (type === "publico" || type === "ambos") {
            const sent = await MonthlyTop.sendPublicTop(client, int.guild, channel, snapshot, snapshot.period, { rewards, opening, closing })
            results.push(sent ? "✅ Top público enviado." : "❌ No se pudo enviar el top público.")
        }
        if (type === "anuncio" || type === "ambos") {
            const sent = await MonthlyTop.sendAdminTemplate(client, int.guild, channel, snapshot, snapshot.period, { rewards, opening, closing })
            results.push(sent ? "✅ Plantilla de anuncio enviada." : "❌ No se pudo enviar la plantilla de anuncio.")
        }

        return int.editReply({ content: results.join("\n") })
    }}
