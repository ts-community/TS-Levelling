const { test } = require("node:test")
const assert = require("node:assert/strict")

const { unlockWebEasterEgg, resolveServerId } = require("../classes/WebEasterEgg.js")

function testSettings(overrides = {}) {
    return {
        enabled: true,
        gain: { min: 50, max: 100, time: 60 },
        curve: { "1": 100, "2": 0, "3": 0 },
        rounding: 1,
        maxLevel: 100,
        levelUp: { enabled: false, embed: false, message: "", channel: "current", multiple: 1, multipleUntil: 0 },
        multipliers: { roles: [], rolePriority: "largest", channels: [], channelStacking: "multiply" },
        rewards: [],
        rewardSyncing: { sync: "never", noManual: false, noWarning: false },
        leaderboard: { disabled: false, private: false, hideRoles: false, maxEntries: 0, minLevel: 0, ephemeral: false, embedColor: -1 },
        ...overrides,
    }
}

function fakeClient(doc) {
    return {
        db: {
            fetch: () => ({ exec: async () => JSON.parse(JSON.stringify(doc)) }),
            update: (id, data) => ({ exec: async () => {
                if (data.$set) {
                    for (const [key, value] of Object.entries(data.$set)) {
                        const segments = key.split(".")
                        let cursor = doc
                        for (let i = 0; i < segments.length - 1; i++) {
                            if (!cursor[segments[i]]) cursor[segments[i]] = {}
                            cursor = cursor[segments[i]]
                        }
                        cursor[segments[segments.length - 1]] = value
                    }
                }
                if (data.$inc) {
                    for (const [key, value] of Object.entries(data.$inc)) {
                        const segments = key.split(".")
                        let cursor = doc
                        for (let i = 0; i < segments.length - 1; i++) {
                            if (!cursor[segments[i]]) cursor[segments[i]] = {}
                            cursor = cursor[segments[i]]
                        }
                        const current = Number(cursor[segments[segments.length - 1]] || 0)
                        cursor[segments[segments.length - 1]] = current + value
                    }
                }
                return doc
            } }),
        },
        channels: { fetch: async () => null },
        guilds: { cache: new Map() },
    }
}

test("unlockWebEasterEgg grants the hidden web record once per user/server", async () => {
    const doc = { _id: "123456789012345678", users: { u1: { xp: 0 } }, settings: testSettings() }
    const client = fakeClient(doc)

    const first = await unlockWebEasterEgg({ client, guildId: "123456789012345678", userId: "u1" })
    assert.equal(first.unlocked, true)
    assert.equal(doc.users.u1.records["web_easter:1"], true)
    assert.equal(doc.users.u1.xp, 20000)

    const second = await unlockWebEasterEgg({ client, guildId: "123456789012345678", userId: "u1" })
    assert.equal(second.unlocked, false)
    assert.equal(second.alreadyUnlocked, true)
})

test("resolveServerId picks a guild from explicit params or a single server", () => {
    assert.equal(resolveServerId({ guildId: "223456789012345678", guilds: [{ id: "123456789012345678" }, { id: "223456789012345678" }] }), "223456789012345678")
    assert.equal(resolveServerId({ guilds: [{ id: "333456789012345678" }] }), "333456789012345678")
    assert.equal(resolveServerId({ guilds: [{ id: "123456789012345678" }, { id: "223456789012345678" }] }), null)
})
