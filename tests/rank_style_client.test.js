const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const html = fs.readFileSync(require('node:path').join(__dirname, '../app/html/leaderboard.html'), 'utf8')
const source = html.slice(html.indexOf('let rankIconStyle ='), html.indexOf('let rankIconFrame ='))

function load(storage, serverStyle = 'new') {
    const buttons = ['old', 'new'].map(style => {
        const image = { src: '', hidden: true, getAttribute() { return this.src }, setAttribute(_, value) { this.src = value }, removeAttribute() { this.src = '' } }
        return {
            dataset: { rankStyle: style }, style: { setProperty() {} }, image,
            setAttribute(name, value) { this[name] = value },
            querySelector() { return image },
            addEventListener(_, handler) { this.click = handler }
        }
    })
    let writes = 0
    let reads = 0
    const context = {
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        document: { querySelectorAll: selector => selector === '[data-rank-style]' ? buttons : [] },
        Fetch: async () => { reads++; return { style: serverStyle } },
        rankStyleInitialRequest: null,
        fetch: async () => { writes++; return { ok: true, json: async () => ({ style: storage.get('ts_rank_icon_style') }) } },
        guildID: '1093864130030612521',
        alert: () => {}
    }
    vm.createContext(context)
    vm.runInContext(source, context)
    return { buttons, context, get reads() { return reads }, get writes() { return writes } }
}

test('al entrar usa la vista guardada en Discord aunque el navegador tenga otra', async () => {
    const storage = new Map([['ts_rank_icon_style', 'new']])
    const reload = load(storage, 'old')
    await vm.runInContext('rankStyleLoggedIn = true; syncRankIconStyle()', reload.context)
    assert.equal(reload.reads, 1)
    assert.equal(reload.buttons[0]['aria-pressed'], 'true')
    assert.equal(storage.get('ts_rank_icon_style'), 'old')
})

test('reintenta un guardado pendiente después de recargar', async () => {
    const storage = new Map([['ts_rank_icon_style', 'old'], ['ts_rank_icon_style_pending', 'old']])
    const page = load(storage)
    vm.runInContext('rankStyleLoggedIn = true; rankStylePending = localStorage.getItem("ts_rank_icon_style_pending"); saveRankIconStyle()', page.context)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(page.writes, 1)
    assert.equal(storage.has('ts_rank_icon_style_pending'), false)
})

test('sin rol de rango no muestra el icono de Maestros', () => {
    const page = load(new Map())
    vm.runInContext('setRankIconForUser({ roles: [] }, [{ id: "maestro", level: 100 }], [{ id: "maestro", name: "Maestro I" }])', page.context)
    assert.equal(page.buttons[0].image.hidden, true)
    assert.equal(page.buttons[1].image.src, '')
})

test('el selector usa el rango que tiene el usuario', () => {
    const page = load(new Map())
    vm.runInContext('setRankIconForUser({ roles: ["bronce"] }, [{ id: "bronce", level: 10 }, { id: "maestro", level: 100 }], [{ id: "bronce", name: "Bronce II" }, { id: "maestro", name: "Maestro I" }])', page.context)
    assert.match(page.buttons[1].image.src, /bronze_II\.webp/)
    assert.equal(page.buttons[1].image.hidden, false)
})
