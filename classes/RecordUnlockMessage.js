const {
    ContainerBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    ApplicationCommandType,
} = require("discord.js")

const XP_EMOJI = "<:XP:1467192533812645939>"
const RECORDS_EMOJI = "<:records:1549908515399929959>"

// Mismos acentos por categoría que /records (commands/slash/records.js).
const ACCENTS = {
    actividad: 0x4aa8ff,
    comunidad: 0xff6b4a,
    canales: 0x3ddc84,
    voz: 0x9b7bff,
    hidden: 0x8a8f98,
}

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

// Mensaje de récord en Components V2.
// Mención fuera del container (notificación móvil) + container con avatar,
// título con emoji + records count como /rank, bloques por logro agrupados por categoría.
// Separators V2 entre cada logro.
class RecordUnlockMessage {
    // unlocks: array de { record, category, tier, done, total }
    constructor({ client, userId, avatarUrl, unlocks }) {
        this.client = client || null

        if (!unlocks?.length) throw new Error("unlocks vacío")

        // Agrupar por record (clave: record.id) para combinar tiers del mismo logro
        const byRecord = new Map()
        for (const u of unlocks) {
            const key = u.record.id
            if (!byRecord.has(key)) {
                byRecord.set(key, {
                    record: u.record,
                    category: u.category,
                    tiers: [],
                    total: u.total,
                    done: 0,
                })
            }
            const group = byRecord.get(key)
            group.tiers.push(u.tier)
            group.done = Math.max(group.done, u.done)
        }

        // Convertir a array y ordenar: por categoría y de más difícil a más fácil.
        const categoryOrder = ["actividad", "comunidad", "canales", "voz", "hidden"]
        const recordsArray = [...byRecord.values()].sort((a, b) => {
            const ca = categoryOrder.indexOf(a.category.id)
            const cb = categoryOrder.indexOf(b.category.id)
            if (ca !== cb) return ca - cb
            const da = a.record.tiers[a.record.tiers.length - 1]?.threshold || 0
            const db = b.record.tiers[b.record.tiers.length - 1]?.threshold || 0
            return db - da
        })

        // Color: usar la primera categoría desbloqueada
        const primaryCat = recordsArray[0]?.category
        const accentColor = ACCENTS[primaryCat?.id] ?? 0xe6c036
        const container = new ContainerBuilder().setAccentColor(accentColor)

        // Título estilo /rank con ## + totales globales del usuario.
        // El último desbloqueo contiene el estado global más reciente del lote.
        const first = unlocks[unlocks.length - 1]
        const totalCompleted = first.totalCompleted ?? unlocks.length
        const totalVisible = first.totalVisible ?? unlocks.reduce((sum, u) => sum + u.total, 0)
        const firstRecordName = recordsArray[0]?.record?.label || "Logro"
        const titleLine = `## ${RECORDS_EMOJI} **¡Nuevo récord!** • **${firstRecordName}** • **${totalCompleted}/${totalVisible} records**`

        const renderRecord = ({ record, category, tiers, total, done }) => {
            tiers.sort((a, b) => a.threshold - b.threshold)
            const lastTier = tiers[tiers.length - 1]
            const catEmoji = category.emoji || ""
            const namePart = tiers.length > 1 ? `**${lastTier.name}** (+${tiers.length})` : `**${lastTier.name}**`
            const tierXp = tiers.reduce((sum, t) => sum + (t.xp || 0), 0)
            const tierRoles = tiers.filter(t => t.roleId).map(t => `<@&${t.roleId}>`).join(" ")

            const rewards = []
            if (tierXp > 0) rewards.push(`${XP_EMOJI} **+${tierXp} XP**`)
            if (tierRoles) rewards.push(tierRoles)

            return [
                `${record.emoji} ${namePart} — ${done}/${total} niveles`,
                `> ${lastTier.desc}`,
                rewards.length ? `-# ${catEmoji} ${category.name} — ${rewards.join(" + ")}` : `-# ${catEmoji} ${category.name}`,
            ].join("\n")
        }

        // Header y primer récord comparten el mismo TextDisplay para evitar
        // el espacio vertical extra entre ambos componentes.
        const firstRecordText = renderRecord(recordsArray[0])
        if (avatarUrl) {
            container.addSectionComponents(new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${titleLine}\n${firstRecordText}`))
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: avatarUrl } })))
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${titleLine}\n${firstRecordText}`))
        }

        // Bloques por record (SOLO los que se acaban de desbloquear).
        // Si son varios tiers del mismo record: solo el nombre del último + (+N).
        for (const recordData of recordsArray.slice(1)) {
            // Ordenar tiers por threshold
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(renderRecord(recordData)))
        }

        // Separator antes del pie
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))

        // Pie con comando
        const recordsCmd = commandMention(client, "records")
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Consulta ${recordsCmd} para ver tus logros`
        ))

        const newTiers = unlocks.length
        const mentionLine = userId ? [new TextDisplayBuilder().setContent(
            newTiers > 1 ? `<@${userId}> ¡${newTiers} récords nuevos! 🎉` : `<@${userId}> ¡Nuevo récord! 🎉`
        )] : []
        this.msg = {
            components: [...mentionLine, container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: userId ? { users: [userId] } : { parse: [] },
        }
    }

    async send(channel) {
        if (!this.msg || !channel?.send) return false
        try {
            await channel.send(this.msg)
            return true
        } catch {
            return false
        }
    }
}

module.exports = RecordUnlockMessage
module.exports.ACCENTS = ACCENTS
module.exports.commandMention = commandMention
module.exports.RECORDS_EMOJI = RECORDS_EMOJI