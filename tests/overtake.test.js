const { test } = require("node:test")
const assert = require("node:assert/strict")

const OvertakeMessage = require("../classes/OvertakeMessage.js")
const LevelUpMessage = require("../classes/LevelUpMessage.js")
const ranks = require("../consts/ranks.js")
const Tools = require("../classes/Tools.js")
const NewMessage = require("../commands/events/message.js")
const AddXp = require("../commands/slash/addxp.js")

const PRO_ID = ranks.find(r => r.rank === "pro").roles[0].id

function lbSettings(extra = {}) {
    return {
        enabled: true,
        gain: { min: 100, max: 100, time: 0 },
        curve: { 1: 100, 2: 0, 3: 0 },
        rounding: 1,
        maxLevel: 100,
        levelUp: { enabled: true, channel: "current", multiple: 1, multipleUntil: 0 },
        multipliers: { roles: [], rolePriority: "largest", channels: [], channelStacking: "multiply" },
        rewards: [{ id: PRO_ID, level: 5 }],
        rewardSyncing: { sync: "never" },
        leaderboard: { minLevel: 0 },
        ...extra,
    }
}

function fakeMsg(authorId = "u1") {
    return {
        id: "m1",
        author: { id: authorId, username: "pro", displayName: "Pro" },
        member: { displayAvatarURL: () => "" },
        guild: { id: "g1" },
        channel: { id: "c1" },
        client: null,
    }
}

// --- unidad: isProRank ---

test("overtake: isProRank por nivel efectivo", () => {
    const settings = lbSettings()
    // nivel 6 >= 5 -> rol Pro efectivo
    assert.equal(NewMessage.isProRank({ roles: { cache: new Map() } }, 6, settings), true)
    // nivel 2 < 5 -> no Pro
    assert.equal(NewMessage.isProRank({ roles: { cache: new Map() } }, 2, settings), false)
})

test("overtake: isProRank por rol puesto aunque el nivel no de Pro", () => {
    const settings = lbSettings({ rewards: [] })
    const cache = new Map([[PRO_ID, { id: PRO_ID }]])
    assert.equal(NewMessage.isProRank({ roles: { cache } }, 1, settings), true)
    assert.equal(NewMessage.isProRank({ roles: { cache: new Map() } }, 1, settings), false)
})

// --- unidad: getOvertakenIds ---

test("overtake: detecta adelantamiento simple 3 -> 2", () => {
    const settings = lbSettings()
    const oldUsers = { u1: { xp: 800 }, u2: { xp: 900 }, u3: { xp: 1000 } }
    const newUsers = { u1: { xp: 950 }, u2: { xp: 900 }, u3: { xp: 1000 } }
    assert.deepEqual(NewMessage.getOvertakenIds(oldUsers, newUsers, "u1", settings), {
        oldPos: 3, newPos: 2, overtakenIds: ["u2"],
    })
})

test("overtake: salto multiple devuelve todos los adelantados", () => {
    const settings = lbSettings()
    const oldUsers = { u1: { xp: 500 }, u2: { xp: 900 }, u3: { xp: 800 }, u4: { xp: 1000 } }
    const newUsers = { u1: { xp: 950 }, u2: { xp: 900 }, u3: { xp: 800 }, u4: { xp: 1000 } }
    const res = NewMessage.getOvertakenIds(oldUsers, newUsers, "u1", settings)
    assert.equal(res.oldPos, 4)
    assert.equal(res.newPos, 2)
    assert.deepEqual(res.overtakenIds, ["u2", "u3"])
})

test("overtake: sin subida de puesto devuelve null", () => {
    const settings = lbSettings()
    const oldUsers = { u1: { xp: 800 }, u2: { xp: 900 } }
    const newUsers = { u1: { xp: 850 }, u2: { xp: 900 } }
    assert.equal(NewMessage.getOvertakenIds(oldUsers, newUsers, "u1", settings), null)
})

test("overtake: entrada nueva en el top no cuenta como adelantamiento", () => {
    const settings = lbSettings()
    const oldUsers = { u2: { xp: 900 } }
    const newUsers = { u1: { xp: 950 }, u2: { xp: 900 } }
    assert.equal(NewMessage.getOvertakenIds(oldUsers, newUsers, "u1", settings), null)
})

test("overtake: usuarios ocultos no cuentan", () => {
    const settings = lbSettings()
    const oldUsers = { u1: { xp: 800 }, u2: { xp: 900, hidden: true } }
    const newUsers = { u1: { xp: 950 }, u2: { xp: 900, hidden: true } }
    // u2 oculta no esta en el top: u1 ya era #1 y sigue #1
    assert.equal(NewMessage.getOvertakenIds(oldUsers, newUsers, "u1", settings), null)
})

// --- unidad: OvertakeMessage ---

test("overtake: construye payload V2 con menciones a ambos", () => {
    const settings = lbSettings()
    const m = new OvertakeMessage(settings, fakeMsg("u1"), {
        oldPos: 3, newPos: 2, overtakenIds: ["u2"], level: 9, userData: { xp: 950, messages: 10, monthlyMessages: 3 },
    })
    assert.equal(m.invalid, undefined)
    assert.ok(m.msg)
    assert.deepEqual([...m.msg.allowedMentions.users].sort(), ["u1", "u2"])
    // mencion fuera + container
    assert.equal(m.msg.components.length, 2)
    // fuera: solo el autor, igual que "¡Nuevo rango!"
    const outside = m.msg.components[0].toJSON().content
    assert.ok(outside.includes("<@u1>") && outside.includes("¡Nuevo adelantamiento!"))
    assert.ok(!outside.includes("<@u2>"))
    // dentro: linea corta del adelantado (sin TOP, con emoji de usuario)
    const inside = JSON.stringify(m.container.toJSON())
    assert.ok(inside.includes("¡Adelantamiento!"))
    assert.ok(inside.includes("#2")) // TOP nuevo en el titulo
    assert.ok(inside.includes("<:member:1467596629787021415>"))
    assert.ok(inside.includes("Adelantado:** <@u2>"))
    assert.ok(!inside.includes("Adelantados:"))
    assert.ok(!inside.includes("Top anterior"))
    assert.ok(inside.includes("Nivel 9"))
    assert.ok(!inside.includes("Rango:"))
    // sin mensaje con texto (fakeMsg no tiene content) no hay cita
    assert.ok(!inside.includes("Mensaje del adelantamiento:"))
})

test("overtake: con mas de 3 adelantados se resume fuera", () => {
    const settings = lbSettings()
    const m = new OvertakeMessage(settings, fakeMsg("u1"), {
        oldPos: 6, newPos: 1, overtakenIds: ["u2", "u3", "u4", "u5", "u6"], level: 9, userData: { xp: 950 },
    })
    assert.equal(m.invalid, undefined)
    const outside = m.msg.components[0].toJSON().content
    assert.ok(outside.includes("<@u1>"))
    assert.ok(!outside.includes("<@u2>"))
    // pings: autor + primero (los unicos mencionados en visible)
    assert.deepEqual([...m.msg.allowedMentions.users].sort(), ["u1", "u2"])
    // dentro solo el primero, el resto resumido
    const inside5 = JSON.stringify(m.container.toJSON())
    assert.ok(inside5.includes("<@u2>") && !inside5.includes("<@u3>"))
    assert.ok(inside5.includes("(+4 más)"))
    assert.ok(inside5.includes("Adelantados:"))
})

test("overtake: con 2 adelantados sale el de mas arriba y en plural", () => {
    const settings = lbSettings()
    const m = new OvertakeMessage(settings, fakeMsg("u1"), {
        oldPos: 4, newPos: 2, overtakenIds: ["u2", "u3"], level: 9, userData: { xp: 950 },
    })
    assert.equal(m.invalid, undefined)
    const inside = JSON.stringify(m.container.toJSON())
    assert.ok(inside.includes("Adelantados:** <@u2> (+1 más)"))
    assert.ok(!inside.includes("<@u3>"))
    // ping solo al autor y al mencionado
    assert.deepEqual([...m.msg.allowedMentions.users].sort(), ["u1", "u2"])
})

test("overtake: cita el mensaje que provoco el adelantamiento", () => {
    const settings = lbSettings()
    const msg = { ...fakeMsg("u1"), content: "vamos equipo que les pasamos" }
    const m = new OvertakeMessage(settings, msg, {
        oldPos: 3, newPos: 2, overtakenIds: ["u2"], level: 9, userData: { xp: 950 },
    })
    const inside = JSON.stringify(m.container.toJSON())
    assert.ok(inside.includes("Mensaje de adelantamiento:"))
    assert.ok(inside.includes("vamos equipo que les pasamos"))
})

test("overtake: invalido sin mejora de puesto", () => {
    const settings = lbSettings()
    const m = new OvertakeMessage(settings, fakeMsg("u1"), {
        oldPos: 2, newPos: 2, overtakenIds: ["u2"], level: 9, userData: { xp: 950 },
    })
    assert.equal(m.invalid, true)
    const m2 = new OvertakeMessage(settings, fakeMsg("u1"), {
        oldPos: 2, newPos: 3, overtakenIds: [], level: 9, userData: { xp: 1 },
    })
    assert.equal(m2.invalid, true)
})

// --- integracion: flujo de mensaje ---

function deepClone(v) { return JSON.parse(JSON.stringify(v)) }
function setPath(obj, p, v) {
    const segs = p.split("."); let cur = obj
    for (let i = 0; i < segs.length - 1; i++) { if (typeof cur[segs[i]] !== "object" || !cur[segs[i]]) cur[segs[i]] = {}; cur = cur[segs[i]] }
    cur[segs[segs.length - 1]] = v
}
function getPath(obj, p) { return p.split(".").reduce((c, s) => (c === undefined ? undefined : c[s]), obj) }

function createFakeDb(docSettings, users) {
    const doc = { _id: "g1", users: deepClone(users), settings: deepClone(docSettings), info: {} }
    return {
        doc,
        fetch: () => ({ exec: async () => deepClone(doc) }),
        update: (id, data) => ({
            exec: async () => {
                if (data.$set) for (const [p, v] of Object.entries(data.$set)) setPath(doc, p, v)
                if (data.$inc) for (const [p, v] of Object.entries(data.$inc)) setPath(doc, p, (getPath(doc, p) ?? 0) + v)
                return doc
            }
        }),
        create: async () => {},
    }
}

function makeHarness(users, settings, memberRoles = []) {
    const db = createFakeDb(settings, users)
    let overtakeSends = 0
    const origSend = OvertakeMessage.prototype.send
    OvertakeMessage.prototype.send = function () { overtakeSends++; return Promise.resolve() }
    const LevelUpMessage = require("../classes/LevelUpMessage.js")
    const origLvl = LevelUpMessage.prototype.send
    LevelUpMessage.prototype.send = function () { return Promise.resolve() }

    const roleMap = new Map(memberRoles.map((r, i) => [r, { id: r, position: i }]))
    const member = {
        id: "u1", displayName: "Pro", displayAvatarURL: () => "",
        roles: { cache: roleMap, add: async () => {} },
    }
    const message = {
        id: "m1",
        author: { id: "u1", bot: false, username: "pro", displayName: "Pro" },
        guild: {
            id: "g1", roles: { cache: new Map() }, memberCount: 3,
        },
        member,
        channel: { id: "c1", isThread: () => false },
    }
    const tools = {
        isDev: () => false,
        fetchSettings: async (uid) => {
            const s = await db.fetch().exec()
            const data = { settings: s.settings, users: {} }
            if (s.users[uid] !== undefined) data.users[uid] = s.users[uid]
            return data
        },
        getMultiplier: () => ({ multiplier: 1 }),
        rng: () => 100,
        getLevel: (...a) => Tools.global.getLevel(...a),
        checkLevelRoles: () => ({}),
        syncLevelRoles: async () => {},
    }
    const client = { db, monthlyMaintenance: async () => {} }
    return {
        run: async () => {
            await NewMessage.run(client, message, tools)
            await new Promise(r => setImmediate(r))
            await new Promise(r => setImmediate(r))
            OvertakeMessage.prototype.send = origSend
            LevelUpMessage.prototype.send = origLvl
            return overtakeSends
        },
    }
}

test("overtake: flujo Pro que adelanta envia aviso", async () => {
    const h = makeHarness(
        { u1: { xp: 850, cooldown: 0 }, u2: { xp: 900, cooldown: 0 } },
        lbSettings(),
    )
    assert.equal(await h.run(), 1)
})

test("overtake: flujo sin adelantar no envia", async () => {
    const h = makeHarness(
        { u1: { xp: 500, cooldown: 0 }, u2: { xp: 900, cooldown: 0 } },
        lbSettings(),
    )
    assert.equal(await h.run(), 0)
})

test("overtake: flujo no-Pro que adelanta no envia", async () => {
    // sin rewards nadie es Pro (nivel 9 pero sin rol Pro)
    const h = makeHarness(
        { u1: { xp: 850, cooldown: 0 }, u2: { xp: 900, cooldown: 0 } },
        lbSettings({ rewards: [] }),
    )
    assert.equal(await h.run(), 0)
})

// --- XP manual (/addxp): mismo aviso que en el flujo de mensajes ---

function makeAddXpHarness(users, settings, xpAmount = 100) {
    const doc = { settings: deepClone(settings), users: deepClone(users) }
    let overtakeSends = 0
    const origOver = OvertakeMessage.prototype.send
    const origLvl = LevelUpMessage.prototype.send
    OvertakeMessage.prototype.send = function () { overtakeSends++; return Promise.resolve() }
    LevelUpMessage.prototype.send = function () { return Promise.resolve() }

    const targetUser = { id: "u1", displayName: "Pro", username: "pro" }
    const targetMember = {
        user: targetUser,
        displayAvatarURL: () => "",
        roles: { cache: new Map(), add: async () => {} },
    }
    const int = {
        guild: { id: "g1", roles: { cache: new Map() } },
        channel: { id: "c1" },
        member: { roles: { cache: new Map() } },
        options: {
            get: name => {
                if (name === "member") return { member: targetMember }
                if (name === "xp") return { value: xpAmount }
                return undefined // operation -> default add_xp
            },
        },
        reply: async () => {},
    }
    const tools = {
        fetchSettings: async uid => ({ settings: doc.settings, users: { [uid]: doc.users[uid] } }),
        fetchAll: async () => deepClone({ settings: doc.settings, users: doc.users }),
        canManageServer: () => true,
        getLevel: (...a) => Tools.global.getLevel(...a),
        clamp: (...a) => Tools.global.clamp(...a),
        xpForLevel: (...a) => Tools.global.xpForLevel(...a),
        commafy: (...a) => Tools.global.commafy(...a),
        checkLevelRoles: () => ({}),
        syncLevelRoles: async () => {},
    }
    const client = {
        db: {
            update: (id, data) => {
                const xpPath = Object.keys(data.$set || {})[0]
                const userId = xpPath.split(".")[1]
                doc.users[userId] = { ...(doc.users[userId] || {}), xp: data.$set[xpPath] }
                return Promise.resolve()
            },
        },
    }
    return {
        run: async () => {
            await AddXp.run(client, int, tools)
            for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r))
            OvertakeMessage.prototype.send = origOver
            LevelUpMessage.prototype.send = origLvl
            return overtakeSends
        },
    }
}

test("overtake: /addxp Pro que adelanta envia aviso", async () => {
    const h = makeAddXpHarness(
        { u1: { xp: 850, cooldown: 0 }, u2: { xp: 900, cooldown: 0 } },
        lbSettings(),
        100, // 850 -> 950, adelanta a u2
    )
    assert.equal(await h.run(), 1)
})

test("overtake: /addxp sin adelantar no envia", async () => {
    const h = makeAddXpHarness(
        { u1: { xp: 500, cooldown: 0 }, u2: { xp: 900, cooldown: 0 } },
        lbSettings(),
        100, // 500 -> 600, sigue por detras
    )
    assert.equal(await h.run(), 0)
})

test("overtake: /addxp no-Pro que adelanta no envia", async () => {
    const h = makeAddXpHarness(
        { u1: { xp: 850, cooldown: 0 }, u2: { xp: 900, cooldown: 0 } },
        lbSettings({ rewards: [] }),
        100,
    )
    assert.equal(await h.run(), 0)
})
