const { test } = require("node:test")
const assert = require("node:assert/strict")

const Tools = require("../classes/Tools.js")
const tools = new Tools()
const records = require("../config/records.js")
const command = require("../commands/slash/records.js")
const { estimateVisualWidth } = require("../commands/slash/top.js")

// La línea de cada nivel debe caber en una línea de móvil (mismo listón que /top).
// Las descripciones van en fuente normal (más grande): listón más exigente.
const MAX_LINE_WIDTH = 37.9
const NORMAL_LINE_WIDTH = 31
// Tope anti-desbalanceo generoso: todo junto no debería acercarse al XP de
// nivel 100 (~1.5M). Si salta, es que alguna recompensa se ha ido de las manos.
const MAX_TOTAL_XP = 350000

test("command metadata is valid", () => {
    assert.equal(command.metadata.name, "records")
    assert.ok(command.metadata.description.length > 0)
    assert.equal(typeof command.run, "function")
    for (const fn of ["formatTier", "buildRecordBlock", "buildCategoryBlocks", "buildHiddenBlocks", "buildTitle", "buildNavButtons", "titleCounts", "buildBar", "getProgress"]) {
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
    assert.deepEqual(order.mensajes, ["messages", "monthly_messages"])
    assert.deepEqual(order.constancia, ["streak", "reactions_sent"])
    assert.deepEqual(order.comunidad, ["talk_to", "tenure"])
    assert.deepEqual(order.channels, ["distinct_channels", "counting"])
    assert.deepEqual(order.voice, ["voice_general", "voice_all_fixed", "voice_time"])
})

test("records board uses its banner and voted color", () => {
    const fs = require("node:fs")
    const path = require("node:path")
    assert.ok(fs.existsSync(path.join(__dirname, "..", "assets", "banners", "bronze.webp")))
    assert.equal(command.RECORDS_COLOR, 0xe6c036)
    assert.equal(command.PAGES.length, 6)
})

test("every record has an emoji for its block header", () => {
    for (const { record } of records.allRecords()) {
        assert.ok(record.emoji && record.emoji.length > 0, `${record.id}: sin emoji`)
    }
})

test("expected scope: 27 visible tiers, 6 hidden", () => {
    assert.equal(records.countTiers(records.visibleRecords()), 27)
    assert.equal(records.countTiers(records.hiddenRecords()), 6)
    assert.equal(records.hiddenRecords().every(({ category }) => category.hidden), true)
    assert.equal(records.visibleRecords().every(({ category }) => !category.hidden), true)
})

test("total XP stays subtle", () => {
    const total = records.totalXp(records.allRecords())
    assert.ok(total <= MAX_TOTAL_XP, `total ${total} XP: desbalancea, revisa recompensas`)
})

test("title counts hidden only once discovered", () => {
    assert.deepEqual(command.titleCounts(new Set()), { done: 0, total: 27 })
    assert.deepEqual(command.titleCounts(new Set(["starboard:1"])), { done: 1, total: 28 })
    const all = new Set(records.allRecords().flatMap(({ record }) => record.tiers.map(t => `${record.id}:${t.threshold}`)))
    assert.deepEqual(command.titleCounts(all), { done: 33, total: 33 })
    assert.equal(command.buildTitle(new Set()), "# <:records:1549908515399929959> Mis records (0/27)")
})

test("nav buttons show per-category progress", () => {
    const buttons = command.buildNavButtons("mensajes", new Set()).map(b => b.toJSON())
    assert.equal(buttons.length, 6)
    assert.deepEqual(buttons.map(b => b.label), ["💬 Mensajes 0/8", "🔥 Constancia 0/6", "🤝 Comunidad 0/4", "📺 Canales 0/4", "🎙️ Voz 0/5", "🕵️ Ocultos 0/6"])
    assert.deepEqual(buttons.map(b => b.custom_id), ["records-cat-mensajes", "records-cat-constancia", "records-cat-comunidad", "records-cat-channels", "records-cat-voice", "records-cat-hidden"])
    assert.equal(buttons[0].disabled, true)
    assert.equal(buttons.slice(1).every(b => !b.disabled), true)
})

test("every rendered line fits on mobile", () => {
    // Las menciones (<@id>, <@&id>) se renderizan como nombres: se miden así.
    // Las líneas normales (sin -#) van en fuente más grande: listón más bajo.
    const rendered = line => line.replace(/<@!?\d+>/g, "@usuario").replace(/<@&\d+>/g, "@rol")
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
    // Recompensa con rol (aún sin usar): también tiene que caber.
    const roleTier = { threshold: 10, xp: 0, name: "Prueba", desc: "Envía 10 mensajes", roleId: "1113898817469820928" }
    checkLines(command.formatTier(roleTier, false, null, tools.commafy))
})

test("progress bars grow with real data", () => {
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

    const member = { joinedTimestamp: Date.now() - 400 * 86400000 }
    p = command.getProgress(byId.tenure, {}, member, commafy)
    assert.equal(p.target, 2)

    assert.equal(command.getProgress(byId.tenure, {}, null, commafy), null)
    assert.equal(command.getProgress(byId.streak, {}, null, commafy), null)

    assert.equal((command.buildBar(0).match(/🟩/gu) || []).length, 0)
    const half = command.buildBar(0.5)
    assert.equal(half.match(/🟩/gu).length, 5)
    assert.equal(half.match(/⬜/gu).length, 5)
    assert.equal(command.buildBar(1).match(/⬜/gu), null)
})

test("tiers show xp with emoji, desc plain and no locks when pending", () => {
    const { record } = records.allRecords().find(({ record }) => record.id === "messages")
    const locked = command.formatTier(record.tiers[0], false, null, tools.commafy)
    assert.ok(!locked.includes("🔒"), "sobran candados")
    assert.ok(locked.startsWith("**Primeros pasos**"))
    const lines = locked.split("\n")
    assert.equal(lines[1], "Envía 10 mensajes")
    assert.ok(lines[2].startsWith("-# **Recompensa:** <:XP:1467192533812645939> +250"))
    const unlocked = command.formatTier(record.tiers[0], true, null, tools.commafy)
    assert.ok(unlocked.startsWith("✅ "))
})

test("hidden tiers never leak into the visible list", () => {
    const visibleNames = new Set(records.visibleRecords().flatMap(({ record }) => record.tiers.map(t => t.name)))
    for (const { record } of records.hiddenRecords()) {
        for (const tier of record.tiers) {
            assert.ok(!visibleNames.has(tier.name), `oculto filtrado: ${tier.name}`)
        }
    }
})
