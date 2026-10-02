const { test } = require("node:test")
const assert = require("node:assert/strict")

const top = require("../commands/slash/top.js")

const users = {
    u1: { xp: 5000, messages: 100, monthlyMessages: 10, monthlyMessagesMax: 120, monthlyXP: 500, dailyMessages: 40, dailyMessagesMax: 80, reactionsSent: 5, reactionsReceived: 50, streak: { current: 3, max: 7 }, channels: { a: 1, b: 1 }, countingSent: 9, pokemonCaught: 12, voiceMinutes: 120, records: { "messages:10": true, "messages:100": true } },
    u2: { xp: 9000, messages: 20, monthlyMessages: 0, monthlyXP: 0, dailyMessages: 0, reactionsSent: 60, reactionsReceived: 1, streak: 12, channels: 1, countingSent: 0, pokemonCaught: 0, voiceMinutes: 3000, records: {} },
    u3: { xp: 100, messages: 5, monthlyMessages: 5, monthlyMessagesMax: 50, monthlyXP: 100, dailyMessages: 90, dailyMessagesMax: 100, reactionsSent: 0, reactionsReceived: 0, streak: { current: 0, max: 0 }, channels: [], countingSent: 44, pokemonCaught: 30, voiceMinutes: 0, records: { "night_owl:1": true } },
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
    assert.deepEqual(Object.keys(top.STAT_MODES), ["mensajes", "mensajes_mes", "mensajes_dia", "mensajes_mes_max", "mensajes_dia_max", "racha", "racha_max", "antiguedad", "reacciones_recibidas", "reacciones_enviadas", "pokemon", "counting", "voz"])
})

test("top command exposes explicit direct view choices", () => {
    const args = top.metadata.args
    const view = args.find(arg => arg.name === "view")
    assert.deepEqual(view?.choices.map(choice => choice.value), [
        "xp", "xp_mes", "xp_dia", "mensajes", "mensajes_mes", "mensajes_dia",
        "mensajes_mes_max", "mensajes_dia_max",
        "racha", "racha_max", "antiguedad", "reacciones_recibidas", "reacciones_enviadas", "pokemon", "counting", "voz",
    ])
    assert.equal(args.some(arg => arg.name === "monthly"), false)
})

test("view menu groups metrics and offers a way back", () => {
    const xpMenu = top.buildViewMenu("xp", false, null, null).toJSON()
    assert.equal(xpMenu.custom_id, "top-view")
    assert.deepEqual(xpMenu.options.map(o => o.value), ["grupo_xp", "grupo_actividad", "grupo_comunidad", "grupo_canales", "grupo_voz"])
    assert.equal(xpMenu.options.filter(o => o.default).length, 0)

    const messagesMenu = top.buildViewMenu("mensajes", false, "grupo_actividad", null).toJSON()
    assert.deepEqual(messagesMenu.options.map(o => o.value), [
        "top-groups", "mensajes", "mensajes_mes", "mensajes_dia", "mensajes_mes_max", "mensajes_dia_max",
    ])
    assert.equal(messagesMenu.options.filter(o => o.default).length, 0)
    assert.equal(messagesMenu.options[0].label, "Volver atrás")

    const communityMenu = top.buildViewMenu("antiguedad", false, "grupo_comunidad", null).toJSON()
    assert.deepEqual(communityMenu.options.map(o => o.value), [
        "top-groups", "antiguedad", "racha", "racha_max", "reacciones_recibidas", "reacciones_enviadas",
    ])
    const directAgeMenu = top.buildViewMenu("antiguedad", false, "grupo_comunidad", "antiguedad").toJSON()
    assert.equal(directAgeMenu.options.find(o => o.default)?.value, "antiguedad")

    const voiceMenu = top.buildViewMenu("voz", true, "grupo_voz", null).toJSON()
    assert.deepEqual(voiceMenu.options.map(o => o.value), ["top-groups", "voz"])
    assert.equal(voiceMenu.options.filter(o => o.default).length, 0)
    assert.equal(voiceMenu.disabled, true)

    const off = top.buildViewMenu("xp", true).toJSON()
    assert.equal(off.disabled, true, "se desactiva al caducar")
})

test("stat lines fit on mobile", () => {
    const { STAT_MODES: m, statLineVariants, estimateVisualWidth } = top
    const big = { mensajes: 110894, mensajes_mes: 99999, mensajes_dia: 8888, mensajes_mes_max: 99999, mensajes_dia_max: 8888, reacciones_enviadas: 9999, reacciones_recibidas: 9999, racha: 99, racha_max: 99, antiguedad: 10, counting: 9999, pokemon: 999, voz: 60000, records: 39 }
    for (const [key, mode] of Object.entries(m)) {
        const value = String(big[key]).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
        const shortest = statLineVariants(mode.emoji, value, mode.unit, mode.abbr).slice(-1)[0]
        assert.ok(estimateVisualWidth(shortest) <= 37.9, `${key} ni la corta cabe: ${shortest}`)
        assert.ok(mode.label && mode.title && mode.menuEmoji, `${key} sin textos de menú`)
    }
    assert.equal(Object.keys(m).length, 13, "un modo por stat visible (sin Records, sin XP)")
})

test("stat entry lines put the number first and markers last", () => {
    const base = { emoji: "💘", position: 1, mention: "<@1>", viewKey: "reacciones_recibidas", commafied: "120", value: 120 }
    assert.equal(
        top.buildStatEntryLine({ ...base, shownName: "Dave", endMarkers: "" }),
        "💘 **#1 - 120 reacciones recibidas** - <@1>",
    )
    // Con marca la línea es más larga y encoge antes (la sonda cuenta @nombre + marcas).
    // IDs numéricos como en producción (con :x/:y el marcador mediría como texto).
    assert.equal(
        top.buildStatEntryLine({ ...base, shownName: "Dave", endMarkers: "  <:member:123456789012345678> **Tú**" }),
        "💘 **#1 - 120 recibidas** - <@1>  <:member:123456789012345678> **Tú**",
    )
    assert.equal(
        top.buildStatEntryLine({ ...base, shownName: "Dave", endMarkers: "  <:no_en_el_server:123456789012345678>" }),
        "💘 **#1 - 120 reacciones recibidas** - <@1>  <:no_en_el_server:123456789012345678>",
    )
    // Nombre largo: unidad compacta para que quepa.
    assert.equal(
        top.buildStatEntryLine({ ...base, shownName: "Averylongusernamethatkeepsgoing", endMarkers: "" }),
        "💘 **#1 - 120** - <@1>",
    )
    // Singular en ambas variantes.
    assert.equal(
        top.buildStatEntryLine({ ...base, commafied: "1", value: 1, shownName: "Dave", endMarkers: "" }),
        "💘 **#1 - 1 reacción recibida** - <@1>",
    )
    assert.equal(
        top.buildStatEntryLine({ ...base, commafied: "1", value: 1, shownName: "Averylongusernamethatkeepsgoing", endMarkers: "" }),
        "💘 **#1 - 1** - <@1>",
    )
})

test("stat entry lines show voice as hours and minutes", () => {
    assert.equal(top.topVoiceText(0), "0 minutos")
    assert.equal(top.topVoiceText(45), "45 minutos")
    assert.equal(top.topVoiceText(60), "1 hora")
    assert.equal(top.topVoiceText(125), "2 horas y 5 minutos")
    assert.equal(top.topVoiceText(120), "2 horas")
    assert.equal(top.topVoiceText(1), "1 minuto")
    assert.equal(top.topVoiceTextCompact(125), "2h 5m")
    const line = top.buildStatEntryLine({ emoji: "🎙️", position: 2, mention: "<@2>", shownName: "Dave", endMarkers: "", viewKey: "voz", commafied: "125", value: 125 })
    assert.equal(line, "🎙️ **#2 - 2 horas y 5 minutos** - <@2>")
})

test("tenure top shows exact years, months and days", () => {
    const now = new Date(2026, 9, 1)
    const joined = new Date(2025, 5, 15)
    assert.equal(top.topTenureText(joined, now), "1 año, 3 meses y 16 días")
    assert.equal(top.topTenureTextShort(joined, now), "1 a, 3 m y 16 d")
    assert.equal(top.topTenureText(new Date(2025, 9, 30), now), "11 meses y 1 día")
    assert.deepEqual(top.topTenureVariants(joined, now).slice(0, 3), [
        "1 año, 3 meses y 16 días", "1 año, 3 meses y 16 d", "1 año, 3 m y 16 d",
    ])
    assert.equal(top.buildStatEntryLine({
        emoji: "🏅", position: 1, mention: "<@1>", shownName: "Nombre muy largo del miembro",
        endMarkers: "", viewKey: "antiguedad", commafied: "123456", value: 123456,
        displayValue: "1 año, 3 meses y 16 días", displayValueShort: "1 a, 3 m y 16 d",
    }), "🏅 **#1 - 1 a, 3 m y 16 d** - <@1>")
})

test("stat entry lines shrink before wrapping on mobile", () => {
    // Nombres medios-largos que antes saltaban: ahora usan la unidad corta
    // (que conserva recibidas/enviadas para no confundirlas).
    assert.equal(
        top.buildStatEntryLine({ emoji: "💘", position: 1, mention: "<@1>", shownName: "Carlos Ruiz", endMarkers: "", viewKey: "reacciones_recibidas", commafied: "1.234", value: 1234 }),
        "💘 **#1 - 1.234 recibidas** - <@1>",
    )
    assert.equal(
        top.buildStatEntryLine({ emoji: "🔥", position: 5, mention: "<@5>", shownName: "Sofía Martínez García", endMarkers: "", viewKey: "racha", commafied: "30", value: 30 }),
        "🔥 **#5 - 30 días** - <@5>",
    )
    // Mensajes totales también encoge (antes no tenía forma corta).
    assert.equal(
        top.buildStatEntryLine({ emoji: "<:messages:1467163578699354235>", position: 3, mention: "<@3>", shownName: "Lucía Fernández", endMarkers: "", viewKey: "mensajes", commafied: "109.936", value: 109936 }),
        "<:messages:1467163578699354235> **#3 - 109.936 msjs** - <@3>",
    )
    assert.equal(
        top.buildStatEntryLine({ emoji: "<:messages:1467163578699354235>", position: 1, mention: "<@1>", shownName: "Ana", endMarkers: "", viewKey: "mensajes", commafied: "9", value: 9 }),
        "<:messages:1467163578699354235> **#1 - 9 mensajes** - <@1>",
    )
    // Voz encoge a formato corto con nombres largos.
    assert.equal(top.topVoiceTextShort(0), "0 min")
    assert.equal(top.topVoiceTextShort(45), "45 min")
    assert.equal(top.topVoiceTextShort(60), "1 h")
    assert.equal(top.topVoiceTextShort(125), "2 h y 5 min")
    assert.equal(
        top.buildStatEntryLine({ emoji: "🎙️", position: 2, mention: "<@2>", shownName: "Hablador Total", endMarkers: "", viewKey: "voz", commafied: "125", value: 125 }),
        "🎙️ **#2 - 2 h y 5 min** - <@2>",
    )
    assert.equal(
        top.buildStatEntryLine({ emoji: "🎙️", position: 1, mention: "<@1>", shownName: "Ana", endMarkers: "", viewKey: "voz", commafied: "45", value: 45 }),
        "🎙️ **#1 - 45 minutos** - <@1>",
    )
})

test("stat entry lines keep monthly/daily markers when shrinking", () => {
    // Máximos: la cascada conserva siempre mes/día (nunca "mensajes máx."
    // ambiguo ni salto directo al número).
    assert.equal(
        top.buildStatEntryLine({ emoji: "🏆", position: 1, mention: "<@1>", shownName: "Ana", endMarkers: "", viewKey: "mensajes_mes_max", commafied: "9", value: 9 }),
        "🏆 **#1 - 9 mensajes máx. en un mes** - <@1>",
    )
    assert.equal(
        top.buildStatEntryLine({ emoji: "🏆", position: 1, mention: "<@1>", shownName: "Lucía Fernández", endMarkers: "", viewKey: "mensajes_mes_max", commafied: "1.234", value: 1234 }),
        "🏆 **#1 - 1.234 máx. mes** - <@1>",
    )
    assert.equal(
        top.buildStatEntryLine({ emoji: "🏆", position: 1, mention: "<@1>", shownName: "Lucía Fernández", endMarkers: "", viewKey: "mensajes_dia_max", commafied: "1.234", value: 1234 }),
        "🏆 **#1 - 1.234 máx. día** - <@1>",
    )
    // Mensajes del mes/día: también conservan el marcador temporal.
    assert.equal(
        top.buildStatEntryLine({ emoji: "📅", position: 1, mention: "<@1>", shownName: "Sofía Martínez García", endMarkers: "", viewKey: "mensajes_mes", commafied: "1.234", value: 1234 }),
        "📅 **#1 - 1.234 mes** - <@1>",
    )
    assert.equal(
        top.buildStatEntryLine({ emoji: "☀️", position: 1, mention: "<@1>", shownName: "Sofía Martínez García", endMarkers: "", viewKey: "mensajes_dia", commafied: "1.234", value: 1234 }),
        "☀️ **#1 - 1.234 hoy** - <@1>",
    )
    // Racha máxima conserva "máx." para no confundirse con la actual.
    assert.equal(
        top.buildStatEntryLine({ emoji: "🏆", position: 1, mention: "<@1>", shownName: "Sofía Martínez García", endMarkers: "", viewKey: "racha_max", commafied: "30", value: 30 }),
        "🏆 **#1 - 30 máx.** - <@1>",
    )
    // Última palabra antes del número pelado: "reaccs" con nombres largos.
    assert.equal(
        top.buildStatEntryLine({ emoji: "❤️", position: 1, mention: "<@1>", shownName: "Martín García López", endMarkers: "", viewKey: "reacciones_enviadas", commafied: "1.234", value: 1234 }),
        "❤️ **#1 - 1.234 reaccs** - <@1>",
    )
    // Máximos con marca Tú: "día"/"mes" antes que el número pelado.
    assert.equal(
        top.buildStatEntryLine({ emoji: "🏆", position: 1, mention: "<@1>", shownName: "TS | tumonulo", endMarkers: "  <:member:123456789012345678> **Tú**", viewKey: "mensajes_dia_max", commafied: "186", value: 186 }),
        "🏆 **#1 - 186 día** - <@1>  <:member:123456789012345678> **Tú**",
    )
    assert.equal(
        top.buildStatEntryLine({ emoji: "🏆", position: 1, mention: "<@1>", shownName: "TS | tumonulo", endMarkers: "  <:member:123456789012345678> **Tú**", viewKey: "mensajes_mes_max", commafied: "186", value: 186 }),
        "🏆 **#1 - 186 mes** - <@1>  <:member:123456789012345678> **Tú**",
    )
    // El selector de variación (U+FE0F) no mide: ❤️ es un solo glifo.
    assert.equal(top.estimateVisualWidth("❤️"), 1)
})

test("marked lines shrink earlier so they do not wrap on mobile", () => {
    const marker = "  <:member:123456789012345678> **Tú**"
    // Caso real: nombre medio + Tú con texto completo saltaba de línea.
    assert.equal(
        top.buildStatEntryLine({ emoji: "💥", position: 2, mention: "<@123>", shownName: "TS | tumonulo", endMarkers: marker, viewKey: "pokemon", commafied: "3", value: 3 }),
        "💥 **#2 - 3 pokes** - <@123>  <:member:123456789012345678> **Tú**",
    )
    // Sin marca no se encoge de más.
    assert.equal(
        top.buildStatEntryLine({ emoji: "💥", position: 2, mention: "<@123>", shownName: "TS | tumonulo", endMarkers: "", viewKey: "pokemon", commafied: "3", value: 3 }),
        "💥 **#2 - 3 pokemons** - <@123>",
    )
})

test("daily variants fit on mobile", () => {
    const { dailyMessageVariants, estimateVisualWidth, fitMonthlyLine } = top
    const lines = dailyMessageVariants("1.184", "115.080")
    assert.ok(lines[0].includes("mensajes hoy") && lines[0].includes("XP hoy"))
    assert.ok(estimateVisualWidth(fitMonthlyLine(...lines)) <= 36.9)
    const single = dailyMessageVariants("1", "5")
    assert.ok(single[0].includes("**1** mensaje hoy"))
})
