const { test } = require("node:test")
const assert = require("node:assert/strict")

const fs = require("fs")
const { MessageFlags } = require("discord.js")
const roger = require("../commands/slash/roger.js")

// El vídeo lo sube el owner a assets/roger/anakin.mp4 (no va al repo):
// los tests cubren la rama que toque según exista o no.
const hasVideo = () => {
    try { return fs.existsSync(roger.videoPath) } catch { return false }
}

function fakeInt() {
    const sent = []
    return {
        sent,
        reply: async (payload) => { sent.push(payload); return {} },
    }
}

test("command metadata is valid", () => {
    assert.equal(roger.metadata.name, "roger")
    assert.ok(roger.metadata.description.length > 0)
    assert.equal(typeof roger.run, "function")
})

test("roger replies ephemeral in Components V2", async () => {
    const int = fakeInt()
    await roger.run(null, int, null)
    assert.equal(int.sent.length, 1)
    const payload = int.sent[0]
    assert.ok(payload.flags & MessageFlags.IsComponentsV2, "V2")
    assert.ok(payload.flags & MessageFlags.Ephemeral, "efímero")
    assert.equal(payload.components.length, 1)
    const [container] = payload.components.map(c => c.toJSON())
    const kinds = container.components.map(c => c.type)
    // homenaje, separador, descubrimiento, separador, [galería, separador si hay vídeo], pista final.
    assert.deepEqual(kinds, hasVideo() ? [10, 14, 10, 14, 12, 14, 10] : [10, 14, 10, 14, 10])
    const json = JSON.stringify(container)
    assert.ok(json.includes("Has descubierto un comando oculto"), "encabezado del descubrimiento")
    assert.ok(json.includes("Roger that"), "homenaje")
    assert.ok(json.includes("Señas"), "explica el comando oculto")
    assert.ok(json.includes("Usa el comando"), "pista final")
    assert.ok(json.includes("`/records`"), "pista con fallback sin tools")
})

test("roger attaches the video only when the file exists", async () => {
    const int = fakeInt()
    await roger.run(null, int, null)
    assert.equal(int.sent[0].files.length, hasVideo() ? 1 : 0)
    if (hasVideo()) {
        const json = JSON.stringify(int.sent[0].components.map(c => c.toJSON()))
        assert.ok(json.includes("attachment://anakin.mp4"), "galería al vídeo")
    }
})

test("roger exposes where the video goes", () => {
    assert.ok(String(roger.videoPath).endsWith("anakin.mp4"))
    assert.equal(roger.videoMaxBytes, 10 * 1024 * 1024)
})
