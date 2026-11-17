// Bounded, expiring cache with one in-flight read per key. Failed reads are retryable.
module.exports = function createAsyncCache({ ttl = 60000, max = 2000, now = Date.now } = {}) {
    const values = new Map(), pending = new Map()
    return {
        async get(key, fetchValue) {
            const hit = values.get(key)
            if (hit && hit.expires > now()) return hit.value
            values.delete(key)
            if (pending.has(key)) return pending.get(key)
            const task = Promise.resolve().then(fetchValue).then(value => {
                if (value && pending.get(key) === task) {
                    if (values.size >= max) values.delete(values.keys().next().value)
                    values.set(key, { value, expires: now() + ttl })
                }
                return value
            }).finally(() => { if (pending.get(key) === task) pending.delete(key) })
            pending.set(key, task)
            return task
        },
        delete(key) { values.delete(key); pending.delete(key) }
    }
}
