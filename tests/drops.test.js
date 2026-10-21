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

// Texto plano de una respuesta V2 (o de una normal): junta el contenido de
// los TextDisplay y el content para poder hacer includes sobre las frases.
function flatText(msg) {
    if (msg == null) return ""
    const chunks = []
    const walk = node => {
        if (!node || typeof node !== "object") return
        if (Array.isArray(node)) return node.forEach(walk)
        if (typeof node.content === "string") chunks.push(node.content)
        for (const key of ["components", "contents"]) walk(node[key])
    }
    const comps = Array.isArray(msg.components) ? msg.components : []
    walk(comps.map(c => (typeof c.toJSON === "function" ? c.toJSON() : c)))
    if (typeof msg.content === "string" && !chunks.includes(msg.content)) chunks.push(msg.content)
    return chunks.join("\n")
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
        assert.equal(code.length, 8)
        assert.ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(code), code)
    }
    // Con rand a 0 sale AAAAAAAA; si ya existe, el siguiente intento da otro.
    const seq = [...Array(24).fill(0), ...Array(8).fill(0.999)]
    let i = 0
    const fixedRand = () => seq[i++]
    assert.equal(Drops.genCode({}, fixedRand), "AAAAAAAA")
    assert.equal(Drops.genCode({ AAAAAAAA: {} }, fixedRand), "99999999")
})

test("validateDropInput rejects out-of-range values", () => {
    assert.deepEqual(Drops.validateDropInput({ amount: 5000, maxClaims: 10, durationMin: 60 }), [])
    assert.ok(Drops.validateDropInput({ amount: 0, maxClaims: 10, durationMin: 60 }).length > 0, "muypoco XP")
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
    assert.ok(Drops.balanceHint(3000).includes("muy bajo"))
    assert.ok(Drops.balanceHint(5000).includes("bajo"))
    assert.ok(Drops.balanceHint(10000).includes("medio"))
    assert.ok(Drops.balanceHint(18000).includes("alto"))
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
    assert.equal(created.code.length, 8)
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
        assert.equal(Drops.dropUrl("g", "ABC123", "https://niveles.tscomunity.es"), "https://niveles.tscomunity.es/drop/g/ABC123")
    })
    await withConfigHost("drops.tscomunity.es", () => {
        assert.equal(Drops.dropPath("g", "ABC123"), "/g/ABC123")
        assert.equal(Drops.dropsBaseUrl("https://niveles.tscomunity.es"), "https://drops.tscomunity.es")
        // Servidor principal: enlace ultracorto sin ID; el resto, con ID.
        assert.equal(Drops.dropUrl(Drops.MAIN_GUILD_ID, "ABC234", "web"), "https://drops.tscomunity.es/ABC234")
        assert.equal(Drops.dropUrl("g", "ABC234", "web"), "https://drops.tscomunity.es/g/ABC234")
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

test("parseModalAmount y modales de cantidad exacta", () => {
    const dropCmd = require("../commands/slash/drops.js")
    assert.deepEqual(dropCmd.parseModalAmount("25", { min: 1, max: 5000 }), { ok: true, value: 25 })
    assert.deepEqual(dropCmd.parseModalAmount(" 48 ", { min: 1, max: 720 }), { ok: true, value: 48 })
    for (const bad of ["", "  ", "abc", "1.5", "-3", "+25", "0", "5001", "99999999999999999999", "25 usos"]) {
        assert.deepEqual(dropCmd.parseModalAmount(bad, { min: 1, max: 5000 }), { ok: false }, bad || "(vacío)")
    }
    assert.deepEqual(dropCmd.parseModalAmount("721", { min: 1, max: 720 }), { ok: false }, "horas de más")
    const usesJson = dropCmd.buildUsesModal("ABC123").toJSON()
    assert.equal(usesJson.custom_id, "dropm:uses:ABC123")
    assert.ok(usesJson.title.includes("ABC123"))
    const usesInput = usesJson.components[0].components[0]
    assert.equal(usesInput.custom_id, "amount")
    assert.equal(usesInput.required, true)
    const timeJson = dropCmd.buildTimeModal("ABC123").toJSON()
    assert.equal(timeJson.custom_id, "dropm:time:ABC123")
    assert.deepEqual([dropCmd.BTN_PREFIX, dropCmd.MODAL_PREFIX], ["drop", "dropm"])
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

test("/drop autocomplete suggests store items by name", async () => {
    const dropCmd = require("../commands/slash/drops.js")
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

test("deleteDrop and listDrops", async () => {
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
    assert.deepEqual(xps, [3000, 5000, 10000, 15000, 30000], "cuadrados y de récords")
    for (const p of Drops.AMOUNT_PRESETS) {
        assert.ok(p.xp >= Drops.LIMITS.amountMin && p.xp <= Drops.LIMITS.amountMax)
        assert.ok(p.name.length > 0)
        const equiv = Drops.presetEquiv(p.xp)
        assert.ok(equiv.includes("de chat") && equiv.includes("nivel"), `equivalencia clara: ${equiv}`)
    }
    assert.equal(Drops.presetEquiv(5000), "≈1,1 h de chat, nivel 8")
    assert.equal(Drops.presetEquiv(1000), "≈13 min de chat, nivel 3")
    assert.equal(Drops.presetEquiv(25000), "≈5,6 h de chat, nivel 18")
    assert.equal(Drops.kindEmoji("xp"), "🆙")
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

test("asistente de crear: draft y helpers", () => {
    const dropCmd = require("../commands/slash/drops.js")

    // Borrador base: nombre del comando, usos y duración por defecto.
    const d = dropCmd.makeDraft("Fiesta")
    assert.equal(d.name, "Fiesta")
    assert.equal(d.maxClaims, 10)
    assert.equal(d.durationMin, 1440)
    assert.deepEqual(d.items, [])
    assert.deepEqual(dropCmd.draftPrizes(d), { xp: 0, coins: 0, roles: [], items: [] })

    // Objetos: se agrupan por id; máximo 3 distintos; cantidades con tope.
    assert.equal(dropCmd.draftAddItem(d, { id: "aaa", name: "Pepino" }, 2), true)
    assert.equal(dropCmd.draftAddItem(d, { id: "aaa", name: "Pepino" }, 3), true, "mismo objeto junta cantidad")
    assert.deepEqual(d.items, [{ id: "aaa", name: "Pepino", qty: 5 }])
    assert.equal(dropCmd.draftAddItem(d, { id: "bbb", name: "B" }, 1), true)
    assert.equal(dropCmd.draftAddItem(d, { id: "ccc", name: "C" }, 1), true)
    assert.equal(dropCmd.draftAddItem(d, { id: "ddd", name: "D" }, 1), false, "tope de 3 objetos")
    dropCmd.draftRemoveItem(d, "aaa")
    assert.ok(d.items.every(i => i.id !== "aaa"))
    assert.equal(dropCmd.draftAddItem(d, { id: "ddd", name: "D" }, 9999), true, "ahora entra el cuarto")
    assert.ok(d.items.find(i => i.id === "ddd").qty <= Drops.LIMITS.qtyMax, "cantidad con tope")

    // Reservas: sin duplicados y con el tope del límite.
    const picks = []
    for (let i = 0; i < 120; i++) picks.push({ id: String(BigInt("100000000000000000") + BigInt(i)), name: `u${i}` })
    dropCmd.draftAddAllow(d, picks)
    assert.equal(d.allow.length, Drops.LIMITS.allowedMax, "tope de reservas")
    assert.equal(new Set(d.allow.map(u => u.id)).size, d.allow.length, "sin duplicados")
    dropCmd.draftRemoveAllow(d, picks[0].id)
    assert.equal(d.allow.length, Drops.LIMITS.allowedMax - 1)
    dropCmd.draftRemoveAllow(d, "no-existe")
    assert.equal(d.allow.length, Drops.LIMITS.allowedMax - 1, "quitar a quien no está: no ruido")

    // Duración: etiqueta de preset y minutos en crudo si no está en la lista.
    assert.equal(dropCmd.durationLabel(60), "1 hora")
    assert.ok(dropCmd.durationLabel(500).includes("500"))
})

test("asistente de crear: panel raíz con menús y botones", () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drops.js")
    const mkTools = { commafy: (...a) => Tools.global.commafy(...a), getLevel: () => 3 }
    const compsOf = container => container.toJSON().components
    const flatOf = container => {
        const json = container.toJSON()
        return {
            text: json.components.filter(c => c.type === 10).map(c => c.content).join("\n"),
            ids: json.components.flatMap(c => (c.components || []).map(s => ({ id: s.custom_id, disabled: !!s.disabled, type: s.type }))),
        }
    }
    const storeItems = [{ id: "aaa", name: "Pepino dorado", price: 50, emoji: "🥒" }]

    // Raíz: resumen sin premios, Crear apagado y Cancelar siempre visible.
    const root = dropCmd.buildMakeContainer(dropCmd.makeDraft("Fiesta"), { tools: mkTools, boat: true, storeItems })
    const rootFlat = flatOf(root)
    assert.ok(rootFlat.text.includes("Crear drop: Fiesta"), rootFlat.text)
    assert.ok(rootFlat.text.includes("nada todavía"), "sin premios se ve claro")
    assert.ok(rootFlat.text.includes("Público"), "sin reservas se dice público")
    assert.ok(rootFlat.text.includes("Usos:** 10"), rootFlat.text)
    // Separadores entre bloque config, cabecera premio, lista premios, menús, botones.
    assert.ok(root.toJSON().components.filter(c => c.type === 14).length >= 5, "separadores del esquema")
    // Menú de premios: xp/coins/item. Menú de usuarios nativo (type 5).
    const reward = rootFlat.ids.find(c => c.id === "wizmk:reward")
    assert.ok(reward, "menú de premios")
    const rewardMenu = compsOf(root).flatMap(c => c.components || []).find(c => c.custom_id === "wizmk:reward")
    assert.deepEqual(rewardMenu.options.map(o => o.value), ["xp", "coins", "item"])
    assert.ok(rootFlat.ids.some(c => c.id === "wizmk:users" && c.type === 5), "menú de usuarios")
    // Botones de config y final.
    for (const id of ["wizmk:name", "wizmk:uses", "wizmk:dur", "wizmk:cancel"]) {
        assert.ok(rootFlat.ids.some(c => c.id === id), id)
    }
    assert.ok(rootFlat.ids.some(c => c.id === "wizmk:create" && c.disabled), "Crear apagado sin premios")

    // Sin token de Boat: sin monedas ni objetos en el menú.
    const rootNoBoat = dropCmd.buildMakeContainer(dropCmd.makeDraft("X"), { tools: mkTools, boat: false })
    const noBoatJson = JSON.stringify(compsOf(rootNoBoat))
    assert.ok(!noBoatJson.includes('"value":"coins"'), "sin Boat no se ofrecen monedas")
    assert.ok(!noBoatJson.includes('"value":"item"'), "sin Boat no se ofrece objeto")

    // Con XP: premio en la lista y Crear encendido.
    const withXp = dropCmd.buildMakeContainer({ ...dropCmd.makeDraft("Fiesta"), xp: 5000 }, { tools: mkTools, boat: true })
    const withXpFlat = flatOf(withXp)
    assert.ok(withXpFlat.text.includes("5.000 XP"), withXpFlat.text)
    assert.ok(withXpFlat.ids.some(c => c.id === "wizmk:create" && !c.disabled), "Crear encendido con premio")
})

test("asistente de crear: paneles efímeros por tipo de premio", () => {
    const dropCmd = require("../commands/slash/drops.js")
    const tools = { commafy: n => String(n) }
    const flatIds = c => c.toJSON().components.flatMap(x => (x.components || []).map(s => s.custom_id))

    // XP: presets de récords + personalizada + quitar premio.
    const xp = dropCmd.buildPickContainer("xp", { tools, boat: true })
    const xpMenu = xp.toJSON().components.flatMap(c => c.components || []).find(c => c.custom_id === "wizmk:xp")
    assert.ok(xpMenu, "menú de XP en el panel efímero")
    assert.equal(xpMenu.options.length, 7, "5 presets + personalizada + quitar")
    assert.ok(xpMenu.options.some(o => o.value === "custom"), "preset Personalizada…")
    assert.ok(xpMenu.options.some(o => o.value === "none"), "opción para quitar el premio")
    const xpIds = flatIds(xp)
    assert.ok(xpIds.includes("wizmk:done"), "botón Cerrar en el panel")

    // Monedas: misma estructura económica (5 presets + personalizada + quitar).
    const coins = dropCmd.buildPickContainer("coins", { tools, boat: true })
    const coinsMenu = coins.toJSON().components.flatMap(c => c.components || []).find(c => c.custom_id === "wizmk:coins")
    assert.equal(coinsMenu.options.length, 7, "5 presets + personalizada + quitar")

    // Objeto: opciones por item de la tienda y menú de quitar si hay.
    const store = [{ id: "aaa", name: "Pepino dorado", price: 50, emoji: "🥒" }]
    const itemBefore = dropCmd.buildPickContainer("item", { tools, boat: true, storeItems: store })
    const itemJson = JSON.stringify(itemBefore.toJSON())
    assert.ok(itemJson.includes("wizmk:item"), "menú de objetos")
    assert.ok(itemJson.includes("🥒 Pepino dorado"), "emoji+nombre en el menú")
    assert.ok(!itemJson.includes("wizmk:ritem"), "sin lista de quitar si no hay objetos")
    const itemAfter = dropCmd.buildPickContainer("item", {
        tools, boat: true, storeItems: store,
        draft: { ...dropCmd.makeDraft("F"), items: [{ id: "aaa", name: "Pepino dorado", qty: 3 }] },
    })
    const afterJson = JSON.stringify(itemAfter.toJSON())
    assert.ok(afterJson.includes("wizmk:ritem"), "menú de quitar objeto con items")
    assert.ok(afterJson.includes("3× Pepino dorado"), "cantidad en el label")
})

test("asistente de crear: confirmación efímera y cancelado", () => {
    const dropCmd = require("../commands/slash/drops.js")
    const confirmJson = JSON.stringify(dropCmd.buildConfirmContainer("✅ Premios: 🆙 10 XP").toJSON())
    assert.ok(confirmJson.includes("✅ Premios:"), confirmJson)
    const cancelJson = JSON.stringify(dropCmd.buildCancelledContainer().toJSON())
    assert.ok(cancelJson.includes("Cancelado"), cancelJson)
})

test("asistente de crear: runCreate abre el mensaje y no toca la DB", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drops.js")
    const settings = { enabled: true, manualPerms: false, maxLevel: 100, curve: { 1: 100, 2: 0, 3: 0 }, rounding: 1 }
    const mkTools = doc => ({
        fetchSettings: async () => doc,
        canManageServer: () => true,
        getLevel: (...a) => Tools.global.getLevel(...a),
        commafy: (...a) => Tools.global.commafy(...a),
        warn: msg => { throw new Error("warn: " + msg) },
        WEBSITE: "https://example.test",
    })
    const mkInt = values => {
        const int = {
            user: { id: "staff1" },
            guild: { id: "g", ownerId: "owner9" },
            member: { roles: { highest: { position: 50 } } },
            options: {
                get: name => (name in values ? { value: values[name] } : undefined),
                getSubcommand: () => "crear",
            },
            deferReply: async () => {},
            editReply: async msg => { int.sent = flatText(msg); return msg },
        }
        return int
    }

    // Solo con el nombre: mensaje del asistente, nada en la DB.
    const doc = { _id: "g", users: {}, drops: {}, settings }
    const int = mkInt({ nombre: "Fiesta" })
    await dropCmd.run(fakeClient(doc), int, mkTools(doc))
    assert.ok(int.sent.includes("Crear drop: Fiesta"), int.sent)
    assert.ok(int.sent.includes("nada todavía"), "sin premios todavía")
    assert.equal(Object.keys(doc.drops).length, 0, "nada se crea hasta el botón Crear")
    assert.equal(doc.settings.dropSeq, undefined, "el contador no avanza sin crear")

    // Sin nombre: "Drop #1" automático con el contador del servidor.
    const doc2 = { _id: "g", users: {}, drops: {}, settings: { ...settings } }
    const int2 = mkInt({})
    await dropCmd.run(fakeClient(doc2), int2, mkTools(doc2))
    assert.ok(int2.sent.includes("Drop #1"), int2.sent)
})

test("asistente de crear: metadata solo pide el nombre", () => {
    const dropCmd = require("../commands/slash/drops.js")
    assert.deepEqual(dropCmd.metadata.args.map(a => a.name), ["crear", "mostrar", "eliminar", "permiso"])
    const crear = dropCmd.metadata.args[0]
    assert.deepEqual(crear.args.map(a => a.name), ["nombre"], "solo nombre")
    assert.ok(!crear.args[0].required, "nombre opcional (Drop #N automático)")
    assert.ok((crear.description || "").length <= 100, "descripción corta")
})

test("asistente de crear: resumen con usos, duración y privados", () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drops.js")
    const mkTools = { commafy: (...a) => Tools.global.commafy(...a), getLevel: () => 3 }
    const d = dropCmd.makeDraft("Fiesta", { maxClaims: 5, durationMin: 60 })
    dropCmd.draftAddAllow(d, [{ id: "1000000000000000001", name: "Pepe" }])
    // Al pasar a privado, los usos se igualan a los reservados automáticamente.
    assert.equal(d.maxClaims, 1)
    const text = dropCmd.buildMakeContainer(d, { tools: mkTools, boat: true }).toJSON().components
        .filter(c => c.type === 10).map(c => c.content).join("\n")
    assert.ok(text.includes("Usos:** 1"), text)
    assert.ok(text.includes("1 hora"), text)
    assert.ok(text.includes("<@1000000000000000001>"), "privado con mención")
    assert.ok(text.includes("Privado"), text)
    // Quitar el único privado vuelve a público y no baja los usos a cero.
    dropCmd.draftRemoveAllow(d, "1000000000000000001")
    const text2 = dropCmd.buildMakeContainer(d, { tools: mkTools, boat: true }).toJSON().components
        .filter(c => c.type === 10).map(c => c.content).join("\n")
    assert.ok(text2.includes("Público"), text2)
    assert.equal(d.maxClaims, 1, "usos manuales no se tocan al vaciar")
})

test("asistente de crear: objeto con modal de cantidad", () => {
    const dropCmd = require("../commands/slash/drops.js")
    const qty = dropCmd.buildMakeQtyModal({ id: "aaa", name: "Pepino dorado" }).toJSON()
    assert.equal(qty.custom_id, "dropw:qty:aaa")
    assert.equal(qty.components[0].components[0].custom_id, "value")
    assert.equal(dropCmd.buildMakeUsesModal().toJSON().custom_id, "dropw:uses")
    assert.equal(dropCmd.buildMakeNameModal().toJSON().custom_id, "dropw:name")
    assert.equal(dropCmd.buildMakeXpModal().toJSON().custom_id, "dropw:xp")
    assert.equal(dropCmd.buildMakeCoinsModal().toJSON().custom_id, "dropw:coins")
})

test("COIN_PRESETS suben la escala y validan rangos propios", () => {
    assert.deepEqual(Drops.COIN_PRESETS.map(p => p.coins), [5000, 10000, 25000, 50000, 100000])
    assert.equal(Drops.validateDropInput({ amount: 500000, maxClaims: 5, durationMin: 60, kind: "coins", boatAvailable: true }).length, 0)
    assert.ok(Drops.validateDropInput({ amount: 0, maxClaims: 5, durationMin: 60, kind: "coins", boatAvailable: true }).length > 0, "tas de monedas mínimo")
    assert.ok(Drops.validateDropInput({ amount: 1, maxClaims: 5, durationMin: 60, kind: "coins", boatAvailable: true }).length === 0, "ya 1 moneda vale")
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

test("/drops permiso añade, lista y quita roles (solo gestores)", async () => {
    const dropCmd = require("../commands/slash/drops.js")
    assert.deepEqual(dropCmd.metadata.args.map(a => a.name), ["crear", "mostrar", "eliminar", "permiso"])
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
        deferReply: async () => {},
        editReply: async function(msg) { this.sent = flatText(msg); return msg },
    })
    // Sin rol: lista vacía.
    let sent = ""
    await dropCmd.run(client, {
        user: { id: "staff1" }, guild: { id: "g" },
        options: { get: () => undefined, getRole: () => undefined, getSubcommand: () => "permiso" },
        deferReply: async () => {},
        editReply: async msg => { sent = flatText(msg) },
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
        deferReply: async () => {},
        editReply: async msg => { sent = flatText(msg) },
    }, mkTools(true))
    assert.ok(sent.includes("<@&r1>"), sent)
    // Quitar.
    const int3 = mkInt({ id: "r1", name: "Staff" }, true)
    await dropCmd.run(client, int3, mkTools(true))
    assert.deepEqual(doc.settings.dropRoles, [])
})

test("/drops deja pasar a roles de la allowlist y frena al resto", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drops.js")
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
        options: { get: () => undefined, getSubcommand: () => "mostrar" },
        deferReply: async () => {},
        editReply: async function(msg) { this.sent = flatText(msg); return msg },
        fetchReply: async () => null,
    })
    const doc = { _id: "g", users: {}, drops: {}, settings }
    await dropCmd.run(fakeClient(doc), mkInt(["r1"]), tools)
    await assert.rejects(dropCmd.run(fakeClient(doc), mkInt(["r9"]), tools), /notMod/)
})

test("/drops mostrar: título, links con (x/y), tachado si agotado y volver atrás primero", async () => {
    const Tools = require("../classes/Tools.js")
    const dropCmd = require("../commands/slash/drops.js")
    const now = Date.now()
    const rowsOf = () => [
        { code: "AAA111", drop: { name: "A", kind: "bundle", prizes: { xp: 1000, coins: 0, roles: [], items: [] }, maxClaims: 3, claims: ["u1"], expiresAt: now + 3600000, createdBy: "s", createdAt: now }, left: 2, expired: false },
        { code: "BBB222", drop: { name: "B", kind: "bundle", prizes: { xp: 0, coins: 500, roles: [], items: [] }, maxClaims: 2, claims: ["u1", "u2"], expiresAt: now + 3600000, createdBy: "s", createdAt: now }, left: 0, expired: false },
        { code: "CCC333", drop: { name: "C", kind: "bundle", prizes: { xp: 1000, coins: 0, roles: [], items: [] }, maxClaims: 3, claims: [], expiresAt: now - 1000, createdBy: "s", createdAt: now }, left: 3, expired: true },
    ]
    const tools = { commafy: (...a) => Tools.global.commafy(...a), WEBSITE: "https://example.test" }
    const textsOf = container => container.toJSON().components
        .filter(c => c.type === 10)
        .map(c => c.content)
        .join("\n---\n")
    await withConfigHost("", async () => {
        // Vista lista: sin caducados, sin fecha por línea, sin párrafo largo.
        const list = dropCmd.buildDropsListContainer(rowsOf().filter(r => !r.expired), "https://example.test", "g", tools)
        const texts = textsOf(list)
        assert.ok(texts.includes("## 🎁 Drops del servidor"), "título")
        assert.ok(!texts.includes("Cada persona reclama"), "sin párrafo explicativo largo")
        assert.ok(texts.includes("[`AAA111`](https://example.test/drop/g/AAA111) (1/3)"), "link con reclamados")
        assert.ok(!texts.includes("caduca <t:"), "sin caducidad por línea")
        assert.ok(texts.includes("~~[`BBB222`](https://example.test/drop/g/BBB222)~~ (2/2)"), "agotado tachado")
        assert.ok(!texts.includes("CCC333"), "caducados fuera")
        const menuJson = list.toJSON().components.flatMap(c => c.components || []).find(c => c.custom_id === "dropinspect")
        assert.ok(menuJson, "menú debajo")
        assert.deepEqual(menuJson.options.map(o => o.value), ["AAA111", "BBB222"])

        // Vista detalle: unix corto, botones y vuelva atrás PRIMERO.
        const detail = dropCmd.buildDropDetailContainer(rowsOf().filter(r => !r.expired), rowsOf()[0], "https://example.test", "g", tools)
        const dTexts = textsOf(detail)
        assert.ok(dTexts.includes("1.000 XP"), "premio exacto")
        assert.ok(dTexts.includes("1/3"), "reclamados")
        const unix = Math.floor((now + 3600000) / 1000)
        assert.ok(dTexts.includes(`<t:${unix}:R>`), "caducidad corta")
        assert.ok(!dTexts.includes(`<t:${unix}:F>`), "sin fecha completa")
        assert.ok(!dTexts.includes("<@s>"), "sin creador (menos info)")
        assert.ok(dTexts.includes("https://example.test/drop/g/AAA111"), "enlace")
        const detailJson = detail.toJSON().components.flatMap(c => c.components || [])
        assert.ok(!dTexts.includes("Reservado"), "drop público sin línea de reserva")
        assert.deepEqual(
            detailJson.filter(c => c.type === 2).map(c => c.custom_id),
            ["drop:del:AAA111", "drop:uses:AAA111", "drop:time:AAA111", "drop:solo:AAA111"],
            "botones encima del menú",
        )
        const detailMenu = detailJson.find(c => c.custom_id === "dropinspect")
        assert.deepEqual(detailMenu.options.map(o => o.value), ["__back", "BBB222"], "volver atrás primero")
        assert.equal(detailMenu.options[0].label, "⬅️ Volver atrás")
        assert.equal(detailMenu.options[0].description, "Ver todos los drops")

        // Vista detalle de un drop reservado: línea de reserva, botón de
        // abrir a todos y menú para quitar a alguien.
        const reservedRow = { code: "AAA111", drop: { ...rowsOf()[0].drop, allow: [{ id: "u1", name: "Pepe" }, { id: "u2", name: "Ana" }] }, left: 2, expired: false }
        const locked = dropCmd.buildDropDetailContainer([reservedRow, ...rowsOf().filter(r => !r.expired).slice(1)], reservedRow, "https://example.test", "g", tools)
        const lTexts = textsOf(locked)
        assert.ok(lTexts.includes("Reservado:"), "línea de reserva")
        assert.ok(lTexts.includes("<@u1> <@u2>"), "menciones de reservados")
        const lockedJson = locked.toJSON().components.flatMap(c => c.components || [])
        assert.deepEqual(
            lockedJson.filter(c => c.type === 2).map(c => c.custom_id),
            ["drop:del:AAA111", "drop:uses:AAA111", "drop:time:AAA111", "drop:solo:AAA111", "drop:open:AAA111"],
            "abrir a todos solo si hay reservas",
        )
        const quitMenu = lockedJson.find(c => c.custom_id === "drop:quit:AAA111")
        assert.ok(quitMenu, "menú para quitar reservados")
        assert.deepEqual(quitMenu.options.map(o => [o.value, o.label]), [["u1", "Pepe"], ["u2", "Ana"]])
        // Lista: candado por línea en los reservados.
        const lockList = dropCmd.buildDropsListContainer([reservedRow, ...rowsOf().filter(r => !r.expired).slice(1)], "https://example.test", "g", tools)
        assert.ok(textsOf(lockList).includes("AAA111) 🔒 (1/3)"), "candado en la lista")

        // Tope de menú: 26 activos → 25 opciones + aviso.
        const many = Array.from({ length: 26 }, (_, i) => ({
            code: `C${String(i).padStart(5, "0")}`,
            drop: { name: `D${i}`, kind: "xp", amount: 100, maxClaims: 1, claims: [], expiresAt: now + 3600000, createdBy: "s", createdAt: now },
            left: 1, expired: false,
        }))
        const capped = dropCmd.buildDropsListContainer(many, "https://example.test", "g", tools)
        const cappedJson = capped.toJSON().components.flatMap(c => c.components || [])
        assert.equal(cappedJson.find(c => c.custom_id === "dropinspect").options.length, 25)
        assert.ok(textsOf(capped).includes("+1 más"), "aviso del resto")

        // Sin drops: nota y nada más (sin separador suelto ni menú vacío).
        const empty = dropCmd.buildDropsListContainer([], "https://example.test", "g", tools)
        const emptyTexts = textsOf(empty)
        assert.ok(emptyTexts.includes("No hay ningún drop"), "mensaje de vacío")
        assert.ok(emptyTexts.includes("/drops crear"), "dónde crearlo")
        assert.ok(!emptyJsonHasMenu(empty), "sin menú sin opciones")
        function emptyJsonHasMenu(cont) {
            return cont.toJSON().components.flatMap(c => c.components || []).some(c => c.custom_id === "dropinspect")
        }

        // Modo eliminar: cabecera propia y menú de eleminares.
        const delList = dropCmd.buildDropsListContainer(rowsOf().filter(r => !r.expired), "https://example.test", "g", tools, { deleteMode: true })
        const delTexts = textsOf(delList)
        assert.ok(delTexts.includes("## 🗑️ Eliminar un drop"), "cabecera de eliminar")
        const emptyDel = dropCmd.buildDropsListContainer([], "https://example.test", "g", tools, { deleteMode: true })
        assert.ok(textsOf(emptyDel).includes("no queda ninguno activo"), "vacío en modo eliminar")
    })
})

test("asistente de crear: objetos de la tienda se listan y se quitan", () => {
    const dropCmd = require("../commands/slash/drops.js")
    const tools = { commafy: n => String(n) }
    const store = [{ id: "aaa", name: "Pepino dorado", price: 1, emoji: "🥒" }]
    const d = dropCmd.makeDraft("F")
    // Antes de añadir: menú de añadir con el item de la tienda.
    const before = dropCmd.buildPickContainer("item", { tools, boat: true, storeItems: store, draft: d }).toJSON()
    const addMenu = before.components.flatMap(c => c.components || []).find(c => c.custom_id === "wizmk:item")
    assert.ok(addMenu, "menú de añadir objeto")
    assert.equal(addMenu.options[0].value, "aaa")
    assert.ok(addMenu.options[0].label.includes("🥒"), "emoji en el label")
    // Tras añadir: aparece el menú de quitar con la cantidad.
    dropCmd.draftAddItem(d, store[0], 3)
    const after = dropCmd.buildPickContainer("item", { tools, boat: true, storeItems: store, draft: d }).toJSON()
    const rmMenu = after.components.flatMap(c => c.components || []).find(c => c.custom_id === "wizmk:ritem")
    assert.ok(rmMenu, "menú de quitar objeto")
    assert.ok(rmMenu.options[0].label.includes("3× Pepino dorado"))
})

test("rate limit frena la enumeración y deja pasar uso normal", () => {
    const { createDropRateLimiter } = require("../app/celebration-page.js")
    const limit = createDropRateLimiter({ max: 3, windowMs: 60000 })
    const mkReq = ip => ({ headers: { "x-real-ip": ip }, ip })
    const run = ip => new Promise(resolve => {
        let status = 200
        const res = {
            status: code => { status = code; return res },
            set: () => res,
            send: () => resolve(status),
        }
        limit(mkReq(ip), res, () => resolve(status))
    })
    return (async () => {
        assert.equal(await run("1.2.3.4"), 200)
        assert.equal(await run("1.2.3.4"), 200)
        assert.equal(await run("1.2.3.4"), 200)
        assert.equal(await run("1.2.3.4"), 429, "al 4º corta")
        assert.equal(await run("9.9.9.9"), 200, "otra IP no afectada")
    })()
})

test("normalizeAllowedUsers limpia reservas y respeta el tope", () => {
    assert.deepEqual(Drops.normalizeAllowedUsers([
        { id: "123456789012345678", name: "Pepe" },
        { id: "123456789012345678", name: "duplicado" },
        { id: "nope", name: "x" },
        null,
    ]), [{ id: "123456789012345678", name: "Pepe" }])
    assert.deepEqual(Drops.normalizeAllowedUsers("no es lista"), [])
    const many = Array.from({ length: 150 }, (_, i) => ({ id: String(BigInt("100000000000000000") + BigInt(i)), name: `u${i}` }))
    assert.equal(Drops.normalizeAllowedUsers(many).length, Drops.LIMITS.allowedMax, "tope de reservas")
})

test("drops reservados: solo los de la lista pueden reclamar", async () => {
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", {
        amount: 1000, maxClaims: 3, durationMin: 60, name: "Premio", createdBy: "s",
        allowedUsers: [{ id: "10001", name: "Pepe" }, { id: "nope", name: "x" }],
    })
    assert.equal(created.ok, true)
    assert.deepEqual(created.drop.allow, [{ id: "10001", name: "Pepe" }], "reservas limpias")
    assert.deepEqual(Drops.validateClaim(created.drop, "10001"), { ok: true })
    assert.deepEqual(Drops.validateClaim(created.drop, "10002"), { ok: false, reason: "not-allowed" })

    const ok = await Drops.claimDrop(client, "g", created.code, "10001")
    assert.equal(ok.ok, true)
    assert.ok(doc.drops[created.code].claims.includes("10001"))

    // El ajeno no gasta usos ni toca XP.
    const no = await Drops.claimDrop(client, "g", created.code, "10002")
    assert.deepEqual([no.ok, no.reason], [false, "not-allowed"])
    assert.ok(!doc.drops[created.code].claims.includes("10002"))
    assert.equal(doc.users["10002"]?.xp || 0, 0)

    // Quien ya reclamó mantiene su premio aunque luego lo quiten de la lista.
    const again = await Drops.claimDrop(client, "g", created.code, "10001")
    assert.deepEqual([again.ok, again.reason], [false, "already"])

    // Quitar la reserva entera vuelve a hacerlo público y reclamable por ajeno.
    const drop = doc.drops[created.code]
    drop.allow = []
    assert.deepEqual(Drops.validateClaim(drop, "10002"), { ok: true })
})

test("parseAllowedInput extrae menciones e IDs sin duplicados", () => {
    const dropCmd = require("../commands/slash/drops.js")
    assert.deepEqual(dropCmd.parseAllowedInput("<@123456789012345678>, <@234567890123456789>"), ["123456789012345678", "234567890123456789"])
    assert.deepEqual(dropCmd.parseAllowedInput("123456789012345678\n123456789012345678\r\n987654321012345678"), ["123456789012345678", "987654321012345678"])
    assert.deepEqual(dropCmd.parseAllowedInput("puro texto sin ids"), [])
    assert.deepEqual(dropCmd.parseAllowedInput(""), [])
    const many = Array.from({ length: 150 }, (_, i) => String(BigInt("100000000000000000") + BigInt(i)))
    assert.equal(dropCmd.parseAllowedInput(many.join(" ")).length, Drops.LIMITS.allowedMax, "tope al pegar")
})

test("applyReserve añade/quita reservas y sube usos si faltan", async () => {
    const dropCmd = require("../commands/slash/drops.js")
    const doc = { _id: "g", users: {}, drops: {}, settings: {} }
    const client = fakeClient(doc)
    const created = await Drops.createDrop(client, "g", { amount: 1000, maxClaims: 1, durationMin: 60, name: "R", createdBy: "s" })
    const code = created.code

    const r1 = await dropCmd.applyReserve(client, "g", code, [{ id: "10001", name: "Pepe" }, { id: "10002", name: "Ana" }])
    assert.equal(r1.ok, true)
    assert.equal(r1.total, 2)
    assert.equal(r1.bump, 2, "los usos suben para cubrir reservas")
    assert.equal(doc.drops[code].maxClaims, 2)
    assert.deepEqual(doc.drops[code].allow, [{ id: "10001", name: "Pepe" }, { id: "10002", name: "Ana" }])

    // Duplicado: no añade ni duplica; el id nuevo sí (y como ya no hay
    // huecos, vuelve a subir los usos de 2 a 3).
    const r2 = await dropCmd.applyReserve(client, "g", code, [{ id: "10001", name: "Pepe" }, { id: "10003", name: "Nadie" }])
    assert.equal(r2.added, 1)
    assert.equal(r2.bump, 3, "tercera reserva sin hueco: sube usos")
    assert.equal(doc.drops[code].maxClaims, 3)
    assert.deepEqual(doc.drops[code].allow.map(u => u.id), ["10001", "10002", "10003"])

    // Quitar a una persona.
    await dropCmd.applyAllowRemove(client, "g", code, "10001")
    assert.deepEqual(doc.drops[code].allow.map(u => u.id), ["10002", "10003"])

    // Abrir a todos: reserva vacía y de nuevo cualquiera reclama.
    await dropCmd.applyOpenAll(client, "g", code)
    assert.deepEqual(doc.drops[code].allow, [])
    assert.deepEqual(Drops.validateClaim(doc.drops[code], "u9", Date.now()), { ok: true })
})

test("registro del perfil de reservas en el comando y contenedores", () => {
    const dropCmd = require("../commands/slash/drops.js")
    // Constantes del nuevo asistente
    assert.deepEqual([dropCmd.MK.MENU, dropCmd.MK.CREATE, dropCmd.MK.CANCEL], ["wizmk:reward", "wizmk:create", "wizmk:cancel"])
    // Modal de nombre
    const nameModalJson = dropCmd.buildMakeNameModal().toJSON()
    assert.equal(nameModalJson.custom_id, "dropw:name")
    assert.ok(nameModalJson.title.includes("Nombre"))
    const input = nameModalJson.components[0].components[0]
    assert.equal(input.custom_id, "value")
    assert.equal(input.required, true)
    // Mensaje de creación: público lleva el enlace; con privados sale la lista.
    const base = { name: "Fiesta", kind: "bundle", prizes: { xp: 1000, coins: 0, roles: [], items: [] }, maxClaims: 5, claims: [], expiresAt: Date.now() + 3600000, createdBy: "s", createdAt: Date.now() }
    const mkTools = { commafy: n => String(n), getLevel: () => 3 }
    const publicC = dropCmd.buildCreatedContainer(base, "BBB123", "https://example.test/drop/g/BBB123", mkTools, null)
    // En el mensaje final del drop creado sale el enlace, no menús de reserva
    assert.ok(JSON.stringify(publicC.toJSON()).includes("https://example.test/drop/g/BBB123"), "enlace en mensaje final")
    // Con reservas: el mensaje final también muestra el enlace y la lista de privados
    const locked = dropCmd.buildCreatedContainer({ ...base, allow: [{ id: "u1", name: "Pepe" }] }, "BBB123", "https://example.test/drop/g/BBB123", mkTools, [{ id: "u1", name: "Pepe" }])
    assert.ok(JSON.stringify(locked.toJSON()).includes("https://example.test/drop/g/BBB123"), "enlace en mensaje final con privados")
    assert.ok(JSON.stringify(locked.toJSON()).includes("Pepe"), "nombre de privado en mensaje final")
})
