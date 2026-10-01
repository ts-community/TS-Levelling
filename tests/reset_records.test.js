const { test } = require("node:test")
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const path = require("node:path")

const script = path.join(__dirname, "..", "scripts", "reset-records.js")

function runCli(...args) {
    return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 30000 })
}

test("--help documents single-user reset", () => {
    const r = runCli("--help")
    assert.equal(r.status, 0)
    assert.ok(r.stdout.includes("--user <id>"), "ayuda menciona --user")
    assert.ok(r.stdout.includes("--guild <id>"), "ayuda menciona --guild")
})

test("--user works without --guild (all servers scanned)", () => {
    // Antes pedía --guild o salía con error; ahora entra en ayuda sin quejarse.
    const r = runCli("--user", "123456789012345678", "--help")
    assert.equal(r.status, 0, `salida: ${r.stderr}`)
    assert.ok(!r.stderr.includes("requiere --guild"))
})

test("--guild + --user still parses", () => {
    const r = runCli("--guild", "111", "--user", "222", "--help")
    assert.equal(r.status, 0, `salida: ${r.stderr}`)
})
