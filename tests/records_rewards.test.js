const { test } = require("node:test")
const assert = require("node:assert/strict")

const tracker = require("../classes/RecordTracker.js")
const recordsConfig = require("../config/records.js")
const LevelUpMessage = require("../classes/LevelUpMessage.js")
const OvertakeMessage = require("../classes/OvertakeMessage.js")

// Fake DB en memoria (dotted paths, $set/$inc/$unset, con .exec()).
function getPath(obj, path) {
    return path.split(".").reduce((cur, seg) => (cur === undefined ? undefined : cur[seg]), obj)
}
function setPath(obj, path, value) {
    const segs = path.split(".")
    let cur = obj
    for (let i = 0; i < segs.length - 1; i++) {
        if (typeof cur[segs[i]] !== "object" || cur[segs[i]] === null) cur[segs[i]] = {}
        cur = cur[segs[i]]
    }
    cur[segs[segs.length - 1]] = value
}
function unsetPath(obj, path) {
    const segs = path.split(".")
    let cur = obj
    for (let i = 0; i < segs.length - 1; i++) {
        if (cur[segs[i]] === undefined) return
        cur = cur[segs[i]]
    }
    delete cur[segs[segs.length - 1]]
}
function applyUpdate(doc, data) {
    if (data.$set) for (const [p, v] of Object.entries(data.$set)) setPath(doc, p, v)
    if (data.$inc) for (const [p, v] of Object.entries(data.$inc)) {
        setPath(doc, p, (getPath(doc, p) === undefined ? 0 : getPath(doc, p)) + v)
    }
    if (data.$unset) for (const p of Object.keys(data.$unset)) unsetPath(doc, p)
}

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
            update: (id, data) => ({ exec: async () => { applyUpdate(doc, data); return doc } }),
        },
        channels: { fetch: async () => null },
    }
}

test("grantRecord suma el XP del tier a xp y monthlyXP", async () => {
    const doc = { _id: "g1", users: { u1: { xp: 0 } }, settings: testSettings() }
    const client = fakeClient(doc)

    const first = await tracker.grantRecord(client, null, "g1", "u1", "messages", 10)
    assert.ok(first && first.record && first.tier, "devuelve info del desbloqueo")
    assert.equal(doc.users.u1.records["messages:10"], true)
    assert.equal(doc.users.u1.xp, 1000)
    assert.equal(doc.users.u1.monthlyXP, 1000)

    const second = await tracker.grantRecord(client, null, "g1", "u1", "messages", 10)
    assert.equal(second, null, "duplicado no da XP dos veces")
    assert.equal(doc.users.u1.xp, 1000)
})

test("grantRecord dispara level-up al cruzar de rango con XP de récord", async () => {
    const doc = {
        _id: "g1",
        users: { u1: { xp: 0, messages: 3, monthlyMessages: 1 } },
        settings: testSettings({
            levelUp: { enabled: true, embed: false, message: "", channel: "current", multiple: 1, multipleUntil: 0 },
            rewards: [{ id: "r1", level: 1 }],
        }),
    }
    const client = fakeClient(doc)

    const originalSend = LevelUpMessage.prototype.send
    let sends = 0
    LevelUpMessage.prototype.send = async function () { sends++ }
    try {
        // +1.000 XP con curva 100/nivel: cruza el rol de nivel 1.
        const result = await tracker.grantRecord(client, null, "g1", "u1", "messages", 10)
        assert.ok(result && result.record)
    } finally {
        LevelUpMessage.prototype.send = originalSend
    }
    assert.equal(sends, 1, "el XP de récord también sube de nivel")
    assert.equal(doc.users.u1.xp, 1000)
})

test("buildRecordResetUpdate revierte solo records + XP de récords", () => {
    const userData = {
        xp: 1000, monthlyXP: 800,
        messages: 50, monthlyMessages: 20,
        streak: { current: 5, lastDay: "2026-01-01" },
        reactionsSent: 9, channels: { a: 1 }, countingSent: 3,
        voiceMinutes: 60, voiceJoined: ["v"], cooldown: 123, hidden: false,
        records: { "messages:10": true }, // 1.000 XP según catálogo
    }
    const reset = tracker.buildRecordResetUpdate("u1", userData)
    assert.ok(reset)
    assert.equal(reset.removedXp, 1000)
    assert.equal(reset.count, 1)

    const copy = JSON.parse(JSON.stringify(userData))
    applyUpdate({ users: { u1: copy } }, reset.update)
    assert.equal(copy.xp, 0)
    assert.equal(copy.monthlyXP, 0)
    assert.equal(copy.records, undefined)
    // Progreso intacto: no se toca nada que no sea de récords.
    assert.equal(copy.messages, 50)
    assert.equal(copy.monthlyMessages, 20)
    assert.deepEqual(copy.streak, { current: 5, lastDay: "2026-01-01" })
    assert.equal(copy.reactionsSent, 9)
    assert.deepEqual(copy.channels, { a: 1 })
    assert.equal(copy.countingSent, 3)
    assert.equal(copy.voiceMinutes, 60)
    assert.equal(copy.cooldown, 123)
})

test("buildRecordResetUpdate devuelve null sin nada que revertir", () => {
    assert.equal(tracker.buildRecordResetUpdate("u1", { xp: 10, messages: 5 }), null)
})

test("level-up sin mensaje origen omite la cita", () => {
    const settings = testSettings({
        levelUp: { enabled: true, embed: false, message: "", channel: "current", multiple: 1, multipleUntil: 0 },
        rewards: [{ id: "r1", level: 1 }],
    })
    const msg = new LevelUpMessage(settings, null, {
        oldLevel: 0, level: 1,
        userData: { xp: 150, messages: 5, monthlyMessages: 2 },
        user: { id: "u1", username: "Test" }, client: null,
    })
    assert.equal(!!msg.invalid, false)
    const json = JSON.stringify(msg.msg.components.map(c => c.toJSON()))
    assert.ok(!json.includes("Mensaje de subida"), "sin trigger no hay cita")
    assert.ok(json.includes("¡Nuevo rango!"), "la mención exterior se mantiene")
})

test("adelantamiento sin mensaje origen omite la cita", () => {
    const settings = testSettings({
        levelUp: { enabled: true, embed: false, message: "", channel: "current", multiple: 1, multipleUntil: 0 },
    })
    const msg = new OvertakeMessage(settings, null, {
        oldPos: 3, newPos: 2, overtakenIds: ["u9"], level: 5,
        userData: { xp: 500, messages: 1, monthlyMessages: 1 },
        user: { id: "u1" }, client: null,
    })
    assert.equal(!!msg.invalid, false)
    const json = JSON.stringify(msg.msg.components.map(c => c.toJSON()))
    assert.ok(!json.includes("Mensaje de adelantamiento"), "sin trigger no hay cita")
    assert.ok(json.includes("¡Nuevo adelantamiento!"), "la mención exterior se mantiene")
})

test("unlock agrupa tiers del mismo record: último nombre (+N), sin ✅", () => {
    const RecordUnlockMessage = require("../classes/RecordUnlockMessage.js")
    const byId = Object.fromEntries(recordsConfig.allRecords().map(({ record }) => [record.id, record]))
    const catOf = id => recordsConfig.allRecords().find(x => x.record.id === id).category
    const msg = new RecordUnlockMessage({
        client: null, userId: "u1", avatarUrl: "",
        unlocks: [
            { record: byId.messages, category: catOf("messages"), tier: byId.messages.tiers[0], done: 3, total: 5, totalCompleted: 3, totalVisible: 9 },
            { record: byId.messages, category: catOf("messages"), tier: byId.messages.tiers[1], done: 3, total: 5, totalCompleted: 3, totalVisible: 28 },
            { record: byId.messages, category: catOf("messages"), tier: byId.messages.tiers[2], done: 3, total: 5, totalCompleted: 10, totalVisible: 40 },
            { record: byId.streak, category: catOf("streak"), tier: byId.streak.tiers[0], done: 1, total: 3, totalCompleted: 10, totalVisible: 40 },
        ],
    })
    const json = JSON.stringify(msg.msg.components.map(c => c.toJSON()))
    // Un solo bloque por record: solo el nombre del último tier + (+N).
    assert.ok(json.includes("**Conversador** (+3)"), "último tier + contador")
    assert.ok(!json.includes("Primeros pasos"), "no lista cada tier")
    assert.ok(!json.includes("✅"), "sin tick verde")
    // Título estilo /rank con ## y totales del usuario.
    assert.ok(json.includes("##") && json.includes("10/40 records"), "título con los totales más recientes del lote")
    // Línea de categoría (no nombre del record).
    assert.ok(json.includes("Actividad"), "categoría en la línea de recompensa")
    assert.ok(json.includes("¡4 récords nuevos!"), "mención en plural")
})

test("getRecordIds expone los 6 IDs de records", () => {
    const ids = tracker.getRecordIds()
    for (const key of ["channelId", "countingChannelId", "iaChannelId", "iaBotId", "starboardChannelId", "starboardBotId"]) {
        assert.ok(/^\d{10,30}$/.test(ids[key]), `${key} debe ser un ID de Discord`)
    }
    assert.deepEqual(ids, recordsConfig.CHANNELS)
})
