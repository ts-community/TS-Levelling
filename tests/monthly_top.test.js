const test = require("node:test")
const assert = require("node:assert/strict")
const MonthlyTop = require("../classes/MonthlyTop.js")

const emojis = { xp: "<:XP:1>", messages: "<:messages:2>" }

function makeUser(id, level = 10, xp = 1000, messages = 10) {
    return { id, level, xp, messages }
}

const snapshot = {
    period: "2026-11",
    members: [
        makeUser("m1", 10, 1000, 10),
        makeUser("m2", 9, 900, 9),
        makeUser("m3", 8, 800, 8),
        makeUser("m4", 7, 700, 7),
        makeUser("m5", 6, 600, 6),
    ],
    staff: [
        makeUser("s1", 20, 2000, 20),
        makeUser("s2", 19, 1900, 19),
        makeUser("s3", 18, 1800, 18),
        makeUser("s4", 17, 1700, 17),
        makeUser("s5", 16, 1600, 16),
    ],
    totals: { members: 5, staff: 5 },
}

test("el top público muestra primero miembros y luego staff", () => {
    const text = MonthlyTop.buildTopText("2026-11", snapshot, emojis)
    assert.match(text, /DESTACADOS DE NOVIEMBRE DE 2026/)
    assert.ok(text.indexOf("### 👥  MIEMBROS DEL MES") < text.indexOf("### 🛡️  STAFF DEL MES"))
})

test("el top 3 lleva emoji delante, XP, mensajes y su rol", () => {
    const text = MonthlyTop.buildTopText("2026-11", snapshot, emojis)
    assert.match(text, /🥇 #1 - <@m1> - Nivel 10\n-# <:XP:1> \*\*1\.000 XP\*\* - <:messages:2> \*\*10 mensajes\*\*\n-# \*\*Rol:\*\* <@&1566503932937638069>/)
    assert.match(text, /🥉 #3 - <@m3> - Nivel 8\n-# <:XP:1> \*\*800 XP\*\* - <:messages:2> \*\*8 mensajes\*\*\n-# \*\*Rol:\*\* <@&1566503994006700062>/)
})

test("el top 4 y 5 sigue el mismo estilo pero solo con mensajes", () => {
    const text = MonthlyTop.buildTopText("2026-11", snapshot, emojis)
    assert.match(text, /🎖️ #4 - <@m4> - <:messages:2> \*\*7 mensajes\*\*\n🎖️ #5 - <@m5> - <:messages:2> \*\*6 mensajes\*\*/)
    assert.doesNotMatch(text, /🎖️ #4[^\n]*(Nivel|XP)/)
})

test("las recompensas de miembros se ven en el cierre y el staff no cobra", () => {
    const rewards = MonthlyTop.buildRewardView(snapshot)
    for (const reward of rewards.members) reward.delivered = true
    assert.deepEqual(MonthlyTop.REWARD_COINS, [250000, 150000, 100000, 50000, 50000])
    assert.equal(rewards.members[0].coins, 250000)
    assert.equal(rewards.members[2].coins, 100000)
    assert.equal(rewards.members[3].coins, 50000)
    assert.equal(rewards.members[4].coins, 50000)
    assert.equal(rewards.staff.length, 0)

    const publicText = MonthlyTop.buildTopText("2026-11", snapshot, emojis, { rewards })
    assert.match(publicText, /### 🎁  RECOMPENSAS DEL MES/)
    assert.match(publicText, /🥇 <@m1> \*\*250\.000 monedas\*\*/)
    assert.match(publicText, /🥉 <@m3> \*\*100\.000 monedas\*\*/)
    assert.match(publicText, /🎖️ <@m4> \*\*50\.000 monedas\*\*/)
    assert.match(publicText, /🎖️ <@m5> \*\*50\.000 monedas\*\*/)
    assert.doesNotMatch(publicText, /-# 🛡️.*monedas/)

    const adminText = MonthlyTop.buildAnnouncementTemplate("2026-11", snapshot, emojis, { rewards })
    assert.match(adminText, /🥇 <@m1> \*\*250\.000 monedas\*\*/)
    assert.doesNotMatch(adminText, /🥇 <@s1> \*\*\+250\.000 monedas\*\*/)
    assert.doesNotMatch(adminText, /ENLACES DE DROPS|Reclamar recompensa/)
})

test("el mensaje muestra la recompensa prevista aunque aún no se haya entregado", () => {
    const rewards = MonthlyTop.buildRewardView(snapshot)
    const text = MonthlyTop.buildTopText("2026-11", snapshot, emojis, { rewards })
    assert.match(text, /🥇 <@m1> \*\*250\.000 monedas\*\*/)
    assert.match(text, /🎖️ <@m5> \*\*50\.000 monedas\*\*/)
})

test("la vista de recompensas reutiliza las monedas guardadas", () => {
    const rewards = MonthlyTop.buildRewardView(snapshot, {
        members: [{ position: 1, userId: "m1", coins: 123, delivered: true }],
    })
    assert.equal(rewards.members[0].coins, 123)
    assert.equal(rewards.members[0].delivered, true)
})

test("entrega las monedas directamente a los ganadores", async () => {
    const Drops = require("../classes/Drops.js")
    const original = { boatEnabled: Drops.boatEnabled, addBoatCoins: Drops.addBoatCoins }
    const calls = []
    const updates = []

    Drops.boatEnabled = () => true
    Drops.addBoatCoins = async (guildId, userId, amount, reason) => {
        calls.push({ guildId, userId, amount, reason })
    }

    const guild = {
        id: "g1",
        members: { fetch: async id => ({ id: String(id), user: { bot: false } }) },
    }
    const client = { db: { update: (id, data) => ({ exec: async () => { updates.push(data) } }) } }

    try {
        const summary = await MonthlyTop.giveMonthlyCoins(client, guild, snapshot, "2026-11")
        assert.equal(summary.given, 5)
        assert.equal(summary.failed, 0)
        assert.equal(calls.length, 5)
        assert.deepEqual(calls[0], {
            guildId: "g1",
            userId: "m1",
            amount: 250000,
            reason: "Top Noviembre de 2026 - Miembro #1",
        })
        assert.equal(summary.rewards.members[0].delivered, true)
        assert.equal(summary.rewards.staff.length, 0)
        assert.equal(updates.at(-1).$set["info.monthlyTop.rewards"].members[4].delivered, true)
    } finally {
        Drops.boatEnabled = original.boatEnabled
        Drops.addBoatCoins = original.addBoatCoins
    }
})

test("no vuelve a entregar monedas ya entregadas", async () => {
    const Drops = require("../classes/Drops.js")
    const original = { boatEnabled: Drops.boatEnabled, addBoatCoins: Drops.addBoatCoins }
    const calls = []

    Drops.boatEnabled = () => true
    Drops.addBoatCoins = async () => { calls.push(true) }

    const rewardsFor = entries => entries.slice(0, MonthlyTop.REWARD_COINS.length).map((user, index) => ({
        position: index + 1,
        userId: user.id,
        coins: MonthlyTop.REWARD_COINS[index],
        delivered: true,
    }))
    const existing = {
        members: rewardsFor(snapshot.members),
    }
    const guild = { id: "g1", members: { fetch: async () => null } }
    const client = { db: { update: () => ({ exec: async () => {} }) } }

    try {
        const summary = await MonthlyTop.giveMonthlyCoins(client, guild, snapshot, "2026-11", existing)
        assert.equal(summary.given, 0)
        assert.equal(summary.skipped, 5)
        assert.equal(calls.length, 0)
        assert.equal(summary.rewards.members[0].delivered, true)
    } finally {
        Drops.boatEnabled = original.boatEnabled
        Drops.addBoatCoins = original.addBoatCoins
    }
})

test("sin economía las monedas quedan pendientes", async () => {
    const Drops = require("../classes/Drops.js")
    const original = { boatEnabled: Drops.boatEnabled, addBoatCoins: Drops.addBoatCoins }
    const calls = []

    Drops.boatEnabled = () => false
    Drops.addBoatCoins = async () => { calls.push(true) }

    try {
        const summary = await MonthlyTop.giveMonthlyCoins(
            { db: { update: () => ({ exec: async () => {} }) } },
            { id: "g1" },
            snapshot,
            "2026-11",
        )
        assert.equal(summary.error, "la economía no está conectada")
        assert.equal(summary.given, 0)
        assert.equal(summary.rewards.members[0].delivered, false)
        assert.equal(calls.length, 0)
    } finally {
        Drops.boatEnabled = original.boatEnabled
        Drops.addBoatCoins = original.addBoatCoins
    }
})

test("la plantilla de anuncio tiene título, apertura, secciones, cierre y @everyone", () => {
    const text = MonthlyTop.buildAnnouncementTemplate("2026-11", snapshot, emojis)
    assert.match(text, /^# 🏆  DESTACADOS DE NOVIEMBRE DE 2026/)
    assert.match(text, /\[MENSAJE DE APERTURA - personalízalo antes de publicar\]/)
    assert.match(text, /\[MENSAJE DE CIERRE - personalízalo antes de publicar\]/)
    assert.match(text, /### 👥  MIEMBROS DEL MES/)
    assert.match(text, /### 🛡️  STAFF DEL MES/)
    assert.ok(text.endsWith("@everyone"))
})

test("los textos de apertura y cierre se pueden personalizar", () => {
    const text = MonthlyTop.buildAnnouncementTemplate("2026-11", snapshot, emojis, {
        opening: "Apertura personalizada",
        closing: "Cierre personalizado",
    })
    assert.match(text, /Apertura personalizada/)
    assert.match(text, /Cierre personalizado/)
    assert.doesNotMatch(text, /MENSAJE DE APERTURA|MENSAJE DE CIERRE/)
})

test("los roles se asignan a los 3 miembros y al único staff del mes", () => {
    const assignments = MonthlyTop.buildRoleAssignments(snapshot)
    assert.deepEqual(assignments, [
        { kind: "members", position: 1, roleId: "1566503932937638069", userId: "m1" },
        { kind: "members", position: 2, roleId: "1566503977728737342", userId: "m2" },
        { kind: "members", position: 3, roleId: "1566503994006700062", userId: "m3" },
        { kind: "staff", position: 1, roleId: "1566503572726882476", userId: "s1" },
    ])
})

test("una categoría vacía se marca como sin actividad", () => {
    const text = MonthlyTop.buildTopText("2026-11", { members: [], staff: snapshot.staff }, emojis)
    assert.match(text, /### 👥  MIEMBROS DEL MES\n-# Sin actividad registrada/)
})

function makeStaffMember(id, displayName, roleIds = [MonthlyTop.STAFF_ROLE_IDS[0]]) {
    return {
        id,
        displayName,
        joinedTimestamp: Number(id.replace(/\D/g, "")) || 0,
        user: { bot: false, username: displayName },
        roles: { cache: { some: predicate => roleIds.some(roleId => predicate({ id: roleId })) } },
    }
}

test("la votación solo nomina staff y ordena por actividad del mes", () => {
    const members = new Map([
        ["s1", makeStaffMember("s1", "Staff Uno")],
        ["s2", makeStaffMember("s2", "Staff Dos")],
        ["m1", makeStaffMember("m1", "Miembro", [])],
    ])
    const server = {
        users: {
            s1: { monthlyPeriod: "2026-11", monthlyXP: 10, monthlyMessages: 3, xp: 100 },
            s2: { monthlyPeriod: "2026-11", monthlyXP: 20, monthlyMessages: 1, xp: 200 },
            m1: { monthlyPeriod: "2026-11", monthlyXP: 999, monthlyMessages: 99, xp: 999 },
        },
    }

    const candidates = MonthlyTop.buildStaffCandidates(server, members, "2026-11")
    assert.deepEqual(candidates.map(candidate => candidate.id), ["s2", "s1"])
    assert.equal(candidates[0].monthlyXP, 20)
})

test("la votación explica cierre, desempate y que el staff no cobra", () => {
    const text = MonthlyTop.buildStaffVoteContent(
        "2026-11",
        new Date("2026-11-30T22:59:00Z"),
        2,
        2,
    )
    assert.match(text, /^@everyone/)
    assert.match(text, /STAFF DEL MES - NOVIEMBRE DE 2026/)
    assert.match(text, /más XP mensual/)
    assert.match(text, /no incluye monedas/)
    assert.match(text, /Un solo voto por persona/)
})

test("el ganador de la votación se decide sin empates", async () => {
    const vote = {
        period: "2026-11",
        channelId: "vote-channel",
        messageId: "poll-message",
        candidates: [
            { id: "s1", label: "Staff Uno", joinedTimestamp: 1 },
            { id: "s2", label: "Staff Dos", joinedTimestamp: 2 },
        ],
        results: [],
    }
    const server = {
        info: { monthlyStaffVote: vote },
        users: {
            s1: { monthlyPeriod: "2026-11", monthlyXP: 10, monthlyMessages: 1, xp: 100 },
            s2: { monthlyPeriod: "2026-11", monthlyXP: 20, monthlyMessages: 1, xp: 100 },
        },
    }
    const message = {
        poll: {
            resultsFinalized: true,
            answers: new Map([
                [1, { id: 1, text: "Staff Uno", voteCount: 5 }],
                [2, { id: 2, text: "Staff Dos", voteCount: 5 }],
            ]),
        },
    }
    const channel = {
        id: "vote-channel",
        guild: { id: "g1" },
        isTextBased: () => true,
        messages: { fetch: async () => message },
    }
    const client = {
        channels: { fetch: async () => channel },
        db: { update: () => ({ exec: async () => {} }) },
    }

    const result = await MonthlyTop.resolveStaffVote(client, { id: "g1" }, server, "2026-11")
    assert.equal(result.winnerId, "s2")
    assert.equal(result.tieBreak, true)
    assert.equal(result.winnerVotes, 5)
})

test("la encuesta se publica con ping, respuestas y guarda el mensaje", async () => {
    const members = new Map([
        ["s1", makeStaffMember("s1", "Staff Uno")],
        ["s2", makeStaffMember("s2", "Staff Dos")],
    ])
    const server = { info: {}, users: {} }
    const updates = []
    let sent = null
    const channel = {
        id: MonthlyTop.STAFF_VOTE_CHANNEL_ID,
        guild: { id: "g1" },
        isTextBased: () => true,
        send: async payload => {
            sent = payload
            return { id: "poll-message" }
        },
    }
    const client = {
        channels: { fetch: async () => channel },
        db: { update: (id, data) => ({ exec: async () => { updates.push({ id, data }) } }) },
    }

    const result = await MonthlyTop.startStaffVote(
        client,
        { id: "g1" },
        server,
        members,
        "2026-11",
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    )

    assert.equal(result.vote.messageId, "poll-message")
    assert.equal(sent.poll.allowMultiselect, true)
    assert.equal(sent.poll.answers.length, 2)
    assert.ok(sent.allowedMentions.parse.includes("everyone"))
    assert.match(sent.content, /@everyone/)
    assert.equal(updates[0].data.$set["info.monthlyStaffVote"].period, "2026-11")
})
