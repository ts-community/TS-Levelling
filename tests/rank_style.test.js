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
        assert.ok(json.includes(modern ? 'Iconos clásicos' : 'Iconos nuevos'))
        assert.ok(json.includes(`rank_style~${owner}~${target}~${modern ? 'old' : 'new'}`))
        assert.equal(json.includes('attachment://rank-icon.webp'), false)
        assert.ok(json.includes('https://example.com/avatar.png'))
        const role = require('../consts/ranks.js').find(r => r.rank === 'masters').roles[0]
        const emoji = modern ? role.emoji : role.legacyEmoji
        assert.ok(json.includes(`## ${emoji} <@&${role.id}>`))
        assert.equal(payload.files.length, modern ? 0 : 1)
        assert.equal(json.includes('attachment://masters.webp'), !modern)
        assert.equal(payload.components[0].toJSON().accent_color, modern ? 0x62d64a : 0xf59e0b)
    })
}

}
