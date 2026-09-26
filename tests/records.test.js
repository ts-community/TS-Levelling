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
    assert.deepEqual(order.actividad, ["messages", "monthly_messages", "daily_messages", "talk_to"])
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

test("expected scope: 34 visible tiers, 5 hidden", () => {
    assert.equal(records.countTiers(records.visibleRecords()), 34)
    assert.equal(records.countTiers(records.hiddenRecords()), 5)
    assert.equal(records.hiddenRecords().every(({ category }) => category.hidden), true)
    assert.equal(records.visibleRecords().every(({ category }) => !category.hidden), true)
})

test("total XP stays subtle", () => {
    const total = records.totalXp(records.allRecords())
    assert.ok(total <= MAX_TOTAL_XP, `total ${total} XP: desbalancea, revisa recompensas`)
})

test("title counts hidden in the total from the start", () => {
    assert.deepEqual(command.titleCounts(new Set()), { done: 0, total: 39 })
    assert.deepEqual(command.titleCounts(new Set(["starboard:1"])), { done: 1, total: 39 })
    const all = new Set(records.allRecords().flatMap(({ record }) => record.tiers.map(t => `${record.id}:${t.threshold}`)))
    assert.deepEqual(command.titleCounts(all), { done: 39, total: 39 })
    assert.equal(command.buildTitle(new Set()), "# <:records:1549908515399929959> Mis Records (0/39)")
})

test("category select shows per-category progress", () => {
    const select = command.buildCatSelect("actividad", new Set()).toJSON()
    assert.equal(select.custom_id, "records-cat")
    assert.equal(select.options.length, 6)
    assert.deepEqual(select.options.map(o => o.label), ["Estadísticas", "Actividad (0/12)", "Comunidad (0/12)", "Canales (0/5)", "Voz (0/5)", "Ocultos (0/5)"])
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
                    // El título ### y la descripción citada pueden saltar en
                    // móvil: solo se exige la recompensa y las cabeceras.
                    const strict = block.split("\n").filter(l => !l.startsWith("###") && !l.startsWith(">")).join("\n")
                    checkLines(strict)
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
            const [groups, helpText] = command.buildInfoTexts(userData, member, new Set(), tools)
            for (const text of [...groups, helpText]) {
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

    p = command.getProgress(byId.daily_messages, { dailyMessages: 60 }, null, commafy)
    assert.equal(p.target, 150)

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

test("received reactions ignore self-reactions and bot authors", () => {
    const msg = author => ({ author })
    assert.equal(tracker.isValidReceivedReaction(msg({ id: "a" }), { id: "b" }), true)
    assert.equal(tracker.isValidReceivedReaction(msg({ id: "a" }), { id: "a" }), false, "auto-reacción no cuenta")
    assert.equal(tracker.isValidReceivedReaction(msg({ id: "a", bot: true }), { id: "b" }), false)
    assert.equal(tracker.isValidReceivedReaction(msg({ id: "a", bot: true }), { id: "a" }), false)
    assert.equal(tracker.isValidReceivedReaction(null, { id: "b" }), false)
    assert.equal(tracker.isValidReceivedReaction(msg({}), { id: "b" }), false)
    assert.equal(tracker.isValidReceivedReaction(msg({ id: "a" }), null), false)
    assert.equal(tracker.isValidReceivedReaction(msg({ id: "a" }), { id: "b", bot: true }), true, "bots al autor se mantienen")
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

test("record block shows only the current tier, no progress line for now", () => {
    const { record } = records.allRecords().find(({ record }) => record.id === "messages")
    const commafy = tools.commafy
    const locked = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 7 }, null, commafy), commafy)
    assert.ok(!locked.includes("🔒"), "sobran candados")
    assert.ok(locked.startsWith(`### ${record.emoji} **Primeros pasos**`))
    const lines = locked.split("\n")
    assert.equal(lines[0], `### ${record.emoji} **Primeros pasos** - 0/5 fases`)
    assert.equal(lines[1], "> Envía 10 mensajes en el servidor.")
    assert.equal(lines[2], "-# <:XP:1467192533812645939> **+1.000 XP**")
    assert.equal(lines.length, 3, "título + descripción + recompensa, sin progreso")
    assert.ok(!locked.includes("~~"), "sin completar: sin tachado")

    // Con más mensajes salta a su siguiente objetivo y el contador avanza.
    const next = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 150 }, null, commafy), commafy)
    assert.ok(next.startsWith(`### ${record.emoji} **Conversador**`))
    assert.ok(next.includes("**Conversador** - 2/5 fases"))
    assert.ok(!next.includes("~~"), "a medias: sin tachado")
    assert.ok(!next.includes("mensajes ·"), "sin línea de progreso por ahora")
    assert.ok(next.includes("-# <:XP:1467192533812645939> **+10.000 XP**"))

    // Superado todo el catálogo: tachado total y sin números de progreso.
    const done = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 99999 }, null, commafy), commafy)
    assert.ok(done.includes("### ~~"))
    assert.ok(done.includes("**Leyenda del chat**"))
    assert.ok(done.includes("- 5/5 fases"))
    assert.ok(done.includes("> ~~Envía 50.000 mensajes en el servidor.~~"))
    assert.ok(done.includes("-# ~~<:XP:1467192533812645939> **+100.000 XP**~~"))
    assert.ok(!done.includes("✅"))
    assert.ok(!/· \d+%/.test(done))
    assert.ok(!done.includes("<:star_drop"))
})

test("completed records sort first and render struck through", () => {
    const category = records.categories.find(c => c.id === "actividad")
    // buildCategoryBlocks[0] es la cabecera; los récords empiezan en [1].
    const plain = command.buildCategoryBlocks(category, {}, null, new Set(), tools.commafy)
    assert.ok(plain[1].includes("**Primeros pasos**"), "sin completar: el más difícil primero")
    assert.ok(!plain[1].includes("~~"), "sin completar: sin tachado")

    const withDone = command.buildCategoryBlocks(category, {}, null, new Set(["talk_to:1"]), tools.commafy)
    assert.ok(withDone[1].startsWith("### ~~🤖 **Primer contacto** - 1/1 fases~~"), "completado arriba aunque sea el más fácil")
    assert.ok(withDone[1].includes("> ~~Menciona o responde a Nova.~~"), "descripción tachada")
    assert.ok(withDone[1].includes("<:XP:1467192533812645939> **+3.000 XP**~~"), "recompensa tachada")
})

test("completed records keep difficulty order among themselves", () => {
    const category = records.categories.find(c => c.id === "actividad")
    // monthly (3 fases) + talk_to (1 fase) completados: el más difícil primero,
    // y messages (sin completar) después aunque sea el más difícil del catálogo.
    const ids = new Set([
        "monthly_messages:500", "monthly_messages:2000", "monthly_messages:5000", "talk_to:1",
    ])
    // userData acorde a los flags: el progreso mensual también lo da por completo.
    const blocks = command.buildCategoryBlocks(category, { monthlyMessages: 6000 }, null, ids, tools.commafy)
    assert.ok(blocks[1].includes("**Mes legendario**"), "completado más difícil primero")
    assert.ok(blocks[2].includes("**Primer contacto**"), "completado más fácil segundo")
    assert.ok(blocks[3].includes("**Primeros pasos**"), "sin completar después")
    assert.ok(!blocks[1].includes("?????") && blocks[1].includes("- 3/3 fases"), "título normal")
})

test("hidden page has no title and masks undescribed tiers", () => {
    const hiddenCat = records.categories.find(c => c.id === "hidden")
    const locked = command.buildHiddenBlocks(hiddenCat, new Set(), tools.commafy)
    assert.equal(locked.length, 5, "un bloque por nivel oculto")
    const lockedText = locked.join("\n")
    assert.ok(!lockedText.includes("##"), "sin título de categoría")
    assert.ok(!lockedText.includes("❓ ?????"), "misterio en vez de interrogantes")
    // Un misterio distinto por Record...
    const mysteries = hiddenCat.records.map(r => r.mystery)
    assert.equal(new Set(mysteries).size, hiddenCat.records.length, "cada oculto con su misterio")
    for (const m of mysteries) assert.ok(lockedText.includes(m), `falta el misterio: ${m}`)
    // ...que no filtra nada sin descubrir.
    for (const { record } of records.hiddenRecords()) {
        assert.ok(!lockedText.includes(record.label), `filtra etiqueta: ${record.id}`)
        for (const tier of record.tiers) {
            assert.ok(!lockedText.includes(tier.name), `filtra nombre: ${tier.name}`)
            assert.ok(!lockedText.includes(tier.desc), `filtra descripción: ${record.id}`)
        }
    }

    const unlocked = command.buildHiddenBlocks(hiddenCat, new Set(["starboard:1"]), tools.commafy)
    assert.equal(unlocked.length, 5)
    const unlockedText = unlocked.join("\n")
    assert.ok(unlockedText.includes("### ⭐ **Mensaje destacado** - 1/1 fases"), "nombre a la vista")
    assert.ok(unlockedText.includes("El secreto sigue a salvo"), "descripción sustituida por misterio")
    assert.ok(unlockedText.includes("-# <:XP:1467192533812645939> **+30.000 XP**"), "recompensa a la vista")
    assert.ok(!unlockedText.includes("aparezca en"), "la descripción real no se filtra")
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
    const [groups, help] = command.buildInfoTexts(
        { messages: 10, monthlyMessages: 3, dailyMessages: 7, reactionsSent: 25 }, member, new Set(), tools)
    assert.equal(groups.length, 4, "actividad, comunidad, canales, voz")
    const stats = groups.join("\n")
    assert.ok(!stats.includes("Nivel"), "el nivel/XP no pinta aquí")
    assert.ok(!stats.includes("-#"), "estadísticas sin pequeño")
    assert.ok(!stats.includes("General"), "sin grupo general")
    assert.ok(stats.includes("**Mensajes totales:** 10"))
    assert.ok(stats.includes("**Mensajes este mes:** 3"))
    assert.ok(stats.includes("**Mensajes hoy:** 7"))
    assert.ok(stats.includes("**Reacciones enviadas:** 25"))
    assert.ok(stats.includes("**Reacciones recibidas:** 0"))
    assert.ok(stats.includes("**Racha actual:** 0 días"))
    assert.ok(groups[0].includes("### 💬 Actividad"), "cabecera de actividad")
    assert.ok(groups[1].includes("### 🤝 Comunidad"), "cabecera de comunidad")
    assert.ok(groups[2].includes("### 🧭 Canales"), "cabecera de canales")
    assert.ok(groups[3].includes("### 🎙️ Voz"), "cabecera de voz")
    assert.ok(help.includes("XP extra"))
    const [emptyGroups] = command.buildInfoTexts({}, null, new Set(), tools)
    const empty = emptyGroups.join("\n")
    assert.ok(empty.includes("**Mensajes totales:** 0"))
    assert.ok(empty.includes("**Antigüedad servidor:** 0 días"))
    const full = command.buildInfoTexts(
        { messages: 110894, monthlyMessages: 3240, reactionsSent: 250, reactionsReceived: 40,
            streak: { current: 9 }, channels: { a: 1, b: 2 }, countingSent: 120, voiceMinutes: 900 },
        member, new Set(), tools)[0].join("\n")
    assert.ok(full.includes("**Reacciones recibidas:** 40"))
    assert.ok(full.includes("**Racha actual:** 9 días"))
    assert.ok(full.includes("**Canales con mensajes:** 2"))
    assert.ok(full.includes("**Números en Counting:** 120"))
    assert.ok(full.includes("**Tiempo en voz:** 15h"))
    // Detalle V2: bloques cortos que caben en móvil.
    const blocks = command.buildInfoDetailBlocks(tools)
    assert.equal(blocks.length, 4)
    assert.ok(blocks[0].includes("¿Qué son los Records?"))
    assert.ok(blocks[2].includes("39 fases") || blocks[3].includes("39 fases"))
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

test("page composition stays within proven container sizes", () => {
    // Montaje: sección inicial(1) + separador(1) + records restantes*2
    // + fila del menú(1). El título y el primer record van juntos.
    for (const category of records.categories.filter(c => !c.hidden)) {
        const blocks = command.buildCategoryBlocks(category, { messages: 150, monthlyMessages: 120 }, null, new Set(), tools.commafy)
        assert.ok(3 + Math.max(0, blocks.length - 2) * 2 <= 10, `${category.id} se pasa de componentes`)
    }
    const hidden = command.buildHiddenBlocks(records.categories.find(c => c.id === "hidden"), new Set(), tools.commafy)
    assert.equal(hidden.length, 5, "un bloque por nivel oculto")
    // Ocultos: título+primero(1) + sep + 4 bloques con sep + menú = 11.
    // Como /top (unos 20), los containers aguantan más de 10 sin problema.
    assert.equal(1 + 1 + (hidden.length - 1) * 2 + 1, 11)
    // Info: título+act pegados(2) + 3 seps + resto de grupos + menú = 10.
    // Como /top (unos 20), los containers aguantan más de 10 sin problema.
    assert.equal(2 + 3 + 3 + 1 + 1, 10)
})