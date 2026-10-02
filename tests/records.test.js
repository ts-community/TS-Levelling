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
    for (const fn of ["buildRecordBlock", "buildCategoryBlocks", "buildHiddenBlocks", "buildTitle", "buildCatSelect", "buildInfoTexts", "resolveRank", "titleCounts", "getProgress", "formatProgress", "fitProgressLine"]) {
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

test("records follow the config order within each category", () => {
    const order = Object.fromEntries(records.categories.map(c => [c.id, c.records.map(r => r.id)]))
    assert.deepEqual(order.actividad, ["messages", "monthly_messages", "daily_messages", "talk_to"])
    assert.deepEqual(order.comunidad, ["tenure", "streak", "reactions_received", "reactions_sent"])
    assert.deepEqual(order.canales, ["pokemon", "counting", "distinct_channels", "economy_participation"])
    assert.deepEqual(order.voz, ["voice_time", "voice_all_fixed", "voice_general"])
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

test("expected scope: 37 visible tiers, 5 hidden", () => {
    assert.equal(records.countTiers(records.visibleRecords()), 37)
    assert.equal(records.countTiers(records.hiddenRecords()), 5)
    assert.equal(records.hiddenRecords().every(({ category }) => category.hidden), true)
    assert.equal(records.visibleRecords().every(({ category }) => !category.hidden), true)
})

test("total XP stays subtle", () => {
    const total = records.totalXp(records.allRecords())
    assert.ok(total <= MAX_TOTAL_XP, `total ${total} XP: desbalancea, revisa recompensas`)
})

test("title counts hidden in the total from the start", () => {
    assert.deepEqual(command.titleCounts(new Set()), { done: 0, total: 42 })
    assert.deepEqual(command.titleCounts(new Set(["starboard:1"])), { done: 1, total: 42 })
    const all = new Set(records.allRecords().flatMap(({ record }) => record.tiers.map(t => `${record.id}:${t.threshold}`)))
    assert.deepEqual(command.titleCounts(all), { done: 42, total: 42 })
    assert.equal(command.buildTitle(new Set()), "# <:records:1549908515399929959> Mis Records (0/42)")
})

test("category select shows per-category progress", () => {
    const select = command.buildCatSelect("actividad", new Set()).toJSON()
    assert.equal(select.custom_id, "records-cat")
    assert.equal(select.options.length, 6)
    assert.deepEqual(select.options.map(o => o.label), ["Estadísticas", "Actividad (0/12)", "Comunidad (0/12)", "Canales (0/8)", "Voz (0/5)", "Ocultos (0/5)"])
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
    // El primer bloque va pegado al título en la sección con thumbnail (más
    // estrecha) cuando hay avatar: con narrowFirst su línea -# usa el
    // listón estrecho (incluido el caso real 117,5k/50k mensajes).
    const narrowSamples = [...userSamples, { messages: 117500, monthlyMessages: 6000 }]
    const checkNarrow = (block, label) => {
        const strict = block.split("\n").filter(l => !l.startsWith("###") && !l.startsWith(">")).join("\n")
        for (const line of strict.split("\n")) {
            if (!line.trim()) continue
            const limit = line.startsWith("-#") ? command.FIRST_BLOCK_LINE_WIDTH : NORMAL_LINE_WIDTH
            assert.ok(estimateVisualWidth(rendered(line)) <= limit, `salta en thumbnail (${label}): ${line}`)
        }
    }
    for (const category of records.categories.filter(c => !c.hidden)) {
        for (const userData of narrowSamples) {
            const blocks = command.buildCategoryBlocks(category, userData, null, new Set(), tools.commafy, true)
            checkNarrow(blocks[1], category.id)
        }
    }
    const hiddenCat = records.categories.find(c => c.id === "hidden")
    for (const userData of narrowSamples) {
        const blocks = command.buildHiddenBlocks(hiddenCat, new Set(), tools.commafy, userData, null, true)
        checkNarrow(blocks[0], "hidden")
    }
    // Página Info con varios perfiles (con/sin datos, con/sin miembro,
    // y con todos los campos de récords rellenos). Sus líneas van a ancho
    // completo (sin thumbnail al lado), así que usan INFO_LINE_WIDTH.
    const fullFields = {
        xp: 1108940, messages: 110894, monthlyMessages: 3240, monthlyXP: 115080,
        reactionsSent: 250, reactionsReceived: 40, streak: { current: 9 },
        channels: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, countingSent: 120, voiceMinutes: 900,
    }
    const checkInfoLines = text => {
        for (const line of text.split("\n")) {
            if (!line.trim()) continue
            const limit = line.startsWith("-#") ? MAX_LINE_WIDTH : command.INFO_LINE_WIDTH
            assert.ok(estimateVisualWidth(rendered(line)) <= limit, `salta: ${line}`)
        }
    }
    for (const userData of [{}, { xp: 950, messages: 10, monthlyMessages: 3, monthlyXP: 300 }, fullFields]) {
        for (const member of [null, { joinedTimestamp: Date.now() - 400 * 86400000 }]) {
            const [groups, helpText] = command.buildInfoTexts(userData, member, new Set(), tools)
            for (const text of [...groups, helpText]) {
                checkInfoLines(text)
            }
        }
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

    // Superado el último nivel: la barra se llena, pero el contador conserva el valor real.
    p = command.getProgress(byId.messages, { messages: 99999 }, null, commafy)
    assert.equal(p.target, 50000)
    assert.equal(p.frac, 1)
    assert.notEqual(p.currentLabel, p.targetLabel)

    p = command.getProgress(byId.monthly_messages, { monthlyMessages: 120 }, null, commafy)
    assert.equal(p.target, 1000)

    p = command.getProgress(byId.daily_messages, { dailyMessages: 60 }, null, commafy)
    assert.equal(p.target, 200)

    p = command.getProgress(byId.reactions_received, { reactionsReceived: 12 }, null, commafy)
    assert.equal(p.target, 50)

    const member = { joinedTimestamp: Date.now() - 400 * 86400000 }
    p = command.getProgress(byId.tenure, {}, member, commafy)
    assert.equal(p.target, 2)

    assert.equal(command.getProgress(byId.tenure, {}, null, commafy), null)
    assert.equal(command.getProgress(byId.streak, {}, null, commafy), null)

    // Voz: umbrales en minutos, progreso en horas. Sin voz aún = 0/5 h,
    // nunca el umbral en crudo ("0/300 h").
    p = command.getProgress(byId.voice_time, {}, null, commafy)
    assert.equal(p.target, 5)
    assert.equal(p.currentLabel, commafy(0))
    assert.equal(p.targetLabel, commafy(5))
    p = command.getProgress(byId.voice_time, { voiceMinutes: 90 }, null, commafy)
    assert.equal(p.target, 5)
    const voiceBlock = command.buildRecordBlock(byId.voice_time, new Set(), command.getProgress(byId.voice_time, {}, null, commafy), commafy)
    assert.ok(voiceBlock.includes("📊 **0/5 h**"), `voz sin datos: ${voiceBlock.split("\n").at(-1)}`)
    // Con decimales en español: 210 min = 3,5/5 h.
    const voiceHalf = command.buildRecordBlock(byId.voice_time, new Set(), command.getProgress(byId.voice_time, { voiceMinutes: 210 }, null, commafy), commafy)
    assert.ok(voiceHalf.includes("📊 **3,5/5 h**"), voiceHalf.split("\n").at(-1))

    // De gira: un solo tier pero avance 0/5 (fijos visitados).
    const fixedIds = byId.voice_all_fixed.mechanic.fixedChannelIds
    assert.equal(fixedIds.length, 5)
    p = command.getProgress(byId.voice_all_fixed, {}, null, commafy)
    assert.equal(p.target, 5)
    assert.equal(p.phasesTotal, 5)
    let tourBlock = command.buildRecordBlock(byId.voice_all_fixed, new Set(), p, commafy)
    assert.ok(tourBlock.includes("**De gira** - 0/5 fases"), tourBlock.split("\n")[0])
    assert.ok(tourBlock.includes("📊 **0/5 canales**"), tourBlock.split("\n").at(-1))
    p = command.getProgress(byId.voice_all_fixed, { voiceJoined: [fixedIds[0], fixedIds[1], "otro-canal"] }, null, commafy)
    assert.equal(p.completed, 2)
    tourBlock = command.buildRecordBlock(byId.voice_all_fixed, new Set(), p, commafy)
    assert.ok(tourBlock.includes("**De gira** - 2/5 fases"), tourBlock.split("\n")[0])
    p = command.getProgress(byId.voice_all_fixed, { voiceJoined: [...fixedIds] }, null, commafy)
    assert.equal(p.full, true)
    tourBlock = command.buildRecordBlock(byId.voice_all_fixed, new Set(), p, commafy)
    assert.ok(tourBlock.includes("**De gira** - 5/5 fases"), tourBlock.split("\n")[0])
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

test("record block shows the current tier and real progress", () => {
    const { record } = records.allRecords().find(({ record }) => record.id === "messages")
    const commafy = tools.commafy
    const locked = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 7 }, null, commafy), commafy)
    assert.ok(!locked.includes("🔒"), "sobran candados")
    assert.ok(locked.startsWith(`### ${record.emoji} **Primeros pasos**`))
    const lines = locked.split("\n")
    assert.equal(lines[0], `### ${record.emoji} **Primeros pasos** - 0/5 fases`)
    assert.equal(lines[1], "> Envía 10 mensajes en el servidor.")
    assert.equal(lines[2], "-# 📊 **7/10 mensajes** - <:XP:1467192533812645939> **+1.000 XP**")
    assert.equal(lines.length, 3, "título + descripción + progreso/recompensa")
    assert.ok(!locked.includes("~~"), "sin completar: sin tachado")

    // Con más mensajes salta a su siguiente objetivo y el contador avanza.
    const next = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 150 }, null, commafy), commafy)
    assert.ok(next.startsWith(`### ${record.emoji} **Conversador**`))
    assert.ok(next.includes("**Conversador** - 2/5 fases"))
    assert.ok(!next.includes("~~"), "a medias: sin tachado")
    assert.ok(next.includes("📊 **150/1k mensajes**"))
    assert.ok(next.includes("<:XP:1467192533812645939> **+10.000 XP**"))

    // Superado todo el catálogo: tachado total, conservando el contador real.
    const done = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 99999 }, null, commafy), commafy)
    assert.ok(done.includes("### ~~"))
    assert.ok(done.includes("**Leyenda**"))
    assert.ok(done.includes("📊 **100k/50k mensajes**"))
    assert.ok(done.includes("> ~~Envía 50.000 mensajes en el servidor.~~"))
    assert.ok(done.includes("-# ~~📊 **100k/50k mensajes** - <:XP:1467192533812645939> **+75.000 XP**~~"))
    assert.ok(!done.includes("✅"))
    assert.ok(!/· \d+%/.test(done))
    assert.ok(!done.includes("<:star_drop"))
})

test("long message lines fall back to msgs instead of wrapping", () => {
    const commafy = tools.commafy
    // Con números grandes + rol, "mensajes" supera el listón -#: se abrevia.
    const big = {
        id: "big_test", label: "Grande", emoji: "💬",
        mechanic: { type: "messages_total" }, unit: "mensajes", unitOne: "mensaje",
        tiers: [{ threshold: 5000000, xp: 100000, name: "Gigante", desc: "d", roleId: "1113898817469820928" }],
    }
    const block = command.buildRecordBlock(big, new Set(), command.getProgress(big, { messages: 4700000 }, null, commafy), commafy)
    assert.ok(block.includes("**4,7M/5M msgs**"), block.split("\n").at(-1))
    assert.ok(!block.includes("mensajes"))
    const line = block.split("\n").at(-1).replace(/<@&\d+>/g, "@rol")
    assert.ok(estimateVisualWidth(line) <= MAX_LINE_WIDTH, `salta: ${line}`)
    // Las cortas conservan "mensajes".
    const { record } = records.allRecords().find(({ record }) => record.id === "messages")
    const short = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 7 }, null, commafy), commafy)
    assert.ok(short.includes("**7/10 mensajes**"))
})

test("first block in thumbnail section drops the unit", () => {
    const commafy = tools.commafy
    const { record } = records.allRecords().find(({ record }) => record.id === "messages")
    const progress = command.getProgress(record, { messages: 117500 }, null, commafy)
    // A ancho completo cabe en "mensajes" (35,45 <= 37,9)...
    const normal = command.buildRecordBlock(record, new Set(), progress, commafy).split("\n").at(-1)
    assert.ok(normal.includes("**117,5k/50k mensajes**"), normal)
    // ...pero en la sección con thumbnail ni en "msgs" cabe (31,62 saltaba):
    // sin unidad, que sí entra en el listón 30.
    const narrow = command.buildRecordBlock(record, new Set(), progress, commafy, command.FIRST_BLOCK_LINE_WIDTH).split("\n").at(-1)
    assert.ok(narrow.includes("**117,5k/50k**"), narrow)
    assert.ok(!narrow.includes("mensajes") && !narrow.includes("msgs"))
    assert.ok(estimateVisualWidth(narrow.replace(/<@&\d+>/g, "@rol")) <= command.FIRST_BLOCK_LINE_WIDTH, `salta: ${narrow}`)
    // Las cortas conservan "mensajes" también en estrecho.
    const small = command.buildRecordBlock(record, new Set(), command.getProgress(record, { messages: 7 }, null, commafy), commafy, command.FIRST_BLOCK_LINE_WIDTH).split("\n").at(-1)
    assert.ok(small.includes("**7/10 mensajes**"), small)
    // Y el container lo aplica al primer bloque cuando hay avatar.
    const member = { displayAvatarURL: () => "https://x/y.png" }
    const blocks = command.buildCategoryBlocks(
        records.categories.find(c => c.id === "actividad"),
        { messages: 117500 }, member, new Set(), commafy, true)
    assert.ok(!blocks[1].split("\n").at(-1).includes("msgs"), blocks[1].split("\n").at(-1))
})

test("completed records sort first and render struck through", () => {
    const category = records.categories.find(c => c.id === "actividad")
    // buildCategoryBlocks[0] es la cabecera; los récords empiezan en [1].
    const plain = command.buildCategoryBlocks(category, {}, null, new Set(), tools.commafy)
    assert.ok(plain[1].includes("**Primeros pasos**"), "sin completar: el primero del config")
    assert.ok(!plain[1].includes("~~"), "sin completar: sin tachado")

    const withDone = command.buildCategoryBlocks(category, {}, null, new Set(["talk_to:1"]), tools.commafy)
    assert.ok(withDone[1].startsWith("### ~~🤖 **Contacto** - 1/1 fase~~"), "completado arriba aunque sea el más fácil")
    assert.ok(withDone[1].includes("> ~~Menciona o responde a un mensaje del bot de IA"), "descripción tachada")
    assert.ok(withDone[1].includes("<:XP:1467192533812645939> **+1.000 XP**~~"), "recompensa tachada")
})

test("records render in config order when nothing is completed", () => {
    // El orden visible lo manda config/records.js (p. ej. Poketwo antes que
    // Counting aunque su umbral final sea menor).
    const canales = records.categories.find(c => c.id === "canales")
    const blocks = command.buildCategoryBlocks(canales, {}, null, new Set(), tools.commafy)
    const titles = blocks.slice(1).map(b => b.split("\n")[0])
    const pokeIdx = titles.findIndex(t => t.includes("Aprendiz"))
    const countIdx = titles.findIndex(t => t.includes("El 10"))
    assert.ok(pokeIdx !== -1 && countIdx !== -1 && pokeIdx < countIdx, "Poketwo antes que Counting")
    const comunidad = records.categories.find(c => c.id === "comunidad")
    const comBlocks = command.buildCategoryBlocks(comunidad, {}, null, new Set(), tools.commafy)
    assert.ok(comBlocks[1].includes("Veterano"), "Antigüedad primera del config")
})

test("completed records keep config order among themselves", () => {
    const category = records.categories.find(c => c.id === "actividad")
    // monthly + talk_to completados: primero en orden del config,
    // y messages (sin completar) después aunque abra la categoría.
    const ids = new Set([
        "monthly_messages:1000", "monthly_messages:2000", "monthly_messages:5000", "talk_to:1",
    ])
    // userData acorde a los flags: el progreso mensual también lo da por completo.
    const blocks = command.buildCategoryBlocks(category, { monthlyMessages: 6000 }, null, ids, tools.commafy)
    assert.ok(blocks[1].includes("**Mes pleno**"), "completado primero del config")
    assert.ok(blocks[2].includes("**Contacto**"), "completado segundo del config")
    assert.ok(blocks[3].includes("**Primeros pasos**"), "sin completar después")
    assert.ok(!blocks[1].includes("?????") && blocks[1].includes("- 3/3 fases"), "título normal")
})

test("hidden page renders like the rest with mystery descriptions", () => {
    const hiddenCat = records.categories.find(c => c.id === "hidden")
    const locked = command.buildHiddenBlocks(hiddenCat, new Set(), tools.commafy)
    assert.equal(locked.length, 5, "un bloque por récord oculto")
    const lockedText = locked.join("\n")
    assert.ok(!/^##(?!#)/m.test(lockedText), "sin título de categoría")
    // Igual que un récord normal (título, descripción citada, progreso y
    // recompensa), pero la descripción es el misterio: no revela la condición.
    const star = hiddenCat.records.find(r => r.id === "starboard")
    assert.ok(lockedText.includes(`### ⭐ **Bajo los focos** - 0/1 fase`), "título a la vista")
    assert.ok(lockedText.includes(`> ${star.mystery}`), "descripción misteriosa citada")
    assert.ok(lockedText.includes("-# 📊 **0/1** - <:XP:1467192533812645939> **+30.000 XP**"), "progreso y recompensa a la vista")
    assert.ok(!lockedText.includes("~~"), "sin descubrir: sin tachado")
    // Un misterio distinto por Record...
    const mysteries = hiddenCat.records.map(r => r.mystery)
    assert.equal(new Set(mysteries).size, hiddenCat.records.length, "cada oculto con su misterio")
    for (const m of mysteries) assert.ok(lockedText.includes(m), `falta el misterio: ${m}`)
    // ...y la descripción real no se filtra mientras está bloqueado.
    for (const { record } of records.hiddenRecords()) {
        assert.ok(!lockedText.includes(record.label), `filtra etiqueta: ${record.id}`)
        for (const tier of record.tiers) {
            assert.ok(!lockedText.includes(tier.desc), `filtra descripción: ${record.id}`)
        }
    }

    const unlocked = command.buildHiddenBlocks(hiddenCat, new Set(["starboard:1"]), tools.commafy)
    assert.equal(unlocked.length, 5)
    const unlockedText = unlocked.join("\n")
    assert.ok(unlocked[0].includes("Bajo los focos"), "completados arriba, como en el resto")
    assert.ok(unlockedText.includes("### ~~⭐ **Bajo los focos** - 1/1 fase~~"), "desbloqueado tachado")
    assert.ok(unlockedText.includes(`> ~~${star.mystery}~~`), "misterio también al descubrirlo")
    assert.ok(unlockedText.includes("-# ~~📊 **1/1** - <:XP:1467192533812645939> **+30.000 XP**~~"), "progreso y recompensa tachados")
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
    // Cada grupo empieza por su cabecera (sin líneas vacías delante): el
    // container pega la primera al título y el resto van con separador.
    for (const group of groups) {
        assert.ok(group.split("\n")[0].startsWith("###"), `grupo sin cabecera: ${JSON.stringify(group.slice(0, 30))}`)
    }
    const stats = groups.join("\n")
    assert.ok(!stats.includes("Nivel"), "el nivel/XP no pinta aquí")
    assert.ok(!stats.includes("-#"), "estadísticas sin pequeño")
    assert.ok(!stats.includes("General"), "sin grupo general")
    assert.ok(stats.includes("**Mensajes totales:** 10 mensajes"))
    assert.ok(stats.includes("**Mensajes este mes:** 3 msgs (máx. 3)"))
    assert.ok(stats.includes("**Mensajes diarios:** 7 mensajes (máx. 7)"))
    assert.ok(stats.includes("**Reacciones enviadas:** 25 reacciones"))
    assert.ok(stats.includes("**Reacciones recibidas:** 0 reacciones"))
    assert.ok(stats.includes("**Racha:** 0 días (máx. 0 días)"))
    assert.ok(groups[0].includes("### 💬 Actividad"), "cabecera de actividad")
    assert.ok(groups[1].includes("### 🤝 Comunidad"), "cabecera de comunidad")
    assert.ok(groups[2].includes("### 🧭 Canales"), "cabecera de canales")
    assert.ok(groups[3].includes("### 🎙️ Voz"), "cabecera de voz")
    assert.ok(help.includes("XP extra"))
    const [emptyGroups] = command.buildInfoTexts({}, null, new Set(), tools)
    const empty = emptyGroups.join("\n")
    assert.ok(empty.includes("**Mensajes totales:** 0"))
    assert.ok(empty.includes("**Antigüedad:** 0 días"))
    const full = command.buildInfoTexts(
        { messages: 110894, monthlyMessages: 3240, reactionsSent: 250, reactionsReceived: 40,
            streak: { current: 9 }, channels: { a: 1, b: 2 }, countingSent: 120, voiceMinutes: 900 },
        member, new Set(), tools)[0].join("\n")
    assert.ok(full.includes("**Reacciones recibidas:** 40 reacciones"))
    assert.ok(full.includes("**Racha:** 9 días (máx. 9 días)"))
    assert.ok(!full.includes("**Canales con mensajes:**"))
    assert.ok(full.includes("**Números en counting:** 120 números"))
    assert.ok(full.includes("**Tiempo en voz:** 15 horas"))
    assert.ok(full.includes("**Mensajes totales:** 110.894 mensajes"), "con listón apurado cabe completo")
})

test("info stats use singular and adapt the last word to fit mobile", () => {
    const [groups] = command.buildInfoTexts(
        { messages: 1, monthlyMessages: 1, dailyMessages: 1, reactionsSent: 1,
            reactionsReceived: 1, streak: { current: 1, max: 1 }, countingSent: 1, voiceMinutes: 0 },
        null, new Set(), tools)
    const stats = groups.join("\n")
    assert.ok(stats.includes("**Mensajes totales:** 1 mensaje"))
    assert.ok(stats.includes("**Reacciones enviadas:** 1 reacción"))
    assert.ok(stats.includes("**Reacciones recibidas:** 1 reacción"))
    assert.ok(stats.includes("**Racha:** 1 día (máx. 1 día)"))
    assert.ok(stats.includes("**Números en counting:** 1 número"))
    assert.ok(stats.includes("**Tiempo en voz:** 0 minutos"), "con 0 minutos, no 0 horas")
    // Con valores grandes la última palabra se acorta o se omite, sin saltos.
    const [big] = command.buildInfoTexts(
        { messages: 110894, countingSent: 1234, voiceMinutes: 125, reactionsSent: 9999 }, null, new Set(), tools)
    const bigStats = big.join("\n")
    assert.ok(bigStats.includes("**Mensajes totales:** 110.894 mensajes"))
    assert.ok(bigStats.includes("**Números en counting:** 1.234 números"))
    assert.ok(bigStats.includes("**Reacciones enviadas:** 9.999 reaccs"), "unidad corta con etiqueta fija")
    assert.ok(bigStats.includes("**Tiempo en voz:** 2 horas y 5 minutos"), "voz larga en completo")
    for (const line of bigStats.split("\n")) {
        if (!line.trim()) continue
        const limit = line.startsWith("-#") ? MAX_LINE_WIDTH : command.INFO_LINE_WIDTH
        assert.ok(estimateVisualWidth(line.replace(/<@&\d+>/g, "@rol")) <= limit, `salta: ${line}`)
    }
    // Valores pequeños: palabra completa aunque roce el listón (0 números = 31,8).
    const [small] = command.buildInfoTexts(
        { messages: 234, monthlyMessages: 40, countingSent: 0 }, null, new Set(), tools)
    const smallStats = small.join("\n")
    assert.ok(smallStats.includes("**Mensajes totales:** 234 mensajes"))
    assert.ok(smallStats.includes("**Mensajes este mes:** 40 msgs (máx. 40)"))
    assert.ok(smallStats.includes("**Números en counting:** 0 números"))
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
    // Info: título+Actividad(1) + separador(1) + stats+sep(2) + 3 grupos
    // x(cabecera+sep+stats+sep) + menú. Como /top (unos 20), los containers
    // aguantan más de 10 sin problema.
    assert.equal(1 + 1 + 2 + 3 * 4 + 1, 17)
})

test("poketwo catch parses the congrat message", () => {
    const channelId = records.CHANNELS.poketwoChannelId
    const botId = records.CHANNELS.poketwoBotId
    assert.ok(channelId && botId, "faltan IDs de poketwo en CHANNELS")
    const base = { channelId, author: { id: botId, bot: true } }
    const caught = "Congratulations <@879836272615628870>! You caught a Level 21 Slowpoke<:female:1207734084210532483> (53.23%)!"
    assert.equal(tracker.parsePoketwoCatch(caught), "879836272615628870")
    assert.equal(tracker.isPoketwoCatchMessage({ ...base, content: caught }, channelId, botId), "879836272615628870")
    // Un spawn o mensaje normal no cuenta.
    assert.equal(tracker.isPoketwoCatchMessage({ ...base, content: "A wild Pikachu has appeared!" }, channelId, botId), null)
    // Otro canal u otro autor no valen.
    assert.equal(tracker.isPoketwoCatchMessage({ ...base, content: caught }, "otro-canal", botId), null)
    assert.equal(tracker.isPoketwoCatchMessage({ channelId, author: { id: "123" }, content: caught }, channelId, botId), null)
    assert.equal(tracker.parsePoketwoCatch(""), null)
})

test("pokemon progress comes from pokemonCaught", () => {
    const byId = Object.fromEntries(records.allRecords().map(({ record }) => [record.id, record]))
    const commafy = tools.commafy
    assert.deepEqual(byId.pokemon.tiers.map(t => t.threshold), [10, 50, 200])
    assert.equal(command.getProgress(byId.pokemon, {}, null, commafy), null, "sin capturas no hay progreso")
    let p = command.getProgress(byId.pokemon, { pokemonCaught: 7 }, null, commafy)
    assert.equal(p.target, 10)
    assert.ok(Math.abs(p.frac - 0.7) < 1e-9)
    p = command.getProgress(byId.pokemon, { pokemonCaught: 60 }, null, commafy)
    assert.equal(p.target, 200)
    const block = command.buildRecordBlock(byId.pokemon, new Set(), command.getProgress(byId.pokemon, { pokemonCaught: 7 }, null, commafy), commafy)
    assert.ok(block.includes("**Aprendiz** - 0/3 fases"), block.split("\n")[0])
    assert.ok(block.includes("📊 **7/10 pokemons**"), block.split("\n").at(-1))
})

test("unlocked period tiers stay done when the new period starts at 0", () => {
    const byId = Object.fromEntries(records.allRecords().map(({ record }) => [record.id, record]))
    const commafy = tools.commafy
    // Mes nuevo a 0 con la primera fase hecha en septiembre: 1/3, no 0/3.
    // El progreso numérico sigue siendo el de octubre hacia el siguiente.
    let block = command.buildRecordBlock(
        byId.monthly_messages, new Set(["monthly_messages:1000"]),
        command.getProgress(byId.monthly_messages, { monthlyMessages: 0 }, null, commafy), commafy)
    assert.ok(block.includes("- 1/3 fases"), block.split("\n")[0])
    assert.ok(!block.includes("~~"), "sin tachar: aún no está todo hecho")
    // Día nuevo igual.
    block = command.buildRecordBlock(
        byId.daily_messages, new Set(["daily_messages:200"]),
        command.getProgress(byId.daily_messages, { dailyMessages: 0 }, null, commafy), commafy)
    assert.ok(block.includes("- 1/3 fases"), block.split("\n")[0])
    // Todo desbloqueado y periodo a 0: 3/3 tachado.
    block = command.buildRecordBlock(
        byId.monthly_messages,
        new Set(["monthly_messages:1000", "monthly_messages:2000", "monthly_messages:5000"]),
        command.getProgress(byId.monthly_messages, { monthlyMessages: 0, monthlyMessagesMax: 6000 }, null, commafy), commafy)
    assert.ok(block.includes("- 3/3 fases"), block.split("\n")[0])
    assert.ok(block.includes("~~"), "todo hecho: tachado")
    assert.ok(block.includes("📊 **6k/5k mensajes**"), "completado: muestra el máximo histórico")
    // Racha: flag histórico de 30 días con racha actual de 2 también cuenta.
    block = command.buildRecordBlock(
        byId.streak, new Set(["streak:3", "streak:7", "streak:30"]),
        command.getProgress(byId.streak, { streak: { current: 2, max: 30 } }, null, commafy), commafy)
    assert.ok(block.includes("- 3/3 fases"), block.split("\n")[0])
})