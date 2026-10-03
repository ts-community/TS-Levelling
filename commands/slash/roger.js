const fs = require("fs")
const path = require("path")
const {
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
} = require("discord.js")

// Homenaje a Roger, viejo miembro del staff con la pfp de Anakin que un
// día partió y no volvió. El vídeo vive en assets/roger/anakin.mp4: si aún
// no está subido (o pasa del límite de subida de Discord), el comando
// responde solo el texto (sin romper).
const VIDEO_PATH = path.join(__dirname, "..", "..", "assets", "roger", "anakin.mp4")
const VIDEO_NAME = "anakin.mp4"
// Tope seguro en cualquier servidor (sin contar boosts): por encima la API
// rechaza el adjunto con 400 y el comando fallaría.
const VIDEO_MAX_BYTES = 10 * 1024 * 1024

module.exports = {
    metadata: {
        name: "roger",
        description: "Hay comandos que no existen… hasta que los usas.",
    },

    videoPath: VIDEO_PATH,
    videoMaxBytes: VIDEO_MAX_BYTES,

    async run(client, int, tools) {
        // El desbloqueo del logro "hidden_command" se maneja en index.js
        // (slash) y en message.js (si se escribe): aquí solo el homenaje.
        const recordsTag = tools?.commandTag?.("records") ?? "`/records`"
        const header = [
            "*🫡 Roger that.*",
            "Has descubierto un comando oculto de Records: **Señas**.",
        ].join("\n")
        const text = [
            "-# Este edit es un homenaje a un viejo miembro del staff que un día partió y no volvió…",
        ].join("\n")
        const hint = `-# Usa el comando ${recordsTag} para ver tus records`

        const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)

        // Rojo intenso tipo espada láser
        const ROGER_RED = 0xff0000

        const container = new ContainerBuilder()
            .setAccentColor(ROGER_RED)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
            .addSeparatorComponents(sep())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
            .addSeparatorComponents(sep())

        let files = []
        try {
            if (fs.existsSync(VIDEO_PATH)) {
                const size = fs.statSync(VIDEO_PATH).size
                if (size <= VIDEO_MAX_BYTES) {
                    files = [new AttachmentBuilder(VIDEO_PATH, { name: VIDEO_NAME })]
                    container
                        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems([
                            new MediaGalleryItemBuilder()
                                .setURL(`attachment://${VIDEO_NAME}`)
                                .setDescription("Edit homenaje a Roger"),
                        ]))
                        .addSeparatorComponents(sep())
                } else {
                    console.warn(`roger: ${VIDEO_NAME} pesa ${(size / 1024 / 1024).toFixed(1)}MB, más de 10MB: sin vídeo.`)
                }
            }
        } catch {}

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(hint))

        return int.reply({
            components: [container],
            files,
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        })
    }
}