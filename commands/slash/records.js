const path = require("path")
const fs = require("fs")
const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ThumbnailBuilder,
    SectionBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
} = require("discord.js")
const records = require("../../config/records.js")

const XP_EMOJI = "<:XP:1467192533812645939>"
const RECORDS_COLOR = 0xe6c036
const BANNER_FILE = "bronze.webp"
const BAR_SIZE = 10
const BAR_FULL = "🟩"
const BAR_EMPTY = "⬜"
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000

// Páginas en el orden de config/records.js (la última es ocultos).
const PAGES = records.categories.map(c => c.id)

function buildBar(frac) {
    const filled = Math.round(Math.min(Math.max(frac, 0), 1) * BAR_SIZE)
    let bar = ""
    for (let i = 0; i < BAR_SIZE; i++) bar += i < filled ? BAR_FULL : BAR_EMPTY
    return bar
}

// Progreso real con datos que YA existen (mensajes, mensuales, antigüedad).
// null = esa mecánica aún no tiene datos. target = primer nivel no superado
// (o el último si los supera todos: la barra sale llena pero sin ✅).
function makeProgress(current, tiers, fmt) {
    const tier = tiers.find(t => t.threshold > current) || tiers[tiers.length - 1]
    const full = current >= tier.threshold
    const shown = full ? tier.threshold : current
    return {
        tier,
        target: tier.threshold,
        frac: full ? 1 : current / tier.threshold,
        currentLabel: fmt(shown),
        targetLabel: fmt(tier.threshold),
    }
}

function getProgress(record, userData, member, commafy) {
    const type = record.mechanic.type
    if (type === "messages_total") {
        return makeProgress(Number(userData?.messages) || 0, record.tiers, v => commafy(v))
    }
    if (type === "messages_monthly") {
        return makeProgress(Number(userData?.monthlyMessages) || 0, record.tiers, v => commafy(v))
    }
    if (type === "member_tenure") {
        if (!member?.joinedTimestamp) return null
        const years = (Date.now() - member.joinedTimestamp) / MS_PER_YEAR
        const fmt1 = v => String(Math.round(v * 10) / 10).replace(".", ",")
        return makeProgress(years, record.tiers, fmt1)
    }
    return null
}

function countUnlocked(entries, unlockedIds) {
    return entries.reduce((sum, { record }) => sum + record.tiers.filter(t => unlockedIds.has(`${record.id}:${t.threshold}`)).length, 0)
}

// Los ocultos solo suman al total una vez descubiertos: 0/27 al empezar,
// 1/28 al completar el primero, 33/33 con todo.
function titleCounts(unlockedIds) {
    const doneVisible = countUnlocked(records.visibleRecords(), unlockedIds)
    const doneHidden = countUnlocked(records.hiddenRecords(), unlockedIds)
    return { done: doneVisible + doneHidden, total: records.countTiers(records.visibleRecords()) + doneHidden }
}

function buildTitle(unlockedIds) {
    const { done, total } = titleCounts(unlockedIds)
    return `# ${records.RECORDS_EMOJI} Mis records (${done}/${total})`
}

function formatReward(tier, commafy) {
    const rewards = []
    if (tier.xp > 0) rewards.push(`${XP_EMOJI} +${commafy(tier.xp)}`)
    if (tier.roleId) rewards.push(`<@&${tier.roleId}>`)
    return rewards.join(" + ")
}

function formatTier(tier, unlocked, progress, commafy) {
    const lines = [`${unlocked ? "✅ " : ""}**${tier.name}**`, tier.desc]
    if (progress && progress.tier === tier && !unlocked) {
        lines.push(`-# ${buildBar(progress.frac)} ${progress.currentLabel}/${progress.targetLabel}`)
    }
    lines.push(`-# **Recompensa:** ${formatReward(tier, commafy)}`)
    return lines.join("\n")
}

// Un bloque por logro: cabecera con emoji + sus niveles. Van con
// separadores entre ellos, como campos de embed.
function buildRecordBlock(record, unlockedIds, progress, commafy) {
    const parts = [`${record.emoji} **${record.label}**`]
    for (const tier of record.tiers) {
        const key = `${record.id}:${tier.threshold}`
        const unlocked = unlockedIds.has(key)
        parts.push(formatTier(tier, unlocked, progress && progress.tier === tier && !unlocked ? progress : null, commafy))
    }
    return parts.join("\n\n")
}

function buildCategoryBlocks(category, userData, member, unlockedIds, commafy) {
    const blocks = [`## ${category.emoji} ${category.name}`]
    for (const record of category.records) {
        blocks.push(buildRecordBlock(record, unlockedIds, getProgress(record, userData, member, commafy), commafy))
    }
    return blocks
}

function buildHiddenBlocks(hiddenCategory, unlockedIds, commafy) {
    const tiers = hiddenCategory.records.flatMap(r => r.tiers.map(t => ({ record: r, tier: t })))
    const found = tiers.filter(({ record, tier }) => unlockedIds.has(`${record.id}:${tier.threshold}`)).length
    const blocks = [`## ❓ Ocultos (**${found}**/${tiers.length})`]
    for (const { record, tier } of tiers) {
        const key = `${record.id}:${tier.threshold}`
        blocks.push(unlockedIds.has(key)
            ? buildRecordBlock(record, unlockedIds, null, commafy)
            : `❓ **?????**\n-# Se revela al completarlo`)
    }
    return blocks
}

// Un botón por categoría, con sus completados. El actual va desactivado.
// Son 6: se reparten en 2 filas de 3.
function buildNavButtons(currentId, unlockedIds, disabled = false) {
    return records.categories.map(category => {
        const total = category.records.reduce((sum, r) => sum + r.tiers.length, 0)
        const done = category.records.reduce((sum, r) => sum + r.tiers.filter(t => unlockedIds.has(`${r.id}:${t.threshold}`)).length, 0)
        const isCurrent = category.id === currentId
        return new ButtonBuilder()
            .setCustomId(`records-cat-${category.id}`)
            .setLabel(`${category.emoji} ${category.name} ${done}/${total}`)
            .setStyle(isCurrent ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(disabled || isCurrent)
    })
}

function loadBanner() {
    try {
        const bannerPath = path.join(__dirname, "../../assets/banners/", BANNER_FILE)
        if (fs.existsSync(bannerPath)) {
            const attachment = new AttachmentBuilder(bannerPath, { name: BANNER_FILE })
            return { attachment, files: [attachment] }
        }
    } catch {}
    return { attachment: null, files: [] }
}

module.exports = {
metadata: {
    name: "records",
    description: "View your server records (achievements).",
},

async run(client, int, tools) {
    let db = await tools.fetchAll()
    if (!db) return tools.warn("*noData")
    else if (!db.settings.enabled) return tools.warn("*xpDisabled")

    // TODO: lógica de completado (aún no existe): de momento nadie tiene nada.
    const unlockedIds = new Set()

    const userData = db.users?.[int.user.id] || {}
    const totalPages = PAGES.length
    let pageNumber = 1
    const { files } = loadBanner()

    const buildContainer = (page, member, disabled = false) => {
        const category = records.categories.find(c => c.id === PAGES[page - 1])
        const container = new ContainerBuilder().setAccentColor(RECORDS_COLOR)

        if (files.length) {
            container.addMediaGalleryComponents([
                new MediaGalleryBuilder()
                    .setId(1)
                    .addItems([
                        new MediaGalleryItemBuilder()
                            .setURL(`attachment://${BANNER_FILE}`)
                            .setDescription("Récords")
                    ])
            ])
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        }

        const avatar = member?.displayAvatarURL?.()
        const title = new TextDisplayBuilder().setContent(buildTitle(unlockedIds))
        if (avatar) {
            container.addSectionComponents(new SectionBuilder()
                .addTextDisplayComponents(title)
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: avatar } })))
        } else {
            container.addTextDisplayComponents(title)
        }

        const blocks = category.hidden
            ? buildHiddenBlocks(category, unlockedIds, tools.commafy)
            : buildCategoryBlocks(category, userData, member, unlockedIds, tools.commafy)
        for (const block of blocks) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block))
        }

        const buttons = buildNavButtons(category.id, unlockedIds, disabled)
        for (let i = 0; i < buttons.length; i += 3) {
            container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons.slice(i, i + 3)))
        }
        return container
    }

    await int.deferReply({ flags: MessageFlags.IsComponentsV2 })

    // La mención de la IA en Test de Turing no debe pinguear: sin menciones.
    const noPings = { parse: [] }
    const sendPage = async (page, editor, member, disabled = false) => {
        await editor.editReply({
            components: [buildContainer(page, member, disabled)],
            files,
            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
            allowedMentions: noPings,
        })
    }

    await sendPage(pageNumber, int, int.member)
    const message = await int.fetchReply()

    let buttonPressed = false
    const collector = message.createMessageComponentCollector({ time: 24 * 60 * 60 * 1000 })
    collector.on("collect", async button => {
        if (button.user.id !== int.user.id) return tools.buttonReply(button)
        if (buttonPressed) return
        buttonPressed = true
        try {
            await button.deferUpdate()
            const target = PAGES.indexOf(button.customId.replace("records-cat-", ""))
            if (target !== -1) pageNumber = target + 1
            await sendPage(pageNumber, button, button.member)
        } catch (error) {
            console.warn(`Could not update records board for ${int.guild?.id}:`, error.message)
        } finally {
            buttonPressed = false
        }
    })
    collector.on("end", async () => {
        try {
            await message.edit({
                components: [buildContainer(pageNumber, int.member, true)],
                files,
                flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                allowedMentions: noPings,
            })
        } catch {}
    })
}}

// Para tests (el loader solo usa .metadata).
module.exports.buildBar = buildBar
module.exports.getProgress = getProgress
module.exports.titleCounts = titleCounts
module.exports.buildTitle = buildTitle
module.exports.formatReward = formatReward
module.exports.formatTier = formatTier
module.exports.buildRecordBlock = buildRecordBlock
module.exports.buildCategoryBlocks = buildCategoryBlocks
module.exports.buildHiddenBlocks = buildHiddenBlocks
module.exports.buildNavButtons = buildNavButtons
module.exports.loadBanner = loadBanner
module.exports.RECORDS_COLOR = RECORDS_COLOR
module.exports.PAGES = PAGES
