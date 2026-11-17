const test = require('node:test')
const assert = require('node:assert/strict')
const createCache = require('../classes/AsyncCache')
test('identity reads share work, expire, isolate sessions and retry failures', async () => {
 let time = 0, calls = 0
 const cache = createCache({ ttl: 100, now: () => time })
 const read = async () => { calls++; return { id: 'a' } }
 const results = await Promise.all(Array.from({ length: 20 }, () => cache.get('a', read)))
 assert.equal(calls, 1)
 assert.ok(results.every(r => r.id === 'a'))
 await cache.get('a', read); assert.equal(calls, 1)
 await cache.get('b', read); assert.equal(calls, 2)
 time = 101; await cache.get('a', read); assert.equal(calls, 3)
 cache.delete('a'); await cache.get('a', read); assert.equal(calls, 4)
 await assert.rejects(cache.get('error', () => Promise.reject(new Error('offline'))))
 assert.equal(await cache.get('error', () => 'ok'), 'ok')
 assert.equal(await cache.get('null', () => null), null)
 assert.equal(await cache.get('null', () => 'recovered'), 'recovered')
})
test('logout during a read prevents repopulating the cache', async () => {
 const cache = createCache()
 let resolve
 const pending = cache.get('session', () => new Promise(r => { resolve = r }))
 await Promise.resolve()
 cache.delete('session'); resolve('old'); await pending
 assert.equal(await cache.get('session', () => 'new'), 'new')
})
