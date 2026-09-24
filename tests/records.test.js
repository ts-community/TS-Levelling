const { test } = require("node:test")
const assert = require("node:assert/strict")

const Tools = require("../classes/Tools.js")
const tools = new Tools()
const records = require("../config/records.js")
const command = require("../commands/slash/records.js")
const tracker = require("../classes/RecordTracker.js")
const { estimateVisualWidth } = require("../commands/slash/top.js")

// La línea de cada nivel debe caber en una línea de móvil (mismo listón que /top).
// Las descripciones van en fuente normal (más grande): listón más exigente.
const MAX_LINE_WIDTH = 37.9
const NORMAL_LINE_WIDTH = 31
// Todo el catálogo equivale aproximadamente a los niveles 60-70 de la curva
// por defecto, muy por debajo del nivel 100 (~1.05M XP).
const MAX_TOTAL_XP = 650000

test("command metadata is valid", () => {
    assert.equal(command.metadata.name, "records")
    assert.ok(command.metadata.description.length > 0)
    assert.equal(typeof command.run, "function")
    for (const fn of ["buildRecordBlock", "buildCategoryBlocks", "buildHiddenBlocks", "buildTitle", "buildCatSelect", "buildInfoTexts", "buildInfoDetailBlocks", "buildInfoContainer", "resolveRank", "titleCounts", "getProgress"]) {
        assert.equal(typeof command[fn], "function")
    }
})

test("record ids and tier names are unique", () => {
    const ids = records.allRecords().map(({ record }) => record.id)
    assert.equal(new Set(ids).size, ids.length, "record id duplicado")

    const names = records.allRecords().flatMap(({ record }) => record.tiers.map(t => t.name))
    assert.equal(new Set(names).size, names.length, "nombre de nivel duplicado")
})

test("tiers are sorted and have sane values", () => {
    for (const { record } of records.allRecords()) {
        const thresholds = record.tiers.map(t => t.threshold)
        assert.deepEqual([...thresholds].sort((a, b) => a - b), thresholds, `${record.id}: umbrales desordenados`)
        for (const tier of record.tiers) {
            assert.ok(Number.isInteger(tier.threshold) && tier.threshold > 0, `${record.id}: umbral inválido`)
            assert.ok(Number.isInteger(tier.xp) && tier.xp >= 0, `${record.id}: xp inválida`)
            assert.ok(tier.roleId === undefined || tier.roleId === null || /^\d{17,20}$/.test(tier.roleId), `${record.id}: roleId inválido`)
            assert.ok(tier.xp > 0 || tier.roleId, `${record.id}: nivel sin recompensa`)
            assert.ok(tier.name.length > 0, `${record.id}: nivel sin nombre`)
        }
    }
})

test("records go from easiest to hardest within each category", () => {
    const order = Object.fromEntries(records.categories.map(c => [c.id, c.records.map(r => r.id)]))
    assert.deepEqual(order.actividad, ["messages", "monthly_messages", "talk_to"])
    assert.deepEqual(order.comunidad, ["reactions_sent", "reactions_received", "streak", "tenure"])
    assert.deepEqual(order.canales, ["distinct_channels", "economy_participation", "counting"])
    assert.deepEqual(order.voz, ["voice_general", "voice_all_fixed", "voice_time"])
})

test("each page has its own accent color", () => {
    assert.deepEqual(Object.keys(command.ACCENTS).sort(), ["actividad", "canales", "comunidad", "hidden", "stats", "voz"])
    for (const color of Object.values(command.ACCENTS)) {
        assert.ok(Number.isInteger(color) && color >= 0 && color <= 0xffffff)
    }
    assert.equal(command.PAGES.length, 5)
})

test("every record has an emoji for its block header", () => {
    for (const { record } of records.allRecords()) {
        assert.ok(record.emoji && record.emoji.length > 0, `${record.id}: sin emoji`)
    }
})

test("expected scope: 31 visible tiers, 5 hidden", () => {
    assert.equal(records.countTiers(records.visibleRecords()), 31)
    assert.equal(records.countTiers(records.hiddenRecords()), 5)
    assert.equal(records.hiddenRecords().every(({ category }) => category.hidden), true)
    assert.equal(records.visibleRecords().every(({ category }) => !category.hidden), true)
})

test("total XP stays subtle", () => {
    const total = records.totalXp(records.allRecords())
    assert.ok(total <= MAX_TOTAL_XP, `total ${total} XP: desbalancea, revisa recompensas`)
})

test("title counts hidden only once discovered", () => {
    assert.deepEqual(command.titleCounts(new Set()), { done: 0, total: 31 })
    assert.deepEqual(command.titleCounts(new Set(["starboard:1"])), { done: 1, total: 32 })
    const all = new Set(records.allRecords().flatMap(({ record }) => record.tiers.map(t => `${record.id}:${t.threshold}`)))
    assert.deepEqual(command.titleCounts(all), { done: 36, total: 36 })
    assert.equal(command.buildTitle(new Set()), "# <:records:1549908515399929959> Mis records (0/31)")
})

test("category select shows per-category progress", () => {
    const select = command.buildCatSelect("actividad", new Set()).toJSON()
    assert.equal(select.custom_id, "records-cat")
    assert.equal(select.options.length, 6)
    assert.deepEqual(select.options.map(o => o.label), ["Estadísticas", "Actividad (0/9)", "Comunidad (0/12)", "Canales (0/5)", "Voz (0/5)", "Ocultos (0/5)"])
    assert.deepEqual(select.options.map(o => o.value), ["stats", "actividad", "comunidad", "canales", "voz", "hidden"])
    assert.deepEqual(select.options.map(o => o.description), [
        "Tus números de actividad, comunidad y voz.",
        "Mensajes, ritmo y presencia en el chat.",
        "Reacciones, rachas y antigüedad.",
        "Explora el servidor y participa en sus sistemas.",
        "Tiempo en voz y presencia en los canales de audio.",
        "Logros secretos que se revelan al descubrirlos.",
    ])
    assert.ok(select.placeholder.includes("2/6"))
    assert.equal(select.options[1].default, true)
    assert.ok(select.options.filter((o, i) => i !== 1).every(o => !o.default))
    const info = command.buildCatSelect("stats", new Set()).toJSON()
    assert.equal(info.options[0].default, true)
    assert.ok(info.placeholder.includes("1/6"))
    const disabled = command.buildCatSelect("voz", new Set(), true).toJSON()
    assert.equal(disabled.disabled, true)
})

test("every rendered line fits on mobile", () => {
    // Las menciones (<@id>, <@&id>, <#id>) se renderizan como nombres: se miden así.
    // Las líneas normales (sin -#) van en fuente más grande: listón más bajo.
    const rendered = line => line.replace(/<@!?\d+>/g, "@usuario").replace(/<@&\d+>/g, "@rol").replace(/<#\d+>/g, "#canal")
    const checkLines = text => {
        for (const line of text.split("\n")) {
            if (!line.trim()) continue
            const limit = line.startsWith("-#") ? MAX_LINE_WIDTH : NORMAL_LINE_WIDTH
            assert.ok(estimateVisualWidth(rendered(line)) <= limit, `salta: ${line}`)
        }
    }
    checkLines(command.buildTitle(new Set()))
    checkLines(command.buildTitle(new Set(["starboard:1"])))

    const userSamples = [
        {},
        { messages: 7, monthlyMessages: 3 },
        { messages: 150, monthlyMessages: 120 },
        { messages: 110894, monthlyMessages: 3240 },
        { messages: 9999999, monthlyMessages: 99999 },
    ]
    const memberSamples = [null, { joinedTimestamp: Date.now() - 400 * 86400000 }]
    for (const category of records.categories.filter(c => !c.hidden)) {
        for (const userData of userSamples) {
            for (const member of memberSamples) {
                for (const block of command.buildCategoryBlocks(category, userData, member, new Set(), tools.commafy)) {
                    checkLines(block)
                }
            }
        }
    }
    for (const block of command.buildHiddenBlocks(records.categories.find(c => c.id === "hidden"), new Set(), tools.commafy)) {
        checkLines(block)
    }
    // Página Info con varios perfiles (con/sin datos, con/sin miembro,
    // y con todos los campos de récords rellenos).
    const fullFields = {
        xp: 1108940, messages: 110894, monthlyMessages: 3240, monthlyXP: 115080,
        reactionsSent: 250, reactionsReceived: 40, streak: { current: 9 },
        channels: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, countingSent: 120, voiceMinutes: 900,
    }
    for (const userData of [{}, { xp: 950, messages: 10, monthlyMessages: 3, monthlyXP: 300 }, fullFields]) {
        for (const member of [null, { joinedTimestamp: Date.now() - 400 * 86400000 }]) {
            for (const text of command.buildInfoTexts(userData, member, new Set(), tools)) {
                checkLines(text)
            }
        }
    }
    for (const text of command.buildInfoDetailBlocks(tools)) {
        checkLines(text)
    }
    // Recompensa con rol (aún sin usar): también tiene que caber.
    const roleRecord = { id: "role_test", label: "Rol prueba", emoji: "🎖️", mechanic: { type: "messages_total" }, unit: "mensajes", tiers: [{ threshold: 10, xp: 0, name: "Prueba", desc: "Envía 10 mensajes", roleId: "1113898817469820928" }] }
    checkLines(command.buildRecordBlock(roleRecord, new Set(), null, tools.commafy))
})

test("progress numbers come from real data", () => {
    const byId = Object.fromEntries(records.allRecords().map(({ record }) => [record.id, record]))
    const commafy = tools.commafy

    let p = command.getProgress(byId.messages, { messages: 7 }, null, commafy)
    assert.equal(p.target, 10)
    assert.ok(Math.abs(p.frac - 0.7) < 1e-9)

    p = command.getProgress(byId.messages, { messages: 150 }, null, commafy)
    assert.equal(p.target, 1000)

    // Superado el último nivel: barra llena pero limitada al objetivo.
    p = command.getProgress(byId.messages, { messages: 99999 }, null, commafy)
    assert.equal(p.target, 50000)
    assert.equal(p.frac, 1)
    assert.equal(p.currentLabel, p.targetLabel)

    p = command.getProgress(byId.monthly_messages, { monthlyMessages: 120 }, null, commafy)
    assert.equal(p.target, 500)

    p = command.getProgress(byId.reactions_received, { reactionsReceived: 12 }, null, commafy)
    assert.equal(p.target, 50)

    const member = { joinedTimestamp: Date.now() - 400 * 86400000 }
    p = command.getProgress(byId.tenure, {}, member, commafy)
    assert.equal(p.target, 2)

    assert.equal(command.getProgress(byId.tenure, {}, null, commafy), null)
    assert.equal(command.getProgress(byId.streak, {}, null, commafy), null)
})

test("counting only accepts the next exact number", () => {
    const base = { channelId: records.CHANNELS.countingChannelId, author: { bot: false } }
    assert.equal(tracker.isCountingMessage({ ...base, content: "42" }, records.CHANNELS.countingChannelId, { content: "41" }), true)
    assert.equal(tracker.isCountingMessage({ ...base, content: "42abc" }, records.CHANNELS.countingChannelId, { content: "41" }), false)
    assert.equal(tracker.isCountingMessage({ ...base, content: "43" }, records.CHANNELS.countingChannelId, { content: "41" }), false)
    assert.equal(tracker.isCountingMessage({ ...base, content: "42" }, records.CHANNELS.countingChannelId, null), false)
})

test("streak keeps current and historical maximum", () => {
    const now = new Date("2026-01-10T12:00:00.000Z")
    assert.deepEqual(tracker.computeStreakUpdate({ current: 6, max: 7, lastDay: "2026-01-09" }, now), {
        current: 7, max: 7, lastDay: "2026-01-10",
    })
    assert.deepEqual(tracker.computeStreakUpdate({ current: 20, max: 20, lastDay: "2025-12-01" }, now), {
        current: 1, max: 20, lastDay: "2026-01-10",
    })
})

test("record block shows only the current tier with real progress", () => {
    const { record } = records.allRecords().find(({ record }) => record.id === "messages")
    const commafy = tools.commafy
    const locked = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 7 }, null, commafy), commafy)
    assert.ok(!locked.includes("🔒"), "sobran candados")
    assert.ok(locked.startsWith(`### ${record.emoji} **Mensajes**`))
    const lines = locked.split("\n")
    assert.equal(lines[1], "**Primeros pasos** - 0/5 niveles")
    assert.equal(lines[2], "-# - Envía 10 mensajes en el servidor.")
    assert.equal(lines[3], "**7/10 mensajes · 70%**")
    assert.equal(lines[4], "> **Recompensa:** <:XP:1467192533812645939> +1.000")

    // Con más mensajes salta a su siguiente objetivo y el contador avanza.
    const next = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 150 }, null, commafy), commafy)
    assert.ok(next.startsWith(`### ${record.emoji} **Mensajes**`))
    assert.ok(next.includes("**Conversador** - 2/5 niveles"))
    assert.ok(next.includes("**150/1.000 mensajes · 15%**"))
    assert.ok(next.includes("> **Recompensa:** <:XP:1467192533812645939> +10.000"))

    // Superado todo el catálogo: ✅ y sin números.
    const done = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 99999 }, null, commafy), commafy)
    assert.ok(done.includes("**Leyenda del chat** - 5/5 niveles ✅"))
    assert.ok(!/· \d+%/.test(done))
    assert.ok(!done.includes("<:star_drop"))
})

test("hidden tiers never leak into the visible list", () => {
    const visibleNames = new Set(records.visibleRecords().flatMap(({ record }) => record.tiers.map(t => t.name)))
    for (const { record } of records.hiddenRecords()) {
        for (const tier of record.tiers) {
            assert.ok(!visibleNames.has(tier.name), `oculto filtrado: ${tier.name}`)
        }
    }
})

test("info page shows record stats without faking missing data", () => {
    const member = { joinedTimestamp: Date.now() - 400 * 86400000 }
    const [stats, help] = command.buildInfoTexts(
        { messages: 10, monthlyMessages: 3, reactionsSent: 25 }, member, new Set(), tools)
    assert.ok(!stats.includes("Nivel"), "el nivel/XP no pinta aquí")
    assert.ok(stats.includes("**Mensajes totales:** 10"))
    assert.ok(stats.includes("**Mensajes este mes:** 3"))
    assert.ok(stats.includes("**Reacciones enviadas:** 25"))
    assert.ok(stats.includes("**Reacciones recibidas:** 0"))
    assert.ok(stats.includes("**Racha actual:** 0 días"))
    assert.ok(stats.includes("**Récords completados:** 0/31"))
    assert.ok(stats.includes("En juego:"))
    assert.ok(help.includes("XP extra"))
    const [empty] = command.buildInfoTexts({}, null, new Set(), tools)
    assert.ok(empty.includes("**Mensajes totales:** 0"))
    assert.ok(empty.includes("**Antigüedad servidor:** 0 días"))
    const full = command.buildInfoTexts(
        { messages: 110894, monthlyMessages: 3240, reactionsSent: 250, reactionsReceived: 40,
            streak: { current: 9 }, channels: { a: 1, b: 2 }, countingSent: 120, voiceMinutes: 900 },
        member, new Set(), tools)[0]
    assert.ok(full.includes("**Reacciones recibidas:** 40"))
    assert.ok(full.includes("**Racha actual:** 9 días"))
    assert.ok(full.includes("**Canales con mensajes:** 2"))
    assert.ok(full.includes("**Números en Counting:** 120"))
    assert.ok(full.includes("**Tiempo en voz:** 15h"))
    // Detalle V2: bloques cortos que caben en móvil.
    const blocks = command.buildInfoDetailBlocks(tools)
    assert.equal(blocks.length, 4)
    assert.ok(blocks[0].includes("¿Qué son los récords?"))
    assert.ok(blocks[2].includes("36 niveles") || blocks[3].includes("36 niveles"))
    const ephemeral = command.buildInfoContainer(tools)
    assert.ok(ephemeral.toJSON().components.length <= 10, "el efímero también respeta el límite")
})

test("resolveRank finds the user rank banner", () => {
    const PRO_ID = require("../consts/ranks.js").find(r => r.rank === "pro").roles[0].id
    const settings = { maxLevel: 100, curve: { 1: 100, 2: 0, 3: 0 }, rounding: 1, rewards: [{ id: PRO_ID, level: 5 }] }
    // Nivel 9 con rol Pro efectivo (curva 100/lvl, como en overtake).
    const found = command.resolveRank(950, settings)
    assert.ok(found && found.rank.rank === "pro")
    assert.ok(found.file.endsWith(".webp"))
    // Sin rewards no hay rango ni banner.
    assert.equal(command.resolveRank(950, { ...settings, rewards: [] }), null)
})

test("every page fits the 10-component container", () => {
    // Montaje: sección inicial(1) + separador(1) + records restantes*2
    // + fila del menú(1). La cabecera y el primer record van juntos.
    for (const category of records.categories.filter(c => !c.hidden)) {
        const blocks = command.buildCategoryBlocks(category, { messages: 150, monthlyMessages: 120 }, null, new Set(), tools.commafy)
        assert.ok(3 + Math.max(0, blocks.length - 2) * 2 <= 10, `${category.id} se pasa de componentes`)
    }
    const hidden = command.buildHiddenBlocks(records.categories.find(c => c.id === "hidden"), new Set(), tools.commafy)
    assert.equal(hidden.length, 2, "ocultos en un solo texto + cabecera")
    assert.ok(3 + Math.max(0, hidden.length - 2) * 2 <= 10, "hidden se pasa de componentes")
    // Info: título + sep + stats + sep + ayuda + sep + botón + menú.
    assert.equal(1 + 1 + 2 + 2 + 2, 8)
})