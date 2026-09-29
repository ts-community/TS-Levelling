const { test } = require("node:test")
const assert = require("node:assert/strict")

const top = require("../commands/slash/top.js")

const users = {
    u1: { xp: 5000, messages: 100, monthlyMessages: 10, monthlyXP: 500, dailyMessages: 40, reactionsSent: 5, reactionsReceived: 50, streak: { current: 3, max: 7 }, channels: { a: 1, b: 1 }, countingSent: 9, pokemonCaught: 12, voiceMinutes: 120, records: { "messages:10": true, "messages:100": true } },
    u2: { xp: 9000, messages: 20, monthlyMessages: 0, monthlyXP: 0, dailyMessages: 0, reactionsSent: 60, reactionsReceived: 1, streak: 12, channels: 1, countingSent: 0, pokemonCaught: 0, voiceMinutes: 3000, records: {} },
    u3: { xp: 100, messages: 5, monthlyMessages: 5, monthlyXP: 100, dailyMessages: 90, reactionsSent: 0, reactionsReceived: 0, streak: { current: 0, max: 0 }, channels: [], countingSent: 44, pokemonCaught: 30, voiceMinutes: 0, records: { "night_owl:1": true } },
}

function rank(key) {
    const mode = top.STAT_MODES[key]
    return Object.entries(users)
        .map(([id, u]) => ({ id, v: mode.get(u) }))
        .filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v || users[b.id].xp - users[a.id].xp)
        .map(x => x.id)
}

test("stat modes rank each stat, zero values excluded", () => {
    assert.deepEqual(rank("mensajes"), ["u1", "u2", "u3"])
    assert.deepEqual(rank("mensajes_mes"), ["u1", "u3"])
    assert.deepEqual(rank("mensajes_dia"), ["u3", "u1"])
    assert.deepEqual(rank("reacciones_enviadas"), ["u2", "u1"])
    assert.deepEqual(rank("reacciones_recibidas"), ["u1", "u2"])
    assert.deepEqual(rank("racha"), ["u2", "u1"])
    assert.deepEqual(rank("racha_max"), ["u2", "u1"])
    assert.deepEqual(rank("counting"), ["u3", "u1"])
    assert.deepEqual(rank("pokemon"), ["u3", "u1"])
    assert.deepEqual(rank("voz"), ["u2", "u1"])
})

test("stat extractors handle every stored shape", () => {
    const { STAT_MODES: m } = top
    assert.equal(m.racha.get({ streak: { current: 4 } }), 4)
    assert.equal(m.racha.get({ streak: 4 }), 4)
    assert.equal(m.racha_max.get({ streak: { current: 4, max: 9 } }), 9)
    assert.equal(m.racha_max.get({}), 0)
})

test("stat modes mirror the stats page order, no Records", () => {
    // Espejo de las stats en orden, sin Records (ya no es una stat visible).
    assert.deepEqual(Object.keys(top.STAT_MODES), ["mensajes", "mensajes_mes", "mensajes_dia", "reacciones_enviadas", "reacciones_recibidas", "racha", "racha_max", "counting", "pokemon", "voz"])
})

test("top command exposes explicit direct view choices", () => {
    const args = top.metadata.args
    const view = args.find(arg => arg.name === "view")
    assert.deepEqual(view?.choices.map(choice => choice.value), [
        "xp", "monthly", "daily", "mensajes", "mensajes_mes", "mensajes_dia", "reacciones_enviadas",
        "reacciones_recibidas", "racha", "racha_max", "counting", "pokemon", "voz",
    ])
    assert.equal(args.some(arg => arg.name === "monthly"), false)
})

test("view menu is a single fixed menu with every view", () => {
    const all = [
        "xp", "xp_mes", "xp_dia", "mensajes", "mensajes_mes", "mensajes_dia",
        "reacciones_enviadas", "reacciones_recibidas", "racha", "racha_max",
        "counting", "pokemon", "voz",
    ]
    const xpMenu = top.buildViewMenu("xp", false).toJSON()
    assert.equal(xpMenu.custom_id, "top-view")
    assert.deepEqual(xpMenu.options.map(o => o.value), all)
    assert.equal(xpMenu.options.filter(o => o.default).length, 1)
    assert.equal(xpMenu.options.find(o => o.default).value, "xp")

    // El mismo menú estés en la vista que estés: solo cambia el default.
    for (const view of ["mensajes", "mensajes_dia", "racha", "pokemon", "voz"]) {
        const menu = top.buildViewMenu(view, false).toJSON()
        assert.deepEqual(menu.options.map(o => o.value), all, `menú distinto en ${view}`)
        assert.equal(menu.options.filter(o => o.default).length, 1)
        assert.equal(menu.options.find(o => o.default).value, view)
    }

    const voiceMenu = top.buildViewMenu("voz", true).toJSON()
    assert.deepEqual(voiceMenu.options.map(o => o.value), all)
    assert.equal(voiceMenu.disabled, true)

    const off = top.buildViewMenu("xp", true).toJSON()
    assert.equal(off.disabled, true, "se desactiva al caducar")
})

test("stat lines fit on mobile", () => {
    const { STAT_MODES: m, statLineVariants, estimateVisualWidth } = top
    const big = { mensajes: 110894, mensajes_mes: 99999, mensajes_dia: 8888, reacciones_enviadas: 9999, reacciones_recibidas: 9999, racha: 99, racha_max: 99, counting: 9999, pokemon: 999, voz: 60000, records: 39 }
    for (const [key, mode] of Object.entries(m)) {
        const value = String(big[key]).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
        const shortest = statLineVariants(mode.emoji, value, mode.unit, mode.abbr).slice(-1)[0]
        assert.ok(estimateVisualWidth(shortest) <= 37.9, `${key} ni la corta cabe: ${shortest}`)
        assert.ok(mode.label && mode.title && mode.menuEmoji, `${key} sin textos de menú`)
    }
    assert.equal(Object.keys(m).length, 10, "un modo por stat visible (sin Records, sin XP/antigüedad)")
})

test("stat entry lines put the number first and markers last", () => {
    const base = { emoji: "💘", position: 1, mention: "<@1>", viewKey: "reacciones_recibidas", commafied: "120", value: 120 }
    assert.equal(
        top.buildStatEntryLine({ ...base, shownName: "Dave", endMarkers: "" }),
        "💘 **#1 - 120 reacciones recibidas** - <@1>",
    )
    assert.equal(
        top.buildStatEntryLine({ ...base, shownName: "Dave", endMarkers: "  <:member:x> **Tú**" }),
        "💘 **#1 - 120 reacciones recibidas** - <@1>  <:member:x> **Tú**",
    )
    assert.equal(
        top.buildStatEntryLine({ ...base, shownName: "Dave", endMarkers: "  <:no_en_el_server:y>" }),
        "💘 **#1 - 120 reacciones recibidas** - <@1>  <:no_en_el_server:y>",
    )
    // Nombre largo: unidad compacta para que quepa.
    assert.equal(
        top.buildStatEntryLine({ ...base, shownName: "Averylongusernamethatkeepsgoing", endMarkers: "" }),
        "💘 **#1 - 120 reacciones** - <@1>",
    )
    // Singular en ambas variantes.
    assert.equal(
        top.buildStatEntryLine({ ...base, commafied: "1", value: 1, shownName: "Dave", endMarkers: "" }),
        "💘 **#1 - 1 reacción recibida** - <@1>",
    )
    assert.equal(
        top.buildStatEntryLine({ ...base, commafied: "1", value: 1, shownName: "Averylongusernamethatkeepsgoing", endMarkers: "" }),
        "💘 **#1 - 1 reacción** - <@1>",
    )
})

test("stat entry lines show voice as hours and minutes", () => {
    assert.equal(top.topVoiceText(0), "0 minutos")
    assert.equal(top.topVoiceText(45), "45 minutos")
    assert.equal(top.topVoiceText(60), "1 hora")
    assert.equal(top.topVoiceText(125), "2 horas y 5 minutos")
    assert.equal(top.topVoiceText(120), "2 horas")
    assert.equal(top.topVoiceText(1), "1 minuto")
    const line = top.buildStatEntryLine({ emoji: "🎙️", position: 2, mention: "<@2>", shownName: "Dave", endMarkers: "", viewKey: "voz", commafied: "125", value: 125 })
    assert.equal(line, "🎙️ **#2 - 2 horas y 5 minutos** - <@2>")
})

test("daily variants fit on mobile", () => {
    const { dailyMessageVariants, estimateVisualWidth, fitMonthlyLine } = top
    const lines = dailyMessageVariants("1.184", "115.080")
    assert.ok(lines[0].includes("mensajes hoy") && lines[0].includes("XP hoy"))
    assert.ok(estimateVisualWidth(fitMonthlyLine(...lines)) <= 36.9)
    const single = dailyMessageVariants("1", "5")
    assert.ok(single[0].includes("**1** mensaje hoy"))
})
