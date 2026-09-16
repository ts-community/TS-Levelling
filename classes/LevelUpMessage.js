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
const tools = Tools.global

// Mismo lenguaje visual que /rank y /top. Ids copiados de rank.js / top.js.
const EMOJI = {
    TOP: "<:top:1467967277251956887>",
    XP: "<:XP:1467192533812645939>",
    MESSAGES: "<:messages:1467163578699354235>",
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



class LevelUpMessage {
    // message puede ser un Message, una interacción convertida a pseudo-message,
    // o null (p. ej. XP dado por comando). data admite triggerText/triggerUrl,
    // user/member/client como fallback.
    constructor(settings, message, data={}) {

        this.channel = settings.levelUp.channel
        this.userMessage = message
        this.level = data.level
        this.oldLevel = data.oldLevel ?? (data.level - 1)
        this.userData = data.userData || { xp: 0 }
        this.example = !!data.example
        this.allUsers = data.allUsers || null

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

        let roleList = data.roleList || guild?.roles?.cache
        const findRole = (id) => {
            if (!roleList) return null
            if (typeof roleList.find === "function") return roleList.find(r => r?.id == id || r?.id === id)
            if (typeof roleList.get === "function") return roleList.get(id)
            if (Array.isArray(roleList)) return roleList.find(r => r?.id == id)
            return null
        }
        // El mensaje solo se envia al conseguir nuevo rango (rol), nunca por subir
        // de nivel sin rol. Se detectan los roles ganados en el salto
        // oldLevel+1..level (no solo level exacto, por si el XP salta niveles).
        const oldLvlNum = Number(data.oldLevel ?? (data.level - 1))
        const newLvlNum = Number(data.level)
        const earnedDefs = (settings.rewards || []).filter(x => {
            const rl = Number(x.level)
            return rl > oldLvlNum && rl <= newLvlNum
        })
        this.rewardRoles = earnedDefs
            .map(x => findRole(x.id))
            .filter(x => x)
        // Si el rol ya no existe en el servidor, conservar al menos la mencion
        // por ID para que el titulo pueda mostrar la recompensa igualmente.
        if (!this.rewardRoles.length && earnedDefs.length) {
            this.rewardRoles = earnedDefs.map(x => ({ id: x.id, name: x.id }))
        }

        if (!this.rewardRoles.length && !data.example) {
            this.invalid = true;
            return
        }

        const xp = this.userData.xp || 0
        const currentRoles = tools.getRolesForLevel(this.level, settings.rewards)
        const currentRoleId = currentRoles[0]?.id || null

        const rank = ranks.find(r => r.roles.some(role => role.id === currentRoleId)) || null
        const currentRole = rank?.roles.find(r => r.id === currentRoleId) || null
        // Banner siempre: si aún no tiene rango, se usa el primero (bronce)
        const bannerRank = rank || ranks[0]

        // Rank del usuario con la misma funcion que /rank (mismo numero garantizado)
        let userRank = null
        try {
            const source = this.allUsers || null
            if (source && typeof source === "object" && author?.id) {
                userRank = tools.getRankPosition(source, author.id, settings)
            }
        } catch {}

        // Mensaje que provocó el level up, estilo bloque de código.
        // Funciona también sin mensaje (XP por comando): texto fallback.
        let triggerPreview = ""
        let triggerUrl = data.triggerUrl || ""
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
            const guildId = guild?.id
            const channelId = channel?.id
            const messageId = message?.id
            if (!triggerUrl && guildId && channelId && messageId && !this.example) {
                triggerUrl = message?.url || `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
            }
        } catch {
            triggerPreview = NO_TRIGGER_TEXT
        }

        const avatarUrl = member?.avatarLink
            || (typeof member?.displayAvatarURL === "function" ? member.displayAvatarURL({format: "png", dynamic: true}) : "")
            || data.avatarUrl
            || ""

        this.variables = {
            "LEVEL": tools.commafy(data.level),
            "OLD_LEVEL": tools.commafy(this.oldLevel),
            "XP": tools.commafy(xp),
            "NEXT_LEVEL": Math.min(data.level + 1, settings.maxLevel),
            "NEXT_XP": tools.commafy(Math.max(tools.xpForLevel(data.level + 1, settings) - xp, 0)),
            "RANK": userRank ? `#${userRank}` : "?",
            "TRIGGER_PREVIEW": triggerPreview,
            "TRIGGER_URL": triggerUrl,
            "@": author?.id ? `<@${author.id}>` : "",
            "USERNAME": author?.username ?? "",
            "DISPLAYNAME": author?.displayName ?? author?.username ?? "",
            "DISCRIM": author?.discriminator ?? "0",
            "ID": author?.id ?? "",
            "NICKNAME": member?.displayName ?? author?.displayName ?? "",
            "AVATAR": avatarUrl,
            "SERVER": guild?.name ?? "",
            "SERVER_ID": guild?.id ?? "",
            "SERVER_ICON": guild?.iconLink || (typeof guild?.iconURL === "function" ? (guild.iconURL({format: "png", dynamic: true}) || "") : ""),
            "CHANNEL": channel?.id ? `<#${channel.id}>` : "",
            "CHANNEL_NAME": channel?.name ?? "",
            "CHANNEL_ID": channel?.id ?? "",
            "ROLE": this.rewardRoles.map(x => `<@&${x.id}>`).join(" "),
            "ROLE_NAME": this.rewardRoles.map(x => x.name).join(", "),
            "TIMESTAMP": Math.round(Date.now() / 1000),
            "EMBEDTIMESTAMP": new Date().toISOString()
        }

        // ---------- Container V2 resumido ----------
        const accentColor = bannerRank?.color ? parseInt(bannerRank.color.replace("#", ""), 16) : tools.COLOR

        const files = []
        if (bannerRank?.banner?.url) {
            try {
                const bannerPath = path.join(__dirname, "../assets/banners/", bannerRank.banner.url)
                if (fs.existsSync(bannerPath)) {
                    files.push(new AttachmentBuilder(bannerPath, { name: bannerRank.banner.url }))
                }
            } catch {}
        }
        const hasBannerFile = files.length > 0

        // Titulo de felicitacion, sin mencion (la mencion va fuera del
        // container para no ocupar espacio). El rango va en negrita en su
        // linea, sin emoji (el arte del rango ya sale en el banner) para
        // acortar. Orden como /rank: rol -> XP/nivel -> mensajes.
        // TOP sin formato de miles, igual que /rank (#25, no 1.345).
        const topTag = userRank ? ` ${EMOJI.TOP} #${userRank}` : ""
        const rankEmoji = currentRole?.emoji || ""
        // Rango a mostrar: el efectivo actual (UN solo rol aunque el salto de
        // XP haya dado varios); si no se resolvio (rol borrado), el ultimo de
        // los ganados en el salto.
        const topEarned = [...this.rewardRoles].pop()
        const displayRoleId = currentRoles[0]?.id || topEarned?.id || null
        const roleLine = `## 🎉 ¡Subida de rango! ${topTag}`
        const newRankLine = displayRoleId
            ? `${rankEmoji ? `${rankEmoji} ` : ""}**Rango:** <@&${displayRoleId}>`
            : null

        // Mismas lineas que /rank: Nivel en la linea de XP + mensajes con el
        // mismo acortado que rank.js. Sin linea de siguiente nivel/rango.
        function formatMessagesLine(total, monthly) {
            const maxLength = 28
            let text = `**${total} ${total === 1 ? 'mensaje' : 'mensajes'}** (${monthly} este mes)`
            if (text.length <= maxLength) return text
            text = `**${total} ${total === 1 ? 'msg' : 'msgs'}** (${monthly} este mes)`
            if (text.length <= maxLength) return text
            return `**${total} ${total === 1 ? 'msg' : 'msgs'}** (${monthly} mes)`
        }
        const totalMsgs = tools.commafy(tools.getMessages(this.userData))
        const monthlyMsgs = tools.commafy(tools.getMonthlyMessages(this.userData))
        const subLines = [
            `**${EMOJI.XP}** **Nivel ${tools.commafy(this.level)}** (${tools.commafy(xp)} XP)`,
            `**${EMOJI.MESSAGES}** ${formatMessagesLine(totalMsgs, monthlyMsgs)}`,
        ]

        const container = new ContainerBuilder().setAccentColor(accentColor)

        if (hasBannerFile) {
            container.addMediaGalleryComponents([
                new MediaGalleryBuilder()
                    .setId(1)
                    .addItems([
                        new MediaGalleryItemBuilder()
                            .setURL(`attachment://${bannerRank.banner.url}`)
                            .setDescription(bannerRank.banner.alt || `${bannerRank.rank} banner`)
                    ])
            ])
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        }

        const headerLines = newRankLine
            ? [roleLine, newRankLine, ...subLines]
            : [roleLine, ...subLines]
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

        // Mensaje con el que ha subido (cita del trigger), con etiqueta para
        // que se entienda que es, sin bloque de codigo. Se omite en example
        // y cuando no hay texto real (XP manual / adjuntos).
        const sameChannel = this.channel === "current" || this.example
        const quoted = triggerPreview.length > TRIGGER_PREVIEW_MAX
            ? triggerPreview.slice(0, TRIGGER_PREVIEW_MAX) + "…"
            : triggerPreview
        const hasRealTrigger = quoted && quoted !== NO_TRIGGER_TEXT
        let contextLine = null
        if (!this.example && hasRealTrigger) {
            // Evita romper el bloque de codigo si el mensaje contiene ```
            const safeCode = quoted.replace(/```/g, "ˋˋˋ")
            contextLine = `${EMOJI.MESSAGES} **Mensaje de subida:**\n\`\`\`\n${safeCode}\n\`\`\``
        }
        if (contextLine) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(contextLine))
        }

        // Sin botones: mención clicable al comando con ID del servidor
        const rankCmd = commandMention(this.client, "rank")
        const topCmd = commandMention(this.client, "top")
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Consulta ${rankCmd} para ver tu progreso y ${topCmd} para ver la clasificación`
        ))

        this.container = container
        this.files = files
        // Linea fuera del container (TextDisplay suelto, equivalente al content
        // en V2 donde content va ignorado/rechazado): lleva la mencion + un
        // minimo de contexto, que es lo que muestra la notificacion movil.
        // Pingea igual con el allowedMentions. El container no se toca.
        const mentionLine = author?.id ? [new TextDisplayBuilder().setContent(`<@${author.id}> ¡Nuevo rango! 🎉`)] : []
        this.msg = {
            components: [...mentionLine, container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: author?.id ? { users: [author.id] } : { parse: [] },
        }
        if (files.length) this.msg.files = files
        // Reply solo en el mismo canal (en canal dedicado el reply cruzado falla y el link ya da contexto).
        // Sin message.id (XP por comando) no hay reply posible.
        if (!this.example && sameChannel && message?.id) {
            this.msg.reply = { messageReference: message.id }
        }
    }

    async send() {
        if (!this.msg || this.invalid) return
        let sendChannel = this.channel
        // message puede ser Message, pseudo-message de interacción o null
        const guild = this.userMessage?.guild ?? this.guild ?? null
        const fallbackChannel = this.userMessage?.channel ?? this.originChannel ?? null
        let ch =
            (sendChannel == "current") ? (fallbackChannel || null)
            : (sendChannel == "dm") ? (this.author || null)
            : (guild ? await guild.channels.fetch(sendChannel).catch(() => {}) : fallbackChannel)

        if (ch && (ch.id || typeof ch.send === "function")) {
            // reply cruzado entre canales falla: solo responder en el mismo canal
            const payload = { ...this.msg }
            if (sendChannel !== "current") delete payload.reply
            if (!this.userMessage?.id) delete payload.reply
            ch.send(payload).catch((e) => {
                const fallback = `**Error sending level up message!**\n\`\`\`${e.message}\`\`\`\n(anyways, congrats on level ${this.variables.LEVEL}!)`
                ch.send({ content: fallback }).catch(() => {})
            })
        }
    }
}

module.exports = LevelUpMessage;
