const test = require('node:test')
const assert = require('node:assert/strict')
const route = require('../routes/rank_style')
const guildID = '1093864130030612521', userId = '123456789012345678'
function response() { return { statusCode: 200, status(n) { this.statusCode = n; return this }, set() {}, json(body) { this.body = body; return this } } }
test('la web usa nuevos por defecto y lee la preferencia de Discord', async () => {
    for (const stored of [undefined, 'old', 'new']) {
        const res = response()
        await route({ db: { fetch: async () => ({ users: { [userId]: { rankStyle: stored } } }) } }, async () => [{ id: userId }, [{ id: guildID }]])({ method: 'GET', query: { guildID } }, res)
        assert.equal(res.body.style, stored === 'old' ? 'old' : 'new')
    }
})
test('guarda solo en el usuario autenticado, ignorando un ID ajeno', async () => {
    let update
    const res = response()
    await route({ db: { update: (id, data) => ({ exec: async () => { update = data } }) } }, async () => [{ id: userId }, [{ id: guildID }]])({ method: 'POST', body: { guildID, style: 'old', userId: 'otro' } }, res)
    assert.deepEqual(update, { $set: { [`users.${userId}.rankStyle`]: 'old' } })
    assert.equal(res.body.style, 'old')
})
test('rechaza estilos inválidos, usuarios sin sesión y miembros de otro servidor', async () => {
    for (const scenario of [
        { body: { guildID, style: 'invalid' }, auth: [null, null], status: 400 },
        { body: { guildID, style: 'old' }, auth: [null, null], status: 401 },
        { body: { guildID, style: 'old' }, auth: [{ id: userId }, []], status: 403 }
    ]) {
        const res = response()
        await route({}, async () => scenario.auth)({ method: 'POST', body: scenario.body }, res)
        assert.equal(res.statusCode, scenario.status)
    }
})
