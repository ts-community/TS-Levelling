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


const VIDEO_PATH = path.join(__dirname, "..", "..", "assets", "roger", "anakin.mp4")
const VIDEO_NAME = "anakin.mp4"


const RECORDS_EMOJI = "<:records:1549908515399929959>"


module.exports = {

    metadata: {
        name: "roger",
        description: "Hay comandos que no existen… hasta que los usas.",
    },


    async run(client, int, tools) {

        const recordsTag =
            tools?.commandTag?.("records") ?? "`/records`"


        const separator = () =>
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small)


        const container = new ContainerBuilder()
            .setAccentColor(0xe63946)

            // Título + descubrimiento
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        [
                            "🫡 Roger that.",
                            "",
                            "Has descubierto un comando oculto de Records: **Señas**.",
                        ].join("\n")
                    )
            )

            .addSeparatorComponents(separator())

            // Homenaje
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        [
                            "-# Este edit es un homenaje",
                            "-# a un viejo miembro del staff",
                            "-# que un día partió y no volvió…",
                        ].join("\n")
                    )
            )


        let files = []


        try {

            if (fs.existsSync(VIDEO_PATH)) {

                files = [
                    new AttachmentBuilder(
                        VIDEO_PATH,
                        {
                            name: VIDEO_NAME,
                        }
                    ),
                ]


                container
                    .addSeparatorComponents(separator())

                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder()
                            .addItems([
                                new MediaGalleryItemBuilder()
                                    .setURL(
                                        `attachment://${VIDEO_NAME}`
                                    )
                                    .setDescription(
                                        "Edit homenaje a Roger"
                                    ),
                            ])
                    )

            }

        } catch {}


        container
            .addSeparatorComponents(separator())

            // Footer
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `-# ${RECORDS_EMOJI} Usa ${recordsTag} para ver tus Records`
                    )
            )


        return int.reply({
            components: [container],
            files,
            flags:
                MessageFlags.IsComponentsV2 |
                MessageFlags.Ephemeral,
        })

    }

}