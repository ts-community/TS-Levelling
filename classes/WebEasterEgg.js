const { grantRecord, sendBatchedUnlocks, sendHiddenDm, getRecordIds } = require("./RecordTracker.js")
const recordsConfig = require("../config/records.js")

const DEFAULT_EASTEREGG_GUILD_ID = "1093864130030612521"
const WEB_EASTER_RECORD_ID = "web_easter"
const WEB_EASTER_THRESHOLD = 1

function resolveServerId({ guildId, guilds, defaultGuildId = null }) {
    const explicit = String(guildId || "").trim()
    if (explicit && /^\d{10,30}$/.test(explicit)) return explicit

    if (Array.isArray(guilds)) {
        const ids = guilds.map(g => String(g?.id || "")).filter(Boolean)
        if (ids.length === 1) return ids[0]
    }

    const fallback = String(defaultGuildId || "").trim()
    if (fallback && /^\d{10,30}$/.test(fallback)) return fallback
    return null
}

function getWebEasterMeta() {
    const found = recordsConfig.allRecords().find(x => x.record.id === WEB_EASTER_RECORD_ID)
    if (!found) return null
    const tier = found.record.tiers.find(t => t.threshold === WEB_EASTER_THRESHOLD) || found.record.tiers[0]
    return { record: found.record, category: found.category, tier }
}

function toSerializableUnlock(result) {
    if (!result) return null
    return {
        record: result.record,
        category: result.category,
        tier: result.tier,
        done: result.done,
        total: result.total,
        totalCompleted: result.totalCompleted,
        totalVisible: result.totalVisible,
    }
}

// Fallback para sharding: el servidor puede no estar en el shard 0 (donde corre la web).
// Reenvía el anuncio al shard que sí tiene la guild.
async function announceViaShards(client, guildId, userId, avatarUrl, unlock) {
    try {
        if (!client?.shard?.broadcastEval) return false
        const channelId = getRecordIds().channelId || recordsConfig.CHANNELS?.channelId
        if (!channelId) return false
        const results = await client.shard.broadcastEval(async (cl, ctx) => {
            try {
                const guild = cl.guilds.cache.get(ctx.guildId)
                if (!guild) return false
                const path = require("path")
                const RecordUnlockMessage = require(path.join(ctx.dir, "/RecordUnlockMessage.js"))
                const channel = await cl.channels.fetch(ctx.channelId).catch(() => null)
                if (!channel || channel.guild?.id !== ctx.guildId || !channel.isTextBased?.()) return false
                let avatar = ctx.avatarUrl || ""
                if (!avatar) {
                    try {
                        const m = await guild.members.fetch(ctx.userId).catch(() => null)
                        if (m && typeof m.displayAvatarURL === "function") avatar = m.displayAvatarURL({ format: "png", dynamic: true })
                    } catch {}
                }
                const msg = new RecordUnlockMessage({ client: cl, userId: ctx.userId, avatarUrl: avatar, unlocks: [ctx.unlock] })
                return await msg.send(channel).catch(() => false)
            } catch { return false }
        }, { context: { guildId: String(guildId), userId: String(userId), avatarUrl: avatarUrl || "", unlock, channelId: String(channelId), dir: __dirname } })
        return Array.isArray(results) ? results.some(Boolean) : !!results
    } catch { return false }
}

async function unlockWebEasterEgg({ client, guildId, userId, guild, guilds, defaultGuildId = DEFAULT_EASTEREGG_GUILD_ID, avatarUrl = "" }) {
    const resolvedGuildId = resolveServerId({ guildId, guilds, defaultGuildId })
    if (!resolvedGuildId || !userId) {
        return { ok: false, unlocked: false, alreadyUnlocked: false, reason: "missing-guild-or-user", guildId: resolvedGuildId || null, meta: getWebEasterMeta() }
    }

    const resolvedGuild = guild || client?.guilds?.cache?.get?.(resolvedGuildId) || null

    const result = await grantRecord(
        client,
        resolvedGuild,
        resolvedGuildId,
        String(userId),
        WEB_EASTER_RECORD_ID,
        WEB_EASTER_THRESHOLD,
    )

    const meta = getWebEasterMeta()

    if (!result) {
        return { ok: true, unlocked: false, alreadyUnlocked: true, guildId: resolvedGuildId, result: null, meta }
    }

    // grantRecord solo guarda en DB (+ level-up). El anuncio de récord hay que enviarlo aparte.
    let announced = false
    try {
        let avatar = avatarUrl || ""
        if (!avatar && resolvedGuild?.members) {
            try {
                const member = await resolvedGuild.members.fetch(String(userId)).catch(() => null)
                if (member && typeof member.displayAvatarURL === "function") avatar = member.displayAvatarURL({ format: "png", dynamic: true })
            } catch {}
        }
        if (result.recordsChannel) {
            await sendBatchedUnlocks({ client, userId: String(userId), avatarUrl: avatar, unlocks: [result] })
            announced = !!result.recordsChannel
        } else {
            announced = await announceViaShards(client, resolvedGuildId, String(userId), avatar, toSerializableUnlock(result))
            // El anuncio por shards no manda DM: se hace desde aquí (la API
            // llega igual aunque la guild no esté en este shard).
            await sendHiddenDm(client, String(userId), [result], avatar)
        }
    } catch {}

    return { ok: true, unlocked: true, alreadyUnlocked: false, guildId: resolvedGuildId, result, meta, announced }
}

module.exports = {
    DEFAULT_EASTEREGG_GUILD_ID,
    WEB_EASTER_RECORD_ID,
    WEB_EASTER_THRESHOLD,
    resolveServerId,
    unlockWebEasterEgg,
    getWebEasterMeta,
}
