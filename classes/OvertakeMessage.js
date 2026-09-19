const path = require("path")
const fs = require("fs")
const {
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ThumbnailBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    ApplicationCommandType,
} = require("discord.js")
const Tools = require("./Tools.js")
const ranks = require("../consts/ranks.js")
const recordsConfig = require("../config/records.js")
const tools = Tools.global

// Mismo lenguaje visual que LevelUpMessage / /rank / /top.
const EMOJI = {
    TOP: "<:top:1467967277251956887>",
    XP: "<:XP:1467192533812645939>",
    MESSAGES: "<:messages:1467163578699354235>",
    MEMBER: "<:member:1467596629787021415>",
}

const TRIGGER_PREVIEW_MAX = 100
const NO_TRIGGER_TEXT = "Sin mensaje (XP manual)"

function commandMention(client, name) {
    try {
        const cached = client?.application?.commands?.cache
        const found = cached?.find
            ? cached.find(x => x.name === name && (x.type === ApplicationCommandType.ChatInput || x.type === undefined))
            : null
        if (found?.id) return `</${name}:${found.id}>`
    } catch {}
    return `\`/${name}\``
}

function cleanPreview(text) {
    if (!text || typeof text !== "string") return ""
    return text
        .replace(/\r/g, "")
        .split("\n")
        .map(x => x.trim())
        .filter(x => x.length)
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim()
}

// Mensaje de adelantamiento: solo para rango Pro. Se envia al mismo canal
// configurado para los level up (settings.levelUp.channel). Calca la
// estructura del LevelUpMessage: mencion fuera, banner, cabecera con avatar,
// cita del mensaje y pie con comandos.
class OvertakeMessage {
    // message puede ser un Message, una interacción convertida a pseudo-message,
    // o null (p. ej. XP dado por comando). data admite triggerText/triggerUrl,
    // user/member/client como fallback.
    constructor(settings, message, data = {}) {
        this.channel = settings.levelUp?.channel || "current"
        this.userMessage = message
        this.level = data.level
        this.oldPos = data.oldPos
        this.newPos = data.newPos
        this.overtakenIds = (data.overtakenIds || []).map(String)
        this.userData = data.userData || { xp: 0 }

        // Normalizar origen: Message | interacción | null
        const author = message?.author ?? message?.user ?? data.user ?? null
        const member = message?.member ?? data.member ?? null
        const guild = message?.guild ?? data.guild ?? null
        const channel = message?.channel ?? data.channel ?? null
        this.client = message?.client ?? data.client ?? null
        this.author = author
        this.member = member
        this.guild = guild
        this.originChannel = channel

        if (!author?.id || !this.oldPos || !this.newPos || this.newPos >= this.oldPos || !this.overtakenIds.length) {
            this.invalid = true
            return
        }

        const proRank = ranks.find(r => r.rank === "pro") || null

        const xp = this.userData.xp || 0

        const avatarUrl = member?.avatarLink
            || (typeof member?.displayAvatarURL === "function" ? member.displayAvatarURL({ format: "png", dynamic: true }) : "")
            || data.avatarUrl
            || ""

        // Mensaje que provocó el adelantamiento, igual que en LevelUpMessage.
        // Sin mensaje real (XP por comando) se omite la cita.
        let triggerPreview = ""
        try {
            const rawContent = data.triggerText ?? message?.content ?? message?.cleanContent ?? ""
            const cleaned = cleanPreview(rawContent)
            if (cleaned) {
                triggerPreview = tools.limitLength(cleaned, TRIGGER_PREVIEW_MAX)
            } else if ((message?.attachments?.size || 0) > 0) {
                triggerPreview = "Archivo adjunto"
            } else if ((message?.stickers?.size || 0) > 0) {
                triggerPreview = "Sticker"
            } else if ((message?.embeds?.length || 0) > 0) {
                triggerPreview = "Embed"
            } else {
                triggerPreview = NO_TRIGGER_TEXT
            }
        } catch {
            triggerPreview = NO_TRIGGER_TEXT
        }

        // ---------- Container V2, misma estructura que LevelUpMessage ----------
        const accentColor = proRank?.color ? parseInt(proRank.color.replace("#", ""), 16) : tools.COLOR

        const files = []
        if (proRank?.banner?.url) {
            try {
                const bannerPath = path.join(__dirname, "../assets/banners/", proRank.banner.url)
                if (fs.existsSync(bannerPath)) {
                    files.push(new AttachmentBuilder(bannerPath, { name: proRank.banner.url }))
                }
            } catch {}
        }
        const hasBannerFile = files.length > 0

        // Titulo con el mismo largo y formato que "🎉 ¡Subida de rango!":
        // fuera pone "¡Nuevo adelantamiento!" y dentro "¡Adelantamiento Pro!",
        // igual que fuera "¡Nuevo rango!" y dentro "¡Subida de rango!".
        const topTag = ` ${EMOJI.TOP} #${this.newPos}`
        const titleLine = `## 🎉 ¡Adelantamiento!${topTag}`
        // Linea del adelantado: sin TOP (ya va en el titulo), solo el primero
        // con (+N más) y contexto corto para que quepa en una linea en movil.
        // El primero es el de mas arriba en el ranking (el rival mas alto).
        const firstOvertaken = this.overtakenIds[0]
        const innerExtra = this.overtakenIds.length > 1 ? ` (+${this.overtakenIds.length - 1})` : ""
        const overtakeLabel = this.overtakenIds.length === 1 ? "Adelantado" : "Adelantados"
        const overtakeLine = `${EMOJI.MEMBER} **${overtakeLabel}:** <@${firstOvertaken}>${innerExtra}`

        // Mismas lineas que LevelUpMessage: Nivel en la linea de XP +
        // mensajes con el mismo acortado que rank.js.
        function formatMessagesLine(total, monthly) {
            const maxLength = 28
            let text = `**${total} ${Number(total) === 1 ? 'mensaje' : 'mensajes'}** (${monthly} este mes)`
            if (text.length <= maxLength) return text
            text = `**${total} ${Number(total) === 1 ? 'msg' : 'msgs'}** (${monthly} este mes)`
            if (text.length <= maxLength) return text
            text = `**${total} ${Number(total) === 1 ? 'msg' : 'msgs'}** (${monthly} mes)`
            if (text.length <= maxLength) return text
            text = `**${total} m** (${monthly} m)`
            if (text.length <= maxLength) return text
            return `**${total}** (${monthly})`
        }
        const totalMsgs = tools.commafy(tools.getMessages(this.userData))
        const monthlyMsgs = tools.commafy(tools.getMonthlyMessages(this.userData))
        // TODO: completados reales cuando exista la lógica de récords.
        const recordsTotal = recordsConfig.countTiers(recordsConfig.visibleRecords())
        const headerLines = [
            titleLine,
            overtakeLine,
            `**${EMOJI.XP}** **Nivel ${tools.commafy(this.level)}** (${tools.commafy(xp)} XP)`,
            `**${EMOJI.MESSAGES}** ${formatMessagesLine(totalMsgs, monthlyMsgs)}`,
            `**${recordsConfig.RECORDS_EMOJI}** **0/${recordsTotal} records completados**`,
        ]

        const container = new ContainerBuilder().setAccentColor(accentColor)

        if (hasBannerFile) {
            container.addMediaGalleryComponents([
                new MediaGalleryBuilder()
                    .setId(1)
                    .addItems([
                        new MediaGalleryItemBuilder()
                            .setURL(`attachment://${proRank.banner.url}`)
                            .setDescription(proRank.banner.alt || `${proRank.rank} banner`)
                    ])
            ])
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        }

        if (avatarUrl) {
            container.addSectionComponents(new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(headerLines.join("\n"))
                )
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: avatarUrl } }))
            )
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.join("\n")))
        }

        // Mensaje con el que ha adelantado (cita del trigger), igual que en
        // LevelUpMessage. Se omite cuando no hay texto real (XP manual).
        const quoted = triggerPreview.length > TRIGGER_PREVIEW_MAX
            ? triggerPreview.slice(0, TRIGGER_PREVIEW_MAX) + "…"
            : triggerPreview
        const hasRealTrigger = quoted && quoted !== NO_TRIGGER_TEXT
        let contextLine = null
        let safeCode = null
        if (hasRealTrigger) {
            // Evita romper el bloque de codigo si el mensaje contiene ```
            safeCode = quoted.replace(/```/g, "ˋˋˋ")
            contextLine = `${EMOJI.MESSAGES} **Mensaje de adelantamiento:**`
        }
        if (contextLine) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(contextLine))
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`\`\`\`\n${safeCode}\n\`\`\``))
        }

        // Sin botones: mención clicable al comando con ID del servidor
        const rankCmd = commandMention(this.client, "rank")
        const topCmd = commandMention(this.client, "top")
        const recordsCmd = commandMention(this.client, "records")
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Consulta ${rankCmd} para ver tu progreso, ${topCmd} para ver la clasificación y ${recordsCmd} para ver tus records`
        ))

        this.container = container
        this.files = files

        // Linea fuera del embed, igual que "¡Nuevo rango!": solo mencion al
        // autor + contexto minimo (es lo que muestra la notificacion movil).
        // Se pingea al autor y al adelantado, que es el que sale mencionado
        // dentro del embed.
        const pingIds = [author.id, firstOvertaken].filter((v, i, a) => v && a.indexOf(v) === i)
        const mentionLine = author?.id
            ? [new TextDisplayBuilder().setContent(`<@${author.id}> ¡Nuevo adelantamiento! 🎉`)]
            : []
        this.msg = {
            components: [...mentionLine, container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: pingIds, parse: [] },
        }
        if (files.length) this.msg.files = files
    }

    async send() {
        if (!this.msg || this.invalid) return
        let sendChannel = this.channel
        const guild = this.userMessage?.guild ?? this.guild ?? null
        const fallbackChannel = this.userMessage?.channel ?? this.originChannel ?? null
        let ch =
            (sendChannel == "current") ? (fallbackChannel || null)
            : (sendChannel == "dm") ? (this.author || null)
            : (guild ? await guild.channels.fetch(sendChannel).catch(() => {}) : fallbackChannel)

        if (ch && (ch.id || typeof ch.send === "function")) {
            const payload = { ...this.msg }
            if (!this.userMessage?.id) delete payload.reply
            ch.send(payload).catch((e) => {
                const fallback = `**Error sending overtake message!**\n\`\`\`${e.message}\`\`\``
                ch.send({ content: fallback }).catch(() => {})
            })
        }
    }
}

module.exports = OvertakeMessage
