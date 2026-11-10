const test = require('node:test')
const assert = require('node:assert/strict')
const rank = require('../commands/slash/rank.js')
const button = require('../commands/button/rank_style.js')
const { MessageFlags } = require('discord.js')
const owner = '123456789012345678', target = '234567890123456789'

test('protege y guarda la preferencia del autor, conservando el miembro consultado', async () => {
    let reply, saved, rendered
    await button.run({}, { customId: `rank_style~${owner}~${target}~old`, user: { id: target }, reply: async p => { reply = p } }, {})
    assert.equal(reply.flags, MessageFlags.Ephemeral)
    const original = rank.run
    rank.run = async (...args) => { rendered = args[3] }
    try {
        await button.run({ db: { update: (guild, data) => ({ exec: async () => { saved = data } }) } }, {
            customId: `rank_style~${owner}~${target}~old`, user: { id: owner }, guild: { id: 'guild' }, deferUpdate: async () => {}
        }, {})
        assert.deepEqual(saved, { $set: { [`users.${owner}.rankStyle`]: 'old' } })
        assert.deepEqual(rendered, { targetId: target, style: 'old', update: true })
    } finally { rank.run = original }
})
for (const preference of [undefined, 'old', 'new']) {
  for (const update of [false, true]) {
    test(`renderiza estilo ${preference || 'predeterminado'} (${update ? 'botón' : 'comando'})`, async () => {
        let payload
        const member = { id: target, displayName: 'Miembro', displayAvatarURL: () => 'https://example.com/avatar.png' }
        const tools = {
            getTargetUser: () => null, resolveTargetMember: async () => ({ member }),
            fetchAll: async () => ({ users: { [owner]: { rankStyle: preference }, [target]: { xp: 1000 } }, settings: { enabled: true, rankCard: {}, rewards: [], gain: { min: 10, max: 20 } } }),
            getLevel: () => ({ level: 10, xpRequired: 1100, previousLevel: 900 }), commafy: String,
            getMessages: () => 10, getMonthlyMessages: () => 5,
            getRolesForLevel: () => [{ id: '1168639778405752872' }], getLeaderboard: () => [{ id: target, xp: 1000 }],
            getMultiplier: () => ({ multiplier: 1, roleList: [], channelList: [] }), getRecordsCompleted: () => 0
        }
        await rank.run({}, { user: { id: owner }, guild: { id: 'guild' }, deferred: update, deferReply: async () => {}, editReply: async p => { assert.equal(update, false); payload = p }, message: { edit: async p => { assert.equal(update, true); payload = p } } }, tools, { update })
        const json = JSON.stringify(payload.components.map(c => c.toJSON()))
        const modern = preference !== 'old'
        assert.ok(json.includes(modern ? 'Cambiar a Vista Legacy' : 'Cambiar a Vista Predeterminada'))
        assert.ok(json.includes(`rank_style~${owner}~${target}~${modern ? 'old' : 'new'}`))
        assert.equal(json.includes('attachment://rank-icon.webp'), false)
        assert.ok(json.includes('https://example.com/avatar.png'))
        const role = require('../consts/ranks.js').find(r => r.rank === 'masters').roles[0]
        const emoji = modern ? role.emoji : role.legacyEmoji
        assert.ok(json.includes(`## ${emoji} <@&${role.id}>`))
        const components = payload.components[0].toJSON().components
        const button = components[components.length - 1].components[0]
        const destinationEmoji = modern ? role.legacyEmoji : role.emoji
        assert.equal(button.emoji.id, destinationEmoji.match(/:(\d+)>/)[1])
        assert.equal(payload.files.length, 1)
        assert.equal(json.includes('attachment://masters.webp'), true)
        assert.equal(payload.components[0].toJSON().accent_color, modern ? 0x62d64a : 0xf59e0b)
    })
}

}

test('cambia la tarjeta existente sin recalcular ni volver a subir adjuntos', async () => {
    const tier = require('../consts/ranks').find(r => r.rank === 'pro')
    const role = tier.roles[0]
    let edited, saved = false
    const container = { type: 17, components: [
        { type: 9, components: [{ type: 10, content: `## ${role.emoji} <@&${role.id}> #3` }] },
        { type: 1, components: [{ type: 2, custom_id: `rank_style~${owner}~${target}~old` }] }
    ] }
    await button.run({ db: { update: () => ({ exec: async () => { saved = true } }) } }, {
        customId: `rank_style~${owner}~${target}~old`, user: { id: owner }, guild: { id: 'guild' },
        deferUpdate: async () => {},
        message: { components: [{ toJSON: () => container }], edit: async payload => { edited = payload } }
    }, { fetchAll: () => { throw Error('No debe recalcular') } })
    assert.equal(saved, true)
    assert.equal(edited.files, undefined)
    assert.equal(edited.attachments, undefined)
    assert.ok(edited.components[0].components[0].components[0].content.includes(role.legacyEmoji))
    assert.equal(edited.components[0].components[1].components[0].label, 'Cambiar a Vista Predeterminada')
    assert.equal(edited.components[0].accent_color, 0x008f39)
})
