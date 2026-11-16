const { MessageFlags, PermissionFlagsBits } = require("discord.js")
const { getTenureTimestamp, parseTenureDate } = require("../../classes/Tenure.js")

module.exports = {
    metadata: {
        permission: "Administrator",
        name: "gestion",
        description: "Gestiona los datos de los miembros del servidor.",
        args: [{
            type: "subcommand", name: "antiguedad",
            description: "Consulta o cambia la fecha desde la que cuenta la antigüedad en el bot.",
            args: [
                { type: "user", name: "miembro", description: "Miembro que quieres gestionar", required: true },
                { type: "string", name: "accion", description: "Qué quieres hacer", required: true, choices: [
                    { name: "Consultar", value: "consultar" },
                    { name: "Fijar fecha", value: "fijar" },
                    { name: "Restaurar fecha de Discord", value: "restaurar" },
                ] },
                { type: "string", name: "fecha", description: "Fecha de antigüedad en formato AAAA-MM-DD (obligatoria al fijar)" },
            ],
        }],
    },

    async run(client, int, tools) {
        if (!int.guild) return tools.warn("Este comando solo puede usarse dentro de un servidor.")
        if (!int.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return tools.warn("Necesitas el permiso de Administrador para usar este comando.")
        }
        const action = int.options.get("accion")?.value
        const target = int.options.get("miembro")
        const user = target?.user || target?.member?.user
        if (!user || user.bot) return tools.warn("Selecciona un miembro que no sea un bot.")
        if (!["consultar", "fijar", "restaurar"].includes(action)) return tools.warn("Acción de gestión no válida.")
        const date = int.options.get("fecha")?.value
        const timestamp = parseTenureDate(date)
        if (action === "fijar" && timestamp === null) {
            return tools.warn("Indica una fecha real en formato AAAA-MM-DD que no sea futura. Ejemplo: 2020-06-15.")
        }
        if (action !== "fijar" && date) return tools.warn("La opción fecha solo se utiliza con Fijar fecha.")

        await int.deferReply({ flags: MessageFlags.Ephemeral })
        try {
            const member = await int.guild.members.fetch(user.id).catch(() => null)
            if (!member) return int.editReply({ content: "No se ha encontrado a ese miembro en el servidor." })
            const db = await tools.fetchSettings(user.id, int.guild.id)
            if (!db) return tools.warn("*noData")
            const data = db.users?.[user.id] || {}
            const before = getTenureTimestamp(data, member)
            const path = `users.${user.id}.tenureSince`
            if (action !== "consultar") {
                const update = action === "fijar" ? { $set: { [path]: timestamp } } : { $unset: { [path]: "" } }
                await client.db.update(int.guild.id, update).exec()
            }
            const after = action === "fijar" ? timestamp
                : action === "restaurar" ? getTenureTimestamp(null, member) : before
            const format = value => value ? `<t:${Math.floor(value / 1000)}:D>` : "desconocida"
            const content = action === "consultar"
                ? `🏅 Antigüedad de <@${user.id}> desde ${format(after)} (${data.tenureSince ? "fecha personalizada" : "fecha de Discord"}).`
                : `✅ Antigüedad de <@${user.id}> ${action === "restaurar" ? "restaurada a la fecha de Discord" : "actualizada"}: ${format(after)}. Antes: ${format(before)}.\nSe aplica en /records y /top. Los nuevos récords se comprobarán en su próximo mensaje; los ya obtenidos se conservan.`
            return int.editReply({ content, allowedMentions: { parse: [] } })
        } catch (error) {
            console.warn(`Could not manage tenure in ${int.guild.id}:`, error.message)
            return int.editReply({ content: "No se pudo gestionar la antigüedad. Inténtalo de nuevo." })
        }
    },
}
