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

const Tools = require("./Tools.js")

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

const CATEGORY_ORDER = ["actividad", "comunidad", "canales", "voz", "hidden"]

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

// Render compartido de un Record desbloqueado (mismo que /records):
// título ### en una sola línea con guion (puede saltar en móvil),
// descripción citada y línea de categoría + XP sumado.
// El (+N) solo aparece cuando se han subido varios niveles del mismo Record.
function renderRecord({ record, category, tiers, total, done }) {
    tiers.sort((a, b) => a.threshold - b.threshold)
    const lastTier = tiers[tiers.length - 1]
    const catEmoji = category.emoji || ""
    const multi = tiers.length > 1 ? ` (+${tiers.length})` : ""
    const tierXp = tiers.reduce((sum, t) => sum + (t.xp || 0), 0)
    const tierRoles = tiers.filter(t => t.roleId).map(t => `<@&${t.roleId}>`).join(" ")

    const rewards = []
    if (tierXp > 0) rewards.push(`${XP_EMOJI} **+${Tools.global.commafy(tierXp)} XP**`)
    if (tierRoles) rewards.push(tierRoles)

    return [
        `### ${record.emoji} **${lastTier.name}** - ${done}/${total} fases${multi}`,
        `> ${lastTier.desc}`,
        rewards.length ? `-# ${catEmoji} ${category.name} — ${rewards.join(" + ")}` : `-# ${catEmoji} ${category.name}`,
    ].join("\n")
}

// Mensaje de Record en Components V2.
// Mención fuera de los containers (notificación móvil) + un container por
// categoría desbloqueada, cada uno con su color de acento. El primero lleva
// la cabecera y el avatar; el pie va siempre en el último container.
class RecordUnlockMessage {
    // unlocks: array de { record, category, tier, done, total }
    constructor({ client, userId, avatarUrl, unlocks }) {
        this.client = client || null

        if (!unlocks?.length) throw new Error("unlocks vacío")

        // Agrupar por Record (clave: record.id) para combinar tiers del mismo logro
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

        // Ordenar: por categoría y de más difícil a más fácil.
        const recordsArray = [...byRecord.values()].sort((a, b) => {
            const ca = CATEGORY_ORDER.indexOf(a.category.id)
            const cb = CATEGORY_ORDER.indexOf(b.category.id)
            if (ca !== cb) return ca - cb
            const da = a.record.tiers[a.record.tiers.length - 1]?.threshold || 0
            const db = b.record.tiers[b.record.tiers.length - 1]?.threshold || 0
            return db - da
        })

        // Un container por categoría: cada uno con su color de acento.
        const byCategory = new Map()
        for (const recordData of recordsArray) {
            const catId = recordData.category.id
            if (!byCategory.has(catId)) byCategory.set(catId, [])
            byCategory.get(catId).push(recordData)
        }

        // Totales globales del usuario (el último desbloqueo trae el estado
        // global más reciente del lote).
        const last = unlocks[unlocks.length - 1]
        const totalCompleted = last.totalCompleted ?? unlocks.length
        const totalVisible = last.totalVisible ?? unlocks.reduce((sum, u) => sum + u.total, 0)
        const titleLine = `## 🎉 ¡Nuevo Record!  ${RECORDS_EMOJI} ${totalCompleted}/${totalVisible} Records`

        const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        const text = content => new TextDisplayBuilder().setContent(content)

        const containers = []
        let first = true
        for (const [, catRecords] of byCategory) {
            const accentColor = ACCENTS[catRecords[0].category?.id] ?? 0xe6c036
            const container = new ContainerBuilder().setAccentColor(accentColor)

            if (first) {
                // Cabecera y primer Record comparten el mismo TextDisplay para
                // evitar el espacio vertical extra entre ambos componentes.
                const header = `${titleLine}\n${renderRecord(catRecords[0])}`
                if (avatarUrl) {
                    container.addSectionComponents(new SectionBuilder()
                        .addTextDisplayComponents(text(header))
                        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: avatarUrl } })))
                } else {
                    container.addTextDisplayComponents(text(header))
                }
                for (const recordData of catRecords.slice(1)) {
                    container.addSeparatorComponents(sep())
                    container.addTextDisplayComponents(text(renderRecord(recordData)))
                }
                first = false
            } else {
                // El cambio de container ya separa: sin título ni separador inicial.
                let added = false
                for (const recordData of catRecords) {
                    if (added) container.addSeparatorComponents(sep())
                    container.addTextDisplayComponents(text(renderRecord(recordData)))
                    added = true
                }
            }

            containers.push(container)
        }

        // Pie con comando, siempre en el último container.
        const lastContainer = containers[containers.length - 1]
        lastContainer.addSeparatorComponents(sep())
        const recordsCmd = commandMention(client, "records")
        lastContainer.addTextDisplayComponents(text(
            `-# Consulta ${recordsCmd} para ver tus logros`
        ))

        const newTiers = unlocks.length
        const mentionLine = userId ? [text(
            newTiers > 1 ? `<@${userId}> ¡${newTiers} Records completados! 🎉` : `<@${userId}> ¡Record completado! 🎉`
        )] : []
        this.msg = {
            components: [...mentionLine, ...containers],
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
module.exports.renderRecord = renderRecord
