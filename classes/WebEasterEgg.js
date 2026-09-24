const { grantRecord } = require("./RecordTracker.js")

function resolveServerId({ guildId, guilds }) {
    const explicit = String(guildId || "").trim()
    if (explicit && /^\d{10,30}$/.test(explicit)) return explicit

    if (!Array.isArray(guilds)) return null
    const ids = guilds.map(g => String(g?.id || "")).filter(Boolean)
    if (ids.length === 1) return ids[0]
    return null
}

async function unlockWebEasterEgg({ client, guildId, userId, guild, guilds }) {
    const resolvedGuildId = resolveServerId({ guildId, guilds })
    if (!resolvedGuildId || !userId) {
        return { ok: false, unlocked: false, alreadyUnlocked: false, reason: "missing-guild-or-user", guildId: resolvedGuildId || null }
    }

    const result = await grantRecord(
        client,
        guild || client?.guilds?.cache?.get?.(resolvedGuildId) || null,
        resolvedGuildId,
        String(userId),
        "web_easter",
        1,
    )

    if (result) {
        return { ok: true, unlocked: true, alreadyUnlocked: false, guildId: resolvedGuildId, result }
    }

    return { ok: true, unlocked: false, alreadyUnlocked: true, guildId: resolvedGuildId, result: null }
}

module.exports = {
    resolveServerId,
    unlockWebEasterEgg,
}
