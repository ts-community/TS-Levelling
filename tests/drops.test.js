const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")

const Drops = require("../classes/Drops.js")

// dropsHostname sale de config.json: ayudante que lo cambia y lo restaura.
const configPath = path.join(__dirname, "..", "config.json")
// Edición quirúrgica: solo añade/quita la línea "dropsHostname", sin
// reescribir el JSON (un stringify normalizaría finales de línea y espacios
// del archivo del repo).
function setHostKey(text, host) {
    const lines = text.split("\n")
    const idx = lines.findIndex(l => l.includes('"dropsHostname"'))
    if (host) {
        const entry = `  "dropsHostname": "${host}",`
        if (idx !== -1) lines[idx] = entry
        else lines.splice(lines.findIndex(l => l.includes('"siteURL"')) + 1, 0, entry)
    } else if (idx !== -1) {
        lines.splice(idx, 1)
    }
    return lines.join("\n")
}
// Cola en serie: aunque alguien olvide el await, dos usos nunca se
// intercalan (un restore a destiempo borraba dropsHostname del repo).
let configChain = Promise.resolve()
async function withConfigHost(host, fn) {
    const task = configChain.then(async () => {
        const backup = fs.readFileSync(configPath, "utf8")
        try {
            fs.writeFileSync(configPath, setHostKey(backup, host))
            delete require.cache[require.resolve("../config.json")]
            return await fn()
        } finally {
            fs.writeFileSync(configPath, backup)
            delete require.cache[require.resolve("../config.json")]
        }
    })
    configChain = task.catch(() => {})
    return task
}

// Fake de DB mínima con los operadores que usa Drops.
function fakeClient(doc) {
    const getPath = (root, path) => path.split(".").reduce((n, p) => n?.[p], root)
    const setPath = (root, path, value) => {
        const parts = path.split(".")
        let node = root
        for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {}
        node[parts[parts.length - 1]] = value
    }
    return {
        doc,
        db: {
            fetch: (id, filter) => ({ exec: async () => doc }),
            update: (id, data) => ({ exec: async () => {
                for (const [path, value] of Object.entries(data.$set || {})) setPath(doc, path, value)
                for (const [path, value] of Object.entries(data.$inc || {})) setPath(doc, path, (Number(getPath(doc, path)) || 0) + value)
                for (const [path, value] of Object.entries(data.$addToSet || {})) {
                    const arr = getPath(doc, path) || []
                    if (!arr.map(String).includes(String(value))) arr.push(value)
                    setPath(doc, path, arr)
                }
                for (const [path, value] of Object.entries(data.$pull || {})) {
                    setPath(doc, path, (getPath(doc, path) || []).filter(x => String(x) !== String(value)))
                }
                for (const path of Object.keys(data.$unset || {})) {
                    const parts = path.split(".")
                    const parent = getPath(doc, parts.slice(0, -1).join(".")) || doc
                    delete parent[parts[parts.length - 1]]
                }
                return doc
            } }),
        },
    }
}

const now = Date.now()
const mkDrop = (over = {}) => Drops.buildDrop({
    code: "ABC123", name: "Test", amount: 5000, maxClaims: 3,
    expiresAt: now + 3600000, createdBy: "staff1", createdAt: now, ...over,
})

test("genCode uses unambiguous alphabet and avoids collisions", () => {
    const codes = new Set(Array.from({ length: 500 }, () => Drops.genCode()))
    assert.ok(codes.size > 490, "casi todos únicos")
    for (const code of codes) {
        assert.equal(code.length, 6)
        assert.ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code), code)
    }
    // Con rand a 0 sale AAAAAA; si ya existe, el siguiente intento da otro.
    const seq = [...Array(12).fill(0), ...Array(6).fill(0.999)]
    let i = 0
    const fixedRand = () => seq[i++]
    assert.equal(Drops.genCode({}, fixedRand), "AAAAAA")
    assert.equal(Drops.genCode({ AAAAAA: {} }, fixedRand), "999999")
})

test("validateDropInput rejects out-of-range values", () => {
    assert.deepEqual(Drops.validateDropInput({ amount: 5000, maxClaims: 10, durationMin: 60 }), [])
    assert.ok(Drops.validateDropInput({ amount: 50, maxClaims: 10, durationMin: 60 }).length > 0, "muy poco")
    assert.ok(Drops.validateDropInput({ amount: 2000000, maxClaims: 10, durationMin: 60 }).length > 0, "demasiado")
    assert.ok(Drops.validateDropInput({ amount: 5000, maxClaims: 0, durationMin: 60 }).length > 0, "sin usos")
    assert.ok(Drops.validateDropInput({ amount: 5000, maxClaims: 10, durationMin: 1 }).length > 0, "caduca ya")
})

test("validateClaim covers all states", () => {
    assert.deepEqual(Drops.validateClaim(mkDrop(), "u1", now), { ok: true })
    assert.deepEqual(Drops.validateClaim(null, "u1", now), { ok: false, reason: "missing" })
    assert.deepEqual(Drops.validateClaim(mkDrop({ expiresAt: now - 1 }), "u1", now), { ok: false, reason: "expired" })
    assert.deepEqual(Drops.validateClaim(mkDrop({ claims: ["u1"] }), "u1", now), { ok: false, reason: "already" })
    assert.deepEqual(Drops.validateClaim(mkDrop({ claims: ["a", "b", "c"] }), "u9", now), { ok: false, reason: "soldout" })
})

test("balanceHint guides without thinking", () => {
    assert.ok(Drops.balanceHint(500).includes("muy bajo"))
    assert.ok(Drops.balanceHint(3000).includes("bajo"))
    assert.ok(Drops.balanceHint(5000).includes("medio"))
    assert.ok(Drops.balanceHint(12000).includes("alto"))
    assert.ok(Drops.balanceHint(25000).includes("muy alto"))
    assert.ok(Drops.balanceHint(10000, () => 12).includes("nivel 12"))
})

test("claimDrop grants XP once per user until sold out", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", {
        amount: 5000, maxClaims: 2, durationMin: 60, name: "Fiesta", createdBy: "staff",
    })
    assert.equal(created.ok, true)
    assert.equal(created.code.length, 6)
    assert.ok(created.url.endsWith(`/g/${created.code}`), created.url)

    const first = await Drops.claimDrop(client, "g", created.code, "u1")
    assert.equal(first.ok, true)
    assert.equal(first.amount, 5000)
    assert.equal(first.claimsLeft, 1)
    assert.equal(doc.users.u1.xp, 5000)
    assert.equal(doc.users.u1.monthlyXP, 5000)
    assert.equal(doc.users.u1.dailyXP, 5000)

    const again = await Drops.claimDrop(client, "g", created.code, "u1")
    assert.deepEqual([again.ok, again.reason], [false, "already"])
    assert.equal(doc.users.u1.xp, 5000, "reclamar dos veces no duplica")

    const second = await Drops.claimDrop(client, "g", created.code, "u2")
    assert.equal(second.ok, true)
    assert.equal(second.claimsLeft, 0)

    const third = await Drops.claimDrop(client, "g", created.code, "u3")
    assert.deepEqual([third.ok, third.reason], [false, "soldout"])
    assert.equal(doc.users.u3?.xp || 0, 0, "sin cupo no hay XP")
})

test("concurrent double claim by same user grants once", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", {
        amount: 5000, maxClaims: 10, durationMin: 60, name: "X", createdBy: "s",
    })
    // Doble clic a la vez: el candado por drop los serializa.
    const [a, b] = await Promise.all([
        Drops.claimDrop(client, "g", created.code, "u1"),
        Drops.claimDrop(client, "g", created.code, "u1"),
    ])
    const oks = [a, b].filter(r => r.ok)
    const alreadys = [a, b].filter(r => !r.ok && r.reason === "already")
    assert.equal(oks.length, 1)
    assert.equal(alreadys.length, 1)
    assert.equal(doc.users.u1.xp, 5000, "el XP se suma una sola vez")
    assert.equal(doc.drops[created.code].claims.length, 1)
})

test("concurrent claims for the last slot grant exactly once", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", {
        amount: 5000, maxClaims: 1, durationMin: 60, name: "X", createdBy: "s",
    })
    const [a, b] = await Promise.all([
        Drops.claimDrop(client, "g", created.code, "u1"),
        Drops.claimDrop(client, "g", created.code, "u2"),
    ])
    const oks = [a, b].filter(r => r.ok)
    assert.equal(oks.length, 1, "solo uno se lo lleva")
    const totalXp = (doc.users.u1?.xp || 0) + (doc.users.u2?.xp || 0)
    assert.equal(totalXp, 5000, "no se regala de más")
    assert.equal(doc.drops[created.code].claims.length, 1)
})

test("claim on missing drop or empty user fails closed", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    assert.deepEqual((await Drops.claimDrop(client, "g", "NOPE01", "u1")).reason, "missing")
    assert.deepEqual((await Drops.claimDrop(client, "g", "NOPE01", "")).reason, "missing")
    assert.deepEqual((await Drops.claimDrop(client, "nope", "ABC123", "u1")).reason, "missing")
})

test("claimDrop respects expiry", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", {
        amount: 1000, maxClaims: 10, durationMin: 60, name: "X", createdBy: "s", now,
    })
    const late = await Drops.claimDrop(client, "g", created.code, "u1", now + 61 * 60 * 1000)
    assert.deepEqual([late.ok, late.reason], [false, "expired"])
    assert.equal(doc.users.u1?.xp || 0, 0)
})

test("coin drops need the economy connected", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const noBoat = await Drops.createDrop(client, "g", {
        amount: 1000, maxClaims: 5, durationMin: 60, name: "C", createdBy: "s",
        kind: "coins", boatAvailable: false,
    })
    assert.equal(noBoat.ok, false)
    assert.ok(noBoat.errors.join(" ").includes("UNBELIEVABOAT_TOKEN"))
    assert.equal(Drops.validateDropInput({ amount: 1000, maxClaims: 5, durationMin: 60, kind: "raro" }).some(e => e.includes("tipo")), true)
})

test("coin claim pays via API and records once; API failure is retryable", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const paid = []
    const fakeBoat = async (guildId, userId, amount, reason) => {
        paid.push([guildId, userId, amount, reason])
        return { cash: amount }
    }
    const created = await Drops.createDrop(client, "g", {
        amount: 1000, maxClaims: 5, durationMin: 60, name: "Paga", createdBy: "s",
        kind: "coins", boatAvailable: true,
    })
    assert.equal(created.ok, true)
    assert.equal(created.drop.kind, "coins")

    const ok = await Drops.claimDrop(client, "g", created.code, "u1", Date.now(), { addCoins: fakeBoat })
    assert.equal(ok.ok, true)
    assert.deepEqual(paid, [["g", "u1", 1000, `Drop ${created.code}`]])
    assert.equal(doc.users.u1?.xp || 0, 0, "las monedas no tocan el XP")
    assert.ok(doc.drops[created.code].claims.includes("u1"))

    const again = await Drops.claimDrop(client, "g", created.code, "u1", Date.now(), { addCoins: fakeBoat })
    assert.deepEqual([again.ok, again.reason], [false, "already"])
    assert.equal(paid.length, 1, "repetir no vuelve a pagar")

    // Si la API falla, no se registra nada y se puede reintentar.
    const boom = async () => { throw new Error("boat-500") }
    const fail = await Drops.claimDrop(client, "g", created.code, "u2", Date.now(), { addCoins: boom })
    assert.deepEqual([fail.ok, fail.reason], [false, "api-error"])
    assert.ok(!doc.drops[created.code].claims.includes("u2"))
    const retry = await Drops.claimDrop(client, "g", created.code, "u2", Date.now(), { addCoins: fakeBoat })
    assert.equal(retry.ok, true)
})

test("role drops validate role and grant via granter", async () => {
    assert.ok(Drops.validateDropInput({ maxClaims: 5, durationMin: 60, kind: "role", roleId: "" }).some(e => e.includes("rol")))
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", {
        maxClaims: 5, durationMin: 60, name: "Evento", createdBy: "s",
        kind: "role", roleId: "123456789012345678", roleName: "Evento",
    })
    assert.equal(created.ok, true)
    assert.equal(created.drop.kind, "role")

    const granted = []
    const fakeGrant = async (clientArg, guildId, userId, roleId) => { granted.push([guildId, userId, roleId]); return { ok: true } }
    const ok = await Drops.claimDrop(client, "g", created.code, "u1", Date.now(), { grantRole: fakeGrant })
    assert.equal(ok.ok, true)
    assert.deepEqual(granted, [["g", "u1", "123456789012345678"]])
    assert.equal(doc.users.u1?.xp || 0, 0, "el rol no toca el XP")
    assert.ok(doc.drops[created.code].claims.includes("u1"))

    const boom = async () => { throw new Error("role-no-member") }
    const fail = await Drops.claimDrop(client, "g", created.code, "u2", Date.now(), { grantRole: boom })
    assert.deepEqual([fail.ok, fail.reason], [false, "api-error"])
    assert.ok(!doc.drops[created.code].claims.includes("u2"), "si el rol falla no se registra")
    const retry = await Drops.claimDrop(client, "g", created.code, "u2", Date.now(), { grantRole: fakeGrant })
    assert.equal(retry.ok, true)
})

test("dropPath usa ruta corta con subdominio y completa sin él", async () => {
    await withConfigHost("", () => {
        assert.equal(Drops.dropPath("g", "ABC123"), "/drop/g/ABC123")
        assert.equal(Drops.dropsBaseUrl("https://niveles.tscomunity.es"), "https://niveles.tscomunity.es")
    })
    await withConfigHost("drops.tscomunity.es", () => {
        assert.equal(Drops.dropPath("g", "ABC123"), "/g/ABC123")
        assert.equal(Drops.dropsBaseUrl("https://niveles.tscomunity.es"), "https://drops.tscomunity.es")
    })
})

test("item drops validate item and quantity", () => {
    assert.ok(Drops.validateDropInput({ amount: 2, maxClaims: 5, durationMin: 60, kind: "item", itemId: "item1", boatAvailable: true }).length === 0)
    assert.ok(Drops.validateDropInput({ amount: 2, maxClaims: 5, durationMin: 60, kind: "item", itemId: "", boatAvailable: true }).some(e => e.includes("objeto")))
    assert.ok(Drops.validateDropInput({ amount: 0, maxClaims: 5, durationMin: 60, kind: "item", itemId: "item1", boatAvailable: true }).some(e => e.includes("unidades")))
    assert.ok(Drops.validateDropInput({ amount: 2, maxClaims: 5, durationMin: 60, kind: "item", itemId: "item1", boatAvailable: false }).some(e => e.includes("UNBELIEVABOAT_TOKEN")))
})

test("boat store suggests by name and resolves by id or name", async () => {
    const storeItems = [
        { id: "aaa", name: "Pepino dorado", price: "500", emoji_unicode: "🥒" },
        { id: "bbb", name: "Espada rota", price: "100", emoji_unicode: "" },
    ]
    const fakeFetch = async () => ({ ok: true, json: async () => ({ items: storeItems }) })
    process.env.UNBELIEVABOAT_TOKEN = "test-token"
    try {
        Drops.clearBoatStoreCache("g")
        const all = await Drops.suggestBoatItems("g", "", fakeFetch)
        assert.equal(all.length, 2)
        assert.deepEqual(all[0], { id: "aaa", name: "Pepino dorado", price: "500", emoji: "🥒" })
        const filtered = await Drops.suggestBoatItems("g", "pepino", fakeFetch)
        assert.deepEqual(filtered.map(i => i.id), ["aaa"])
        assert.equal((await Drops.resolveBoatItem("g", "bbb", fakeFetch)).name, "Espada rota")
        assert.equal((await Drops.resolveBoatItem("g", "ESPADA ROTA", fakeFetch)).id, "bbb")
        assert.equal(await Drops.resolveBoatItem("g", "no existe", fakeFetch), null)
        assert.equal(await Drops.resolveBoatItem("g", "", fakeFetch), null)
    } finally {
        delete process.env.UNBELIEVABOAT_TOKEN
        Drops.clearBoatStoreCache("g")
    }
})

test("item claim adds to inventory once; API failure is retryable", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", {
        amount: 2, maxClaims: 5, durationMin: 60, name: "Reparto", createdBy: "s",
        kind: "item", itemId: "aaa", itemName: "Pepino dorado", boatAvailable: true,
    })
    assert.equal(created.ok, true)
    assert.equal(created.drop.kind, "item")

    const given = []
    const fakeAdd = async (guildId, userId, itemId, qty) => { given.push([guildId, userId, itemId, qty]); return {} }
    const ok = await Drops.claimDrop(client, "g", created.code, "u1", Date.now(), { addItem: fakeAdd })
    assert.equal(ok.ok, true)
    assert.deepEqual(given, [["g", "u1", "aaa", 2]])
    assert.equal(doc.users.u1?.xp || 0, 0, "el objeto no toca el XP")
    assert.ok(doc.drops[created.code].claims.includes("u1"))

    const boom = async () => { throw new Error("boat-500") }
    const fail = await Drops.claimDrop(client, "g", created.code, "u2", Date.now(), { addItem: boom })
    assert.deepEqual([fail.ok, fail.reason], [false, "api-error"])
    assert.ok(!doc.drops[created.code].claims.includes("u2"))
    const retry = await Drops.claimDrop(client, "g", created.code, "u2", Date.now(), { addItem: fakeAdd })
    assert.equal(retry.ok, true)
})

test("roleIsDangerous y creatorCanGiveRole cierran la puerta a raids", () => {
    const noPerms = { permissions: { has: () => false } }
    assert.equal(Drops.roleIsDangerous(noPerms), false)
    for (const perm of Drops.ROLE_DANGEROUS_PERMS) {
        assert.equal(Drops.roleIsDangerous({ permissions: { has: p => p === perm } }), true, perm)
    }
    assert.ok(Drops.ROLE_DANGEROUS_PERMS.includes("Administrator"))
    assert.ok(Drops.ROLE_DANGEROUS_PERMS.includes("ManageRoles"))
    assert.ok(Drops.ROLE_DANGEROUS_PERMS.includes("BanMembers"))
    assert.equal(Drops.roleIsDangerous({}), true, "sin permisos legibles: peligroso")
    assert.equal(Drops.roleIsDangerous(null), true)
    assert.equal(Drops.creatorCanGiveRole({ isOwner: true, creatorTopPos: 1, rolePos: 99 }), true, "el dueño siempre puede")
    assert.equal(Drops.creatorCanGiveRole({ isOwner: false, creatorTopPos: 50, rolePos: 5 }), true)
    assert.equal(Drops.creatorCanGiveRole({ isOwner: false, creatorTopPos: 50, rolePos: 50 }), false, "a su altura no")
    assert.equal(Drops.creatorCanGiveRole({ isOwner: false, creatorTopPos: 50, rolePos: 60 }), false, "por encima no")
    assert.equal(Drops.creatorCanGiveRole({ isOwner: false, creatorTopPos: null, rolePos: 5 }), false, "sin techo legible no")
})

test("setDropRole re-verifica al reclamar (shard falso)", async () => {
    function fakeShardClient({ rolePos = 5, rolePerms = [], botTop = 10, botManage = true, memberTop = 10, memberId = "u1", ownerId = "owner9", hasRole = false, manageable = true } = {}) {
        const role = {
            id: "123456789012345678", name: "Evento", position: rolePos,
            permissions: { has: p => rolePerms.includes(p) },
            editable: manageable,
        }
        const member = {
            id: memberId,
            roles: {
                cache: new Map(hasRole ? [[role.id, role]] : []),
                highest: { position: memberTop },
                add: async id => { member.roles.cache.set(id, role) },
                remove: async id => { member.roles.cache.delete(id) },
            },
            permissions: { has: () => false },
        }
        const guild = {
            id: "g",
            ownerId,
            roles: { cache: new Map([[role.id, role]]) },
            members: {
                me: { permissions: { has: p => botManage && p === "ManageRoles" }, roles: { highest: { position: botTop } } },
                fetch: async id => (id === memberId ? member : null),
            },
        }
        return {
            member, role,
            shard: { broadcastEval: async (fn, { context }) => [await fn({ guilds: { cache: new Map([["g", guild]]) } }, context)] },
        }
    }

    // Caso feliz.
    let cl = fakeShardClient()
    assert.deepEqual(await Drops.grantDropRole(cl, "g", "u1", "123456789012345678"), { ok: true })
    assert.ok(cl.member.roles.cache.has("123456789012345678"))

    // Rol editado con admin después de crear: se niega.
    cl = fakeShardClient({ rolePerms: ["Administrator"] })
    await assert.rejects(Drops.grantDropRole(cl, "g", "u1", "123456789012345678"), /role-unsafe/)
    assert.ok(!cl.member.roles.cache.has("123456789012345678"))

    // Rol por encima del que reclama: se niega (el bot sí llega).
    cl = fakeShardClient({ rolePos: 30, memberTop: 10, botTop: 40 })
    await assert.rejects(Drops.grantDropRole(cl, "g", "u1", "123456789012345678"), /role-hierarchy/)

    // El dueño está exento de la jerarquía (pero el bot tiene que llegar).
    cl = fakeShardClient({ rolePos: 30, memberTop: 10, botTop: 40, memberId: "owner9", ownerId: "owner9" })
    assert.deepEqual(await Drops.grantDropRole(cl, "g", "owner9", "123456789012345678"), { ok: true })

    // Bot sin altura: se niega.
    cl = fakeShardClient({ botTop: 5 })
    await assert.rejects(Drops.grantDropRole(cl, "g", "u1", "123456789012345678"), /role-no-permission/)

    // Quitar siempre se puede (compensación).
    cl = fakeShardClient({ rolePerms: ["Administrator"] })
    await Drops.grantDropRole(cl, "g", "u1", "123456789012345678").catch(() => {})
    assert.deepEqual(await Drops.revokeDropRole(cl, "g", "u1", "123456789012345678"), { ok: true })
})

test("bundle claim concede todo y compensa fallos parciales", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", {
        maxClaims: 5, durationMin: 60, name: "Pack", createdBy: "s", kind: "bundle",
        prizes: { xp: 1000, coins: 500, roles: [{ id: "123456789012345678", name: "Ev" }], items: [{ id: "aaa", name: "Pep", qty: 2 }] },
        boatAvailable: true,
    })
    assert.equal(created.ok, true)
    assert.equal(Drops.prizesCount(created.drop.prizes), 4)

    const log = []
    const deps = {
        addCoins: async (g, u, n, r) => { log.push(["coins", n, r]) },
        grantRole: async (c, g, u, r) => { log.push(["role", r]) },
        revokeRole: async (c, g, u, r) => { log.push(["unrole", r]) },
        addItem: async (g, u, i, q) => { log.push(["item", i, q]) },
        removeItem: async (g, u, i, q) => { log.push(["unitem", i, q]) },
    }
    const ok = await Drops.claimDrop(client, "g", created.code, "u1", Date.now(), deps)
    assert.equal(ok.ok, true)
    assert.deepEqual(log, [
        ["coins", 500, `Drop ${created.code}`],
        ["role", "123456789012345678"],
        ["item", "aaa", 2],
    ])
    assert.equal(doc.users.u1.xp, 1000)
    assert.ok(doc.drops[created.code].claims.includes("u1"))

    // Falla el objeto tras pagar monedas y dar rol: reembolsa y quita rol.
    const log2 = []
    const deps2 = {
        addCoins: async (g, u, n) => { log2.push(["coins", n]) },
        grantRole: async () => { log2.push(["role"]) },
        revokeRole: async () => { log2.push(["unrole"]) },
        addItem: async () => { throw new Error("boat-500") },
        removeItem: async () => { log2.push(["unitem"]) },
    }
    const fail = await Drops.claimDrop(client, "g", created.code, "u2", Date.now(), deps2)
    assert.deepEqual([fail.ok, fail.reason], [false, "api-error"])
    assert.deepEqual(log2, [["coins", 500], ["role"], ["coins", -500], ["unrole"]])
    assert.ok(!doc.drops[created.code].claims.includes("u2"))
    assert.equal(doc.users.u2?.xp || 0, 0)
})

test("deleteDrop and listDrops", async () => {

test("/drop autocomplete suggests store items by name", async () => {
    const dropCmd = require("../commands/slash/drop.js")
    const storeItems = [{ id: "aaa", name: "Pepino dorado", price: "1", emoji_unicode: "" }]
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: storeItems }) })
    process.env.UNBELIEVABOAT_TOKEN = "test-token"
    try {
        Drops.clearBoatStoreCache("g")
        let answered = null
        const int = {
            guildId: "g",
            options: { getFocused: () => ({ name: "objeto2", value: "pep" }) },
            respond: async choices => { answered = choices },
        }
        await dropCmd.autocomplete({}, int)
        assert.deepEqual(answered, [{ name: "Pepino dorado", value: "aaa" }])

        answered = null
        const other = {
            guildId: "g",
            options: { getFocused: () => ({ name: "cantidad", value: "x" }) },
            respond: async choices => { answered = choices },
        }
        await dropCmd.autocomplete({}, other)
        assert.deepEqual(answered, [], "otras opciones no autocompletan")
    } finally {
        globalThis.fetch = realFetch
        delete process.env.UNBELIEVABOAT_TOKEN
        Drops.clearBoatStoreCache("g")
    }
})
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const a = await Drops.createDrop(client, "g", { amount: 1000, maxClaims: 5, durationMin: 60, name: "A", createdBy: "s" })
    assert.equal(Drops.listDrops(doc).length, 1)
    assert.equal((await Drops.deleteDrop(client, "g", "NOPE")).ok, false)
    assert.equal((await Drops.deleteDrop(client, "g", a.code)).ok, true)
    assert.equal(Drops.listDrops(doc).length, 0)
})

test("duration and amount presets are sane", () => {
    assert.ok(Drops.DURATION_PRESETS.length >= 4)
    for (const d of Drops.DURATION_PRESETS) {
        assert.ok(d.minutes >= Drops.LIMITS.durationMin && d.minutes <= Drops.LIMITS.durationMax)
    }
    const xps = Drops.AMOUNT_PRESETS.map(p => p.xp)
    assert.deepEqual([...xps].sort((a, b) => a - b), xps, "presets ordenados")
    assert.deepEqual(xps, [1000, 3000, 5000, 10000, 25000], "cuadrados y de récords")
    for (const p of Drops.AMOUNT_PRESETS) {
        assert.ok(p.xp >= Drops.LIMITS.amountMin && p.xp <= Drops.LIMITS.amountMax)
        assert.ok(p.name.length > 0)
        const equiv = Drops.presetEquiv(p.xp)
        assert.ok(equiv.includes("de chat") && equiv.includes("nivel"), `equivalencia clara: ${equiv}`)
    }
    assert.equal(Drops.presetEquiv(5000), "≈1,1 h de chat, nivel 8")
    assert.equal(Drops.presetEquiv(1000), "≈13 min de chat, nivel 3")
})

test("dropsHostname sale de config.json", async () => {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.equal(Drops.dropsHostname(), String(raw.dropsHostname || "").trim().toLowerCase())
    await withConfigHost("", () => {
        assert.equal(Drops.dropsHostname(), "")
    })
    await withConfigHost("drops.tscomunity.es", () => {
        assert.equal(Drops.dropsHostname(), "drops.tscomunity.es")
    })
})

test("/drop crear pack multi-premio y validaciones", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drop.js")
    const settings = { enabled: true, manualPerms: false, maxLevel: 100, curve: { 1: 100, 2: 0, 3: 0 }, rounding: 1 }
    const mkTools = doc => ({
        fetchSettings: async () => doc,
        canManageServer: () => true,
        getLevel: (...a) => Tools.global.getLevel(...a),
        commafy: (...a) => Tools.global.commafy(...a),
        warn: msg => { throw new Error("warn: " + msg) },
        WEBSITE: "https://example.test",
    })
    const mkInt = (values, extra = {}) => {
        const int = {
            user: { id: "staff1" },
            guild: { id: "g", ownerId: "owner9" },
            member: { roles: { highest: { position: 50 } } },
            options: {
                get: name => (name in values ? { value: values[name] } : undefined),
                getRole: name => (name === "rol" ? extra.role : undefined),
                getSubcommand: () => "crear",
            },
            reply: async msg => { int.sent = msg; return msg },
        }
        return int
    }
    const mkRole = (over = {}) => ({
        id: "123456789012345678", name: "Evento", managed: false, editable: true,
        position: 5, permissions: { has: () => false }, ...over,
    })

    // Pack completo: XP + monedas + rol (sin token de Boat las monedas fallan).
    process.env.UNBELIEVABOAT_TOKEN = "test-token"
    try {
        const doc = { _id: "g", users: {}, drops: {}, settings }
        const int = mkInt({ xp: 5000, monedas: 1000, usos: 5, duracion: "60", nombre: "Fiesta" }, { role: mkRole() })
        await dropCmd.run(fakeClient(doc), int, mkTools(doc))
        assert.ok(int.sent.includes("5.000 XP"), int.sent)
        assert.ok(int.sent.includes("1.000 monedas"), int.sent)
        assert.ok(int.sent.includes("<@&123456789012345678>"), int.sent)
        const drop = Object.values(doc.drops)[0]
        assert.equal(drop.kind, "bundle")
        assert.deepEqual(drop.prizes.xp, 5000)
        assert.deepEqual(drop.prizes.coins, 1000)
        assert.deepEqual(drop.prizes.roles.map(r => r.id), ["123456789012345678"])
    } finally {
        delete process.env.UNBELIEVABOAT_TOKEN
    }

    // Sin ningún premio: aviso.
    const docEmpty = { _id: "g", users: {}, drops: {}, settings }
    await assert.rejects(
        dropCmd.run(fakeClient(docEmpty), mkInt({ usos: 5 }), mkTools(docEmpty)),
        /al menos un premio/,
    )
    assert.equal(Object.keys(docEmpty.drops).length, 0)

    // Personalizada sin extra: aviso con el campo exacto.
    const docCustom = { _id: "g", users: {}, drops: {}, settings }
    await assert.rejects(
        dropCmd.run(fakeClient(docCustom), mkInt({ xp: 0 }), mkTools(docCustom)),
        /xp_extra/,
    )

    // Rol peligroso (admin): rechazado aunque sea gestionable.
    const docDanger = { _id: "g", users: {}, drops: {}, settings }
    await assert.rejects(
        dropCmd.run(fakeClient(docDanger),
            mkInt({ usos: 5 }, { role: mkRole({ name: "Admin", permissions: { has: p => p === "Administrator" } }) }),
            mkTools(docDanger)),
        /peligrosos/,
    )
    assert.equal(Object.keys(docDanger.drops).length, 0)

    // Rol por encima del creador: rechazado (no auto-darse poder).
    const docHigh = { _id: "g", users: {}, drops: {}, settings }
    await assert.rejects(
        dropCmd.run(fakeClient(docHigh),
            mkInt({ usos: 5 }, { role: mkRole({ name: "Jefazo", position: 60 }) }),
            mkTools(docHigh)),
        /por encima/,
    )
    assert.equal(Object.keys(docHigh.drops).length, 0)
})

test("/drop crear XP personalizada y monedas según token", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drop.js")
    const mkInt = (values) => {
        const int = {
            user: { id: "staff1" },
            guild: { id: "g", ownerId: "owner9" },
            member: { roles: { highest: { position: 50 } } },
            options: {
                get: name => (name in values ? { value: values[name] } : undefined),
                getRole: () => undefined,
                getSubcommand: () => "crear",
            },
            reply: async msg => { int.sent = msg; return msg },
        }
        return int
    }
    const mkTools = doc => ({
        fetchSettings: async () => doc,
        canManageServer: () => true,
        getLevel: (...a) => Tools.global.getLevel(...a),
        commafy: (...a) => Tools.global.commafy(...a),
        warn: msg => { throw new Error("warn: " + msg) },
        WEBSITE: "https://example.test",
    })
    const settings = { enabled: true, manualPerms: false, maxLevel: 100, curve: { 1: 100, 2: 0, 3: 0 }, rounding: 1 }

    // Personalizada: xp 0 (Personalizada) + xp_extra.
    const doc1 = { _id: "g", users: {}, drops: {}, settings }
    const int1 = mkInt({ xp: 0, xp_extra: 7500, usos: 5, duracion: "60", nombre: "X" })
    await dropCmd.run(fakeClient(doc1), int1, mkTools(doc1))
    assert.ok(int1.sent.includes("7.500 XP"), int1.sent)
    assert.equal(Object.values(doc1.drops)[0].prizes.xp, 7500)

    // Monedas sin token: aviso claro, no se crea nada.
    delete process.env.UNBELIEVABOAT_TOKEN
    const doc2 = { _id: "g", users: {}, drops: {}, settings }
    const int2 = mkInt({ monedas: 1000, usos: 5, duracion: "60", nombre: "C" })
    await assert.rejects(dropCmd.run(fakeClient(doc2), int2, mkTools(doc2)), /UNBELIEVABOAT_TOKEN/)
    assert.equal(Object.keys(doc2.drops).length, 0)

    // Monedas con token: se crea y la respuesta avisa de monedas.
    process.env.UNBELIEVABOAT_TOKEN = "test-token"
    try {
        const doc3 = { _id: "g", users: {}, drops: {}, settings }
        const int3 = mkInt({ monedas: 1000, usos: 5, duracion: "60", nombre: "C" })
        await dropCmd.run(fakeClient(doc3), int3, mkTools(doc3))
        assert.ok(int3.sent.includes("monedas"), int3.sent)
        assert.equal(Object.values(doc3.drops)[0].prizes.coins, 1000)
    } finally {
        delete process.env.UNBELIEVABOAT_TOKEN
    }
})

test("/drop rol pide rol gestionable y responde con mención", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drop.js")
    const settings = { enabled: true, manualPerms: false, maxLevel: 100, curve: { 1: 100, 2: 0, 3: 0 }, rounding: 1 }
    const tools = {
        fetchSettings: async () => ({ settings }),
        canManageServer: () => true,
        getLevel: (...a) => Tools.global.getLevel(...a),
        commafy: (...a) => Tools.global.commafy(...a),
        warn: msg => { throw new Error("warn: " + msg) },
        WEBSITE: "https://example.test",
    }
    const mkInt = (role) => ({
        user: { id: "staff1" },
        guild: { id: "g", ownerId: "owner9" },
        member: { roles: { highest: { position: 50 } } },
        options: {
            get: name => ({ usos: { value: 10 }, duracion: { value: "60" }, nombre: { value: "Noche" } }[name]),
            getRole: () => role,
            getSubcommand: () => "crear",
        },
        reply: async function(msg) { this.sent = msg; return msg },
    })

    // Rol no gestionable: aviso, no se crea.
    const doc1 = { _id: "g", users: {}, drops: {}, settings }
    await assert.rejects(
        dropCmd.run(fakeClient(doc1), mkInt({ id: "123456789012345678", name: "Alto", managed: false, editable: false, position: 5, permissions: { has: () => false } }), tools),
        /por debajo de mi rol/,
    )
    assert.equal(Object.keys(doc1.drops).length, 0)

    // Rol válido: se crea y la respuesta lo menciona.
    const doc2 = { _id: "g", users: {}, drops: {}, settings }
    const int2 = mkInt({ id: "123456789012345678", name: "Evento", managed: false, editable: true, position: 5, permissions: { has: () => false } })
    await dropCmd.run(fakeClient(doc2), int2, tools)
    assert.ok(int2.sent.includes("<@&123456789012345678>"), int2.sent)
    const drop = Object.values(doc2.drops)[0]
    assert.equal(drop.kind, "bundle")
    assert.deepEqual(drop.prizes.roles.map(r => r.id), ["123456789012345678"])
})

test("/drop crear responde con enlace y guía de balance", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drop.js")
    const doc = { _id: "g", users: {}, drops: {}, settings: { enabled: true, manualPerms: false, maxLevel: 100, curve: { 1: 100, 2: 0, 3: 0 }, rounding: 1 } }
    const client = fakeClient(doc)
    const values = { xp: 10000, usos: 5, duracion: "60", nombre: "Fiesta" }
    const int = {
        user: { id: "staff1" },
        guild: { id: "g" },
        options: { get: name => (name in values ? { value: values[name] } : undefined), getRole: () => undefined, getSubcommand: () => "crear" },
        reply: async msg => { int.sent = msg; return msg },
    }
    const tools = {
        fetchSettings: async () => doc,
        canManageServer: () => true,
        getLevel: (...a) => Tools.global.getLevel(...a),
        commafy: (...a) => Tools.global.commafy(...a),
        warn: msg => { throw new Error("warn: " + msg) },
        WEBSITE: "https://example.test",
    }
    await withConfigHost("", async () => {
        await dropCmd.run(client, int, tools)
        assert.ok(int.sent.includes("https://example.test/drop/g/"), int.sent)
    })
    assert.ok(int.sent.includes("10.000 XP"), int.sent)
    assert.ok(int.sent.includes("5 usos"), int.sent)
    assert.ok(int.sent.includes("nivel"), "guía de balance con nivel aprox")
    const code = Object.keys(doc.drops)[0]
    assert.equal(code.length, 6)
})

test("/drop crear: opciones separadas por premio", () => {
    const dropCmd = require("../commands/slash/drop.js")
    assert.deepEqual(dropCmd.metadata.args.map(a => a.name), ["crear", "lista", "borrar", "permiso"])
    const crear = dropCmd.metadata.args[0]
    const names = crear.args.map(a => a.name)
    for (const expected of ["xp", "xp_extra", "monedas", "monedas_extra", "objeto", "objeto2", "objeto3", "cantidad", "rol", "usos", "duracion", "nombre"]) {
        assert.ok(names.includes(expected), `falta opción ${expected}`)
    }
    assert.ok(!names.includes("tipo"), "sin selector de tipo: se rellena lo que se reparte")
    assert.deepEqual(crear.args.find(a => a.name === "xp").choices.map(c => c.name), [
        "Muy bajo · 1.000 (≈13 min de chat, nivel 3)",
        "Bajo · 3.000 (≈40 min de chat, nivel 6)",
        "Medio · 5.000 (≈1,1 h de chat, nivel 8)",
        "Alto · 10.000 (≈2,2 h de chat, nivel 11)",
        "Muy alto · 25.000 (≈5,6 h de chat, nivel 18)",
        "Personalizada… (usa xp_extra)",
    ])
    assert.deepEqual(crear.args.find(a => a.name === "monedas").choices.map(c => c.value), [
        5000, 10000, 25000, 50000, 100000, 0,
    ])
    for (const key of ["objeto", "objeto2", "objeto3"]) {
        assert.equal(crear.args.find(a => a.name === key).autocomplete, true)
    }
    for (const arg of crear.args) {
        assert.ok((arg.description || "").length <= 100, `descripción larga: ${arg.name}`)
    }
    for (const choice of crear.args.find(a => a.name === "xp").choices) {
        assert.ok(choice.name.length <= 100, `choice largo: ${choice.name}`)
    }
    for (const choice of crear.args.find(a => a.name === "monedas").choices) {
        assert.ok(choice.name.length <= 100, `choice largo: ${choice.name}`)
    }
})

test("COIN_PRESETS suben la escala y validan rangos propios", () => {
    assert.deepEqual(Drops.COIN_PRESETS.map(p => p.coins), [5000, 10000, 25000, 50000, 100000])
    assert.equal(Drops.validateDropInput({ amount: 500000, maxClaims: 5, durationMin: 60, kind: "coins", boatAvailable: true }).length, 0)
    assert.ok(Drops.validateDropInput({ amount: 50, maxClaims: 5, durationMin: 60, kind: "coins", boatAvailable: true }).length > 0, "pocas monedas")
    assert.ok(Drops.validateDropInput({ amount: 200000000, maxClaims: 5, durationMin: 60, kind: "coins", boatAvailable: true }).length > 0, "por encima del tope")
    assert.ok(Drops.validateDropInput({ maxClaims: 5, durationMin: 60, kind: "bundle", prizes: { coins: 200000000 }, boatAvailable: true }).some(e => e.includes("monedas")))
    assert.ok(Drops.validateDropInput({ maxClaims: 5, durationMin: 60, kind: "bundle", prizes: {}, boatAvailable: true }).some(e => e.includes("al menos un premio")))
})

test("canUseDrops: gestores siempre, si no roles de la allowlist", () => {
    assert.equal(Drops.canUseDrops({ isManager: true, memberRoles: new Map(), settings: {} }), true)
    const settings = { dropRoles: [{ id: "r1" }, { id: "r2" }] }
    assert.equal(Drops.canUseDrops({ isManager: false, memberRoles: new Map([["r2", {}]]), settings }), true)
    assert.equal(Drops.canUseDrops({ isManager: false, memberRoles: new Map([["r9", {}]]), settings }), false)
    assert.equal(Drops.canUseDrops({ isManager: false, memberRoles: ["r1"], settings }), true, "también vale array")
    assert.equal(Drops.canUseDrops({ isManager: false, memberRoles: new Map([["r1", {}]]), settings: {} }), false, "sin lista no entra nadie")
    assert.equal(Drops.canUseDrops({ isManager: false, memberRoles: null, settings }), false)
})

test("/drop permiso añade, lista y quita roles (solo gestores)", async () => {
    const dropCmd = require("../commands/slash/drop.js")
    assert.deepEqual(dropCmd.metadata.args.map(a => a.name), ["crear", "lista", "borrar", "permiso"])
    const mkTools = (manager) => ({
        fetchSettings: async () => doc,
        canManageServer: () => manager,
        warn: msg => { throw new Error("warn: " + msg) },
    })
    const doc = { _id: "g", users: {}, drops: {}, settings: { enabled: true, manualPerms: false } }
    const client = fakeClient(doc)
    const mkInt = (getRole, quitar) => ({
        user: { id: "staff1" },
        guild: { id: "g" },
        options: {
            get: name => (name === "quitar" && quitar ? { value: true } : undefined),
            getRole: () => getRole,
            getSubcommand: () => "permiso",
        },
        reply: async function(msg) { this.sent = msg.content || msg; return msg },
    })
    // Sin rol: lista vacía.
    let sent = ""
    await dropCmd.run(client, {
        user: { id: "staff1" }, guild: { id: "g" },
        options: { get: () => undefined, getRole: () => undefined, getSubcommand: () => "permiso" },
        reply: async msg => { sent = msg.content || msg },
    }, mkTools(true))
    assert.ok(sent.includes("Nadie extra"), sent)
    // Con rol de drops pero sin gestionar: denegado igual.
    await assert.rejects(
        dropCmd.run(client, mkInt({ id: "r1", name: "Staff" }), {
            fetchSettings: async () => ({ settings: { enabled: true, manualPerms: false, dropRoles: [{ id: "r9" }] } }),
            canManageServer: () => false,
            warn: msg => { throw new Error("warn: " + msg) },
        }),
        /notMod/,
    )
    assert.deepEqual(doc.settings.dropRoles || [], [])
    // Añadir dos veces no duplica ($addToSet).
    const int1 = mkInt({ id: "r1", name: "Staff" })
    await dropCmd.run(client, int1, mkTools(true))
    assert.ok(int1.sent.includes("<@&r1>"), int1.sent)
    const int2 = mkInt({ id: "r1", name: "Staff" })
    await dropCmd.run(client, int2, mkTools(true))
    assert.deepEqual(doc.settings.dropRoles, [{ id: "r1" }])
    // Lista los muestra.
    sent = ""
    await dropCmd.run(client, {
        user: { id: "staff1" }, guild: { id: "g" },
        options: { get: () => undefined, getRole: () => undefined, getSubcommand: () => "permiso" },
        reply: async msg => { sent = msg.content || msg },
    }, mkTools(true))
    assert.ok(sent.includes("<@&r1>"), sent)
    // Quitar.
    const int3 = mkInt({ id: "r1", name: "Staff" }, true)
    await dropCmd.run(client, int3, mkTools(true))
    assert.deepEqual(doc.settings.dropRoles, [])
})

test("/drop deja pasar a roles de la allowlist y frena al resto", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drop.js")
    const settings = { enabled: true, manualPerms: false, maxLevel: 100, curve: { 1: 100, 2: 0, 3: 0 }, rounding: 1, dropRoles: [{ id: "r1" }] }
    const tools = {
        fetchSettings: async () => ({ settings }),
        canManageServer: () => false,
        getLevel: (...a) => Tools.global.getLevel(...a),
        commafy: (...a) => Tools.global.commafy(...a),
        warn: msg => { throw new Error("warn: " + msg) },
        WEBSITE: "https://example.test",
    }
    const mkInt = roles => ({
        user: { id: "u1" },
        guild: { id: "g" },
        member: { roles: { cache: new Map(roles.map(r => [r, {}])) } },
        options: { get: () => undefined, getSubcommand: () => "lista" },
        reply: async function(msg) { this.sent = msg.content || msg; return msg },
    })
    const doc = { _id: "g", users: {}, drops: {}, settings }
    await dropCmd.run(fakeClient(doc), mkInt(["r1"]), tools)
    await assert.rejects(dropCmd.run(fakeClient(doc), mkInt(["r9"]), tools), /notMod/)
})

test("/drop crear item resuelve por nombre y responde con unidades", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drop.js")
    const settings = { enabled: true, manualPerms: false, maxLevel: 100, curve: { 1: 100, 2: 0, 3: 0 }, rounding: 1 }
    const storeItems = [{ id: "aaa", name: "Pepino dorado", price: "1", emoji_unicode: "🥒" }]
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: storeItems }) })
    process.env.UNBELIEVABOAT_TOKEN = "test-token"
    try {
        Drops.clearBoatStoreCache("g")
        const doc = { _id: "g", users: {}, drops: {}, settings }
        const values = { objeto: "PEPINO DORADO", cantidad: 3, usos: 5, duracion: "60", nombre: "R" }
        const int = {
            user: { id: "staff1" },
            guild: { id: "g" },
            options: { get: name => (name in values ? { value: values[name] } : undefined), getRole: () => undefined, getSubcommand: () => "crear" },
            reply: async function(msg) { this.sent = msg; return msg },
        }
        const tools = {
            fetchSettings: async () => doc,
            canManageServer: () => true,
            getLevel: (...a) => Tools.global.getLevel(...a),
            commafy: (...a) => Tools.global.commafy(...a),
            warn: msg => { throw new Error("warn: " + msg) },
            WEBSITE: "https://example.test",
        }
        await dropCmd.run(fakeClient(doc), int, tools)
        assert.ok(int.sent.includes("3× Pepino dorado"), int.sent)
        const drop = Object.values(doc.drops)[0]
        assert.equal(drop.kind, "bundle")
        assert.deepEqual(drop.prizes.items.map(i => [i.id, i.qty]), [["aaa", 3]])

        // Nombre inexistente: aviso, no se crea.
        const doc2 = { _id: "g", users: {}, drops: {}, settings }
        const values2 = { ...values, objeto: "no existe" }
        const int2 = {
            user: { id: "staff1" },
            guild: { id: "g" },
            options: { get: name => (name in values2 ? { value: values2[name] } : undefined), getRole: () => undefined, getSubcommand: () => "crear" },
            reply: async function(msg) { this.sent = msg; return msg },
        }
        await assert.rejects(dropCmd.run(fakeClient(doc2), int2, tools), /no está en la tienda/)
        assert.equal(Object.keys(doc2.drops).length, 0)
    } finally {
        globalThis.fetch = realFetch
        delete process.env.UNBELIEVABOAT_TOKEN
        Drops.clearBoatStoreCache("g")
    }
})
