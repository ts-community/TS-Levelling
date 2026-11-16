const { test } = require("node:test")
const assert = require("node:assert/strict")
const { PermissionsBitField, PermissionFlagsBits } = require("discord.js")
const command = require("../commands/slash/gestion.js")
const { getTenureTimestamp, parseTenureDate } = require("../classes/Tenure.js")
const records = require("../commands/slash/records.js")
const catalog = require("../config/records.js")

test("tenure dates reject impossible, future and ambiguous dates", () => {
    const now = Date.UTC(2026, 10, 16)
    for (const value of [undefined, "15/06/2020", "2025-02-29", "2020-02-31", "2027-01-01", "2020-13-01"]) {
        assert.equal(parseTenureDate(value, now), null, String(value))
    }
    assert.equal(parseTenureDate("2024-02-29", now), Date.UTC(2024, 1, 29))
})

test("records progress uses the stored correction and falls back to Discord", () => {
    const since = Date.now() - 4 * 365.25 * 86400000
    const member = { joinedTimestamp: Date.now() - 86400000 }
    assert.equal(getTenureTimestamp({ tenureSince: since }, member), since)
    assert.equal(getTenureTimestamp({ tenureSince: "invalid" }, member), member.joinedTimestamp)
    assert.equal(getTenureTimestamp({}, null), null)
    const tenure = catalog.allRecords().find(({ record }) => record.id === "tenure").record
    const progress = records.getProgress(tenure, { tenureSince: since }, member, String)
    assert.ok(progress.completed > records.getProgress(tenure, {}, member, String).completed)
})

function fixture(action, date, allowed = true) {
    const writes = [], replies = [], warnings = []
    const member = { id: "123", user: { id: "123", bot: false }, joinedTimestamp: Date.UTC(2025, 0, 1) }
    const values = { accion: { value: action }, fecha: date && { value: date }, miembro: { user: member.user } }
    const int = {
        guild: { id: "456", members: { fetch: async () => member } }, member: {},
        memberPermissions: new PermissionsBitField(allowed ? PermissionFlagsBits.Administrator : PermissionFlagsBits.ManageGuild),
        options: { get: key => values[key] },
        deferReply: async payload => replies.push(payload),
        editReply: async payload => replies.push(payload),
    }
    const client = { db: { update: (guildId, update) => ({ exec: async () => writes.push({ guildId, update }) }) } }
    const tools = {
        canManageServer: () => allowed, warn: async text => warnings.push(text),
        fetchSettings: async () => ({ users: { "123": { tenureSince: Date.UTC(2020, 0, 1), xp: 1234 } } }),
    }
    return { client, int, tools, writes, replies, warnings }
}

test("management requires permission and a valid date before writing", async () => {
    for (const f of [fixture("fijar", "2020-01-01", false), fixture("fijar", "2025-02-30")]) {
        await command.run(f.client, f.int, f.tools)
        assert.equal(f.writes.length, 0)
        assert.equal(f.replies.length, 0)
        assert.equal(f.warnings.length, 1)
    }
})

test("management is restricted to administrators even with manually allowed server management", async () => {
    assert.equal(command.metadata.permission, "Administrator")
    for (const action of ["consultar", "fijar", "restaurar"]) {
        const f = fixture(action, action === "fijar" ? "2020-01-01" : undefined, false)
        f.tools.canManageServer = () => true
        await command.run(f.client, f.int, f.tools)
        assert.equal(f.writes.length, 0)
        assert.equal(f.replies.length, 0)
        assert.match(f.warnings[0], /Administrador/)
    }
})

test("management sets only the correction, restores it and supports read-only consultation", async () => {
    for (const action of ["fijar", "restaurar", "consultar"]) {
        const f = fixture(action, action === "fijar" ? "2020-06-15" : undefined)
        await command.run(f.client, f.int, f.tools)
        assert.equal(f.warnings.length, 0)
        assert.ok(f.replies[0].flags & 64, "private response")
        if (action === "consultar") assert.equal(f.writes.length, 0)
        else assert.deepEqual(f.writes, [{ guildId: "456", update: action === "fijar"
            ? { $set: { "users.123.tenureSince": Date.UTC(2020, 5, 15) } }
            : { $unset: { "users.123.tenureSince": "" } } }])
    }
})

test("management reports persistence failures without confirming success", async () => {
    const f = fixture("fijar", "2020-06-15")
    f.client.db.update = () => ({ exec: async () => { throw new Error("write failed") } })
    await command.run(f.client, f.int, f.tools)
    assert.match(f.replies.at(-1).content, /No se pudo/)
})
