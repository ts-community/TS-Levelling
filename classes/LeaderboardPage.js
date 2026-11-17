// First batch may be larger than subsequent batches, without overlaps.
module.exports = function leaderboardPage(total, query = {}) {
 const number = (value, fallback) => { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? n : fallback }
 const pageSize = Math.max(1, Math.min(100, number(query.pageSize, 100)))
 const initialSize = Math.max(1, Math.min(100, number(query.initialSize, pageSize)))
 const page = Math.max(1, number(query.page, 1))
 const pageCount = total ? 1 + Math.ceil(Math.max(0, total - initialSize) / pageSize) : 0
 const start = page === 1 ? 0 : initialSize + (page - 2) * pageSize
 return { page, pageSize, pageCount, start, end: start + (page === 1 ? initialSize : pageSize) }
}
