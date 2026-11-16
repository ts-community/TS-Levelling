// La corrección solo afecta al bot; la fecha de Discord permanece intacta.
function getTenureTimestamp(userData, member) {
    const override = Number(userData?.tenureSince)
    if (Number.isFinite(override) && override > 0) return override
    const joined = Number(member?.joinedTimestamp)
    return Number.isFinite(joined) && joined > 0 ? joined : null
}

// Fecha civil explícita, sin aceptar normalizaciones como 31 de febrero.
function parseTenureDate(value, now = Date.now()) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const timestamp = Date.parse(`${value}T00:00:00.000Z`)
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) return null
    return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null
}

module.exports = { getTenureTimestamp, parseTenureDate }
