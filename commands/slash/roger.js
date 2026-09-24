module.exports = {
    metadata: {
        name: "roger",
        description: "Hay comandos que no existen… hasta que los usas.",
    },

    async run(client, int, tools) {
        // El desbloqueo del logro "hidden_command" se maneja en message.js
        // al detectar el uso de este comando.
        return int.reply({ content: "🫡 Roger that.", ephemeral: true })
    }
}