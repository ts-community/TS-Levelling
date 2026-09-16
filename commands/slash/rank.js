const { 
    AttachmentBuilder, 
    ContainerBuilder, 
    TextDisplayBuilder, 
    MediaGalleryBuilder, 
    MediaGalleryItemBuilder, 
    ThumbnailBuilder, 
    SectionBuilder, 
    SeparatorBuilder, 
    MessageFlags 
} = require('discord.js')
const multiplierModes = require("../../json/multiplier_modes.json")
const ranks = require("../../consts/ranks.js")
const path = require("path")

module.exports = {
    metadata: {
        name: "rank",
        description: "View your current XP, level, and cooldown.",
        args: [
            { type: "user", name: "member", description: "Which member to view", required: false },
        ]
    },

    async run(client, int, tools) {
        await int.deferReply()
        let member = int.member
        let foundUser = int.options.get("user") || int.options.get("member")
        if (foundUser) member = foundUser.member
        if (!member) return tools.warn("That member couldn't be found!")

        // ---- FIX: necesitamos todos los usuarios para calcular el rank correctamente
        let db = await tools.fetchAll()

        if (!db) return tools.warn("*noData")
        else if (!db.settings.enabled) return tools.warn("*xpDisabled")

        let currentXP = db.users[member.id]
        if (db.settings.rankCard.disabled) return tools.warn("Rank cards are disabled in this server!")
        if (!currentXP || !currentXP.xp) return tools.noXPYet(foundUser ? foundUser.user : int.user)

        let xp = currentXP.xp
        let levelData = tools.getLevel(xp, db.settings, true)
        let totalMsgs = tools.commafy(tools.getMessages(currentXP))
        let monthlyMsgs = tools.commafy(tools.getMonthlyMessages(currentXP))
        let maxLevel = levelData.level >= db.settings.maxLevel

        const levelRoles = tools.getRolesForLevel(levelData.level, db.settings.rewards)
        const levelRole = levelRoles[0] || null
        const levelRoleId = levelRole?.id
        const rank = ranks.find(r => r.roles.some(role => role.id === levelRoleId)) || null

        let role = null
        let nextRole = null

        if (rank) {
            const currentRoleIndex = rank.roles.findIndex(r => r.id === levelRoleId)
            if (currentRoleIndex !== -1) {
                role = rank.roles[currentRoleIndex]
                if (currentRoleIndex + 1 < rank.roles.length) {
                    nextRole = rank.roles[currentRoleIndex + 1]
                } else {
                    const nextRankIndex = ranks.findIndex(r => r.rank === rank.rank) + 1
                    if (nextRankIndex < ranks.length) {
                        nextRole = ranks[nextRankIndex].roles[0]
                    }
                }
            }
        }

        // -----------------------------------------------------------------
        // Compute user's rank **excluding hidden users** (and respecting minLevel)
        // -----------------------------------------------------------------
        let userRank = null
        let rankingsArr = null
        try {
            rankingsArr = tools.getLeaderboard(db.users || {}, db.settings)

            const idx = rankingsArr.findIndex(u => u.id === member.id)
            userRank = idx !== -1 ? idx + 1 : null
        } catch (err) {
            // fallback: si algo falla usamos la función que tenías
            userRank = await tools.getRank(member.id, int.guild.id)
        }

        // ─── Determinar estado: top 1, rol máximo, o normal ─────────────────
        // Es top 1 SOLO si realmente es el primero entre usuarios NO hidden
        let isTopOne = false
        if (userRank === 1 && rankingsArr && rankingsArr.length) {
            isTopOne = rankingsArr[0].id === member.id
        }
        let isMaxRole = !nextRole // no existe siguiente reward role → tiene el más alto

        // traer datos de overtake una sola vez si los necesitamos
        let overtakeData = null
        if (isMaxRole && !isTopOne) {
            overtakeData = await tools.getXPToOvertake(member.id, int.guild.id)
        }

        // ─── Barra de progreso ────────────────────────────────────────────────
        let progressBar = ""
        let progressPercent = 0
        let messagesToNextRole = 0

        const barSize = 19
        const segmentCount = 4
        let segmentPositions = [];
        let step = 4
        for (let i = 1; i <= segmentCount; i++) {
            segmentPositions.push(Math.round(i * step));
        }

        // emojis
        const DROP         = "<:star_drop:1467144088779489311>"
        const DROP_GHOST   = "<:star_drop_ghost:1467145846973010185>"
        const HYPER        = "<:hypercharge_drop:1467236546317914349>"
        const CHAOS        = "<:chaos_drop:1467279550701375660>"
        const CHAOS_GHOST  = "<:chaos_drop_ghost:1467279548621263052>"
        const TARGET_USER  = "<:member:1467596629787021415>"
        const BELOW_USER   = "<:member:1467596629787021415>"

        // ─── CASO 1: Top 1 del servidor ───────────────────────────────────────
        if (isTopOne) {
            // barra llena de chaos sólidos, sin ghost, sin emoji al final
            progressBar = `${BELOW_USER}${CHAOS.repeat(11)}\n${CHAOS.repeat(12)}`
            progressPercent = 100
            messagesToNextRole = 0

        // ─── CASO 2: tiene el rol máximo pero NO es top 1 → modo overtake ─────
        } else if (isMaxRole && overtakeData && overtakeData.targetUserID) {

            let barStart = overtakeData.belowXP   // XP del usuario de abajo (ancla inicio)
            let barEnd   = overtakeData.targetXP  // XP del usuario de arriba (meta)
            let myXP     = overtakeData.myXP

            let rangeXP    = barEnd - barStart
            let progressXP = rangeXP > 0 ? Math.min(Math.max(myXP - barStart, 0), rangeXP) : 0
            progressPercent = rangeXP > 0 ? (progressXP / rangeXP) * 100 : 0

            // mensajes estimados
            const multiplierData = tools.getMultiplier(member, db.settings)
            const avgGain = (db.settings.gain.min + db.settings.gain.max) / 2 * multiplierData.multiplier
            messagesToNextRole = avgGain > 0 ? Math.ceil(overtakeData.xpNeeded / avgGain) : 0

            // construir barra con chaos drops
            const completedBars = rangeXP > 0 ? Math.round((progressXP / rangeXP) * barSize) : 0
            let barStr = ""
            for (let i = 0; i < barSize; i++) {
                if (i === 11) barStr += '\n'
                barStr += i < completedBars ? CHAOS : CHAOS_GHOST
            }

            let initialEmoji = BELOW_USER
            try {
                if (role && rankingsArr && rankingsArr.length) {
                    const myXP = xp
                    const existsLowerSameRole = rankingsArr.some(u => {
                        if (u.id === member.id) return false
                        if ((u.xp || 0) >= myXP) return false
                        // obtener level role para ese usuario
                        const otherLevel = tools.getLevel(u.xp || 0, db.settings, true)
                        const otherLevelRoles = tools.getRolesForLevel(otherLevel.level, db.settings.rewards)
                        const otherLevelRole = otherLevelRoles[0] || null
                        return otherLevelRole && otherLevelRole.id === role.id
                    })
                    initialEmoji = existsLowerSameRole ? BELOW_USER : role.emoji
                }
            } catch (e) {
                initialEmoji = BELOW_USER
            }

            progressBar = `${initialEmoji}${barStr}${TARGET_USER} (${progressPercent.toFixed(2)}%)`

        // ─── CASO 3: rol normal → barra estándar hacia el siguiente reward role ─
        } else if (nextRole) {
            const currentRoleData = db.settings.rewards.find(r => r.id === role.id)
            const nextRoleData   = db.settings.rewards.find(r => r.id === nextRole.id)

            const startXP = currentRoleData ? tools.xpForLevel(currentRoleData.level, db.settings) : 0
            const endXP   = nextRoleData   ? tools.xpForLevel(nextRoleData.level, db.settings)   : (db.settings.maxXP || 0)

            const rangeXP    = endXP - startXP
            const progressXP = rangeXP > 0 ? Math.min(Math.max(xp - startXP, 0), rangeXP) : 0
            progressPercent  = rangeXP > 0 ? (progressXP / rangeXP) * 100 : 0

            const multiplierData = tools.getMultiplier(member, db.settings)
            const avgGain = (db.settings.gain.min + db.settings.gain.max) / 2 * multiplierData.multiplier
            messagesToNextRole = avgGain > 0 ? Math.ceil((rangeXP - progressXP) / avgGain) : 0

            const completedBars = rangeXP > 0 ? Math.round((progressXP / rangeXP) * barSize) : 0
            let barStr = ""
            for (let i = 0; i < barSize; i++) {
                if (i === 11) barStr += '\n'
                if (segmentPositions.includes(i + 1)) {
                    barStr += HYPER
                } else {
                    barStr += i < completedBars ? DROP  : DROP_GHOST
                }
            }

            progressBar = `${role.emoji}${barStr}${nextRole.emoji} (${progressPercent.toFixed(2)}%)`

        // ─── CASO fallback: isMaxRole pero sin overtakeData válido ────────────
        } else {
            progressBar = `${role.emoji}${CHAOS.repeat(barSize)} (MAX)`
            progressPercent = 100
        }

        // ─── Texto debajo de la barra ─────────────────────────────────────────
        let nextLevelXP
        if (isTopOne) {
            nextLevelXP = `Eres el primero del servidor, ¡no hay nadie que adelantar!`
        } else if (isMaxRole && overtakeData?.targetUserID) {
            nextLevelXP = `${tools.commafy(messagesToNextRole)} mensajes para adelantar a <@${overtakeData.targetUserID}> (lvl. ${tools.commafy(overtakeData.targetLevel)})`
        } else {
            nextLevelXP = `${tools.commafy(messagesToNextRole)} mensajes para el siguiente rango`
        }

        // ─── resto del comando (avatar, cooldown, formateo) ──────────────────
        let memberAvatar = member.displayAvatarURL()
        let foundCooldown = currentXP.cooldown || 0
        let cooldown = foundCooldown > Date.now() ? tools.timestamp(foundCooldown - Date.now()) : "¡Sin Cooldown!"

        function formatMessagesLine(total, monthly) {
            const maxLength = 28
            let text = `**${total} ${total === 1 ? 'mensaje' : 'mensajes'}** (${monthly} este mes)`
            if (text.length <= maxLength) return text
            text = `**${total} ${total === 1 ? 'msg' : 'msgs'}** (${monthly} este mes)`
            if (text.length <= maxLength) return text
            return `**${total} ${total === 1 ? 'msg' : 'msgs'}** (${monthly} mes)`
        }

        const bannerPath = path.join(__dirname, "../../assets/banners/", rank.banner.url)
        const bannerAttachment = new AttachmentBuilder(bannerPath, { name: rank.banner.url })

        let container = new ContainerBuilder()
            .setAccentColor(parseInt(rank?.color?.replace('#', ''), 16) || 3447003)
            .addMediaGalleryComponents([
                new MediaGalleryBuilder()
                    .setId(1)
                    .addItems([
                        new MediaGalleryItemBuilder()
                            .setURL(`attachment://${rank.banner.url}`)
                            .setDescription(rank.banner.alt)
                    ])
            ])
            .addSeparatorComponents(new SeparatorBuilder())
            .addSectionComponents(new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent([
                        `## ${role.emoji} <@&${role.id}> <:top:1467967277251956887> #${userRank || "?"}`,
                        `**<:XP:1467192533812645939>** **Nivel ${levelData.level}** (${tools.commafy(xp)} XP)`,
                        `**<:messages:1467163578699354235>** ${formatMessagesLine(totalMsgs, monthlyMsgs)}`,
                        `**<:next_level:1452305752390766633>** ${tools.commafy(levelData.xpRequired - xp)} XP para subir`,
                        `**<:cooldown:1452305790495887515>** ${cooldown}`
                    ].join('\n'))
                )
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: memberAvatar } }))
            )

        // Buffies / multiplicadores
        let hideMult = db.settings.hideMultipliers
        let multData = tools.getMultiplier(member, db.settings)
        let multRoles = multData.roleList?.reverse()
        let multiplierInfo = []

        if ((!hideMult || multData.role === 0) && multRoles.length) {
            let i = 0
            for (const r of multRoles) {
                const xpStr = tools.getIndividualRoleMultiplier(r.id, db.settings) > 0
                    ? `${tools.getIndividualRoleMultiplier(r.id, db.settings)}x XP`
                    : "No puede ganar XP"
                const keys = ['<:key_1:1467191504677240949>', '<:key_2:1467191508011581440>', '<:key_3:1467191509064351989>', '<:key_4:1467191992004907211>']
                const key = keys[i % keys.length]
                const roleStr = int.guild.id !== r.id ? `- ${key} <@&${r.id}> - ${xpStr}` : `- **Everyone** • ${xpStr}`
                multiplierInfo.push(roleStr)
                i++
            }
        }

        const multChannels = multData.channelList
        if ((!hideMult || multData.channel === 0) && multChannels.length) {
            for (const channel of multChannels) {
                const chXPStr = channel.boost > 0 ? `${multData.channel}x XP` : "No se puede ganar XP!"
                multiplierInfo.push(`- <#${channel.id}> - ${chXPStr}`)
            }
        }

        if (multiplierInfo.length) {
            container.addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**<:buffies:1452368720608366653> Buffies - ${multData.multiplier}x XP:**`))
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(multiplierInfo.join('\n')))
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(progressBar))
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(nextLevelXP))
        } else {
            container.addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(progressBar))
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(nextLevelXP))
        }

        return int.editReply({ 
            components: [container], 
            files: [bannerAttachment], 
            flags: MessageFlags.IsComponentsV2, 
            allowedMentions: { parse: [] }, 
        })
    }
}