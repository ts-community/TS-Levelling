const { base, renderPageMeta, escapeHtml } = require('./page-meta')

function renderDropStaffPage({ title, status, code, created, creator, elapsed, claimed, capacity, page, pages, members, details, publicUrl, staffUrl, drops, expiresAt, expiryLabel }) {
    const e = escapeHtml
    const pageUrl = n => e(staffUrl + '&claimsPage=' + n)
    const rows = members.map(({ id, name, avatar, date }) => {
        const safeAvatar = /^https:\/\/cdn\.discordapp\.com\//.test(avatar || '') ? avatar : '/assets/avatar.png'
        return '<tr><td><div class="member"><img src="' + e(safeAvatar) + '" width="36" height="36" loading="lazy" decoding="async" alt=""><div><strong>' + e(name || id) + '</strong><small>' + e(id) + '</small></div></div></td><td>' + e(date || 'Sin fecha registrada') + '</td></tr>'
    }).join('')
    const list = drops.map(drop => `
        <li><a href="${e(drop.url)}"${drop.code === code ? ' aria-current="page"' : ''}>
            <strong>${e(drop.name || drop.code)}</strong>
            <span><code>${e(drop.code)}</code><small>${e(drop.status)}</small></span>
        </a></li>`).join('')
    const hasExpiry = Number.isFinite(expiresAt) && expiresAt > 0
    const expired = hasExpiry && expiresAt <= Date.now()
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${renderPageMeta({ title: title, description: 'Consulta los repartos y sus reclamaciones.', url: base + publicUrl })}
<link rel="icon" href="/assets/favicon-48.png">
<style>
:root{color-scheme:dark;--bg:#0b0d11;--surface:#13161d;--line:#292e39;--text:#edf0f5;--muted:#a4adbb;--accent:#74e9d3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}
.brand{max-width:1320px;margin:auto;display:flex;align-items:center;gap:12px;padding:17px 24px}
.brandbar{border-bottom:1px solid var(--line);background:#101219}
.brand img{border-radius:9px}.brand small{display:block;color:var(--muted)}
.layout{max-width:1320px;margin:auto;display:grid;grid-template-columns:minmax(220px,265px) minmax(0,1fr);gap:28px;padding:28px 24px 48px;align-items:start}
.wrap{min-width:0}h1{font-size:clamp(1.75rem,4vw,2.65rem);line-height:1.08;margin:12px 0;overflow-wrap:anywhere}
.dropNav{position:sticky;top:20px;background:#101219;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.dropNav h2{display:flex;justify-content:space-between;align-items:center;padding:14px 14px 10px;margin:0}
.dropNav ul{list-style:none;margin:0;padding:4px 8px 8px;max-height:calc(100dvh - 160px);overflow:auto;overscroll-behavior:contain}
.dropNav li+li{margin-top:4px}
.dropNav a{display:block;text-decoration:none;color:var(--text);padding:10px;border:1px solid transparent;border-radius:9px}
.dropNav a:hover{background:#1a1e27}
.dropNav a[aria-current]{background:#162a28;border-color:#35665e}
.dropNav a strong{display:block;overflow-wrap:anywhere;font-size:.9rem}
.dropNav a span{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:4px}
.dropNav a small{font-size:.75rem}.dropNav a[aria-current] small{color:var(--accent)}
h2{font-size:1.05rem;margin:0 0 12px}.summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.status{display:inline-block;padding:4px 10px;border-radius:99px;background:#17382f;color:var(--accent);font-weight:650}
.status.closed{background:#34282b;color:#ffb4aa}code,small,.muted{color:var(--muted)}
.metrics,.details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:20px 0}
.metrics{grid-template-columns:repeat(4,minmax(0,1fr))}
.metrics div,.detail,.claims{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;overflow-wrap:anywhere}
.metrics span,.detail>span,.detail small,.member small{display:block;color:var(--muted)}
.metrics strong,.detail>strong{display:block;margin-top:5px}.metrics strong{font-size:1.22rem}
.metrics .expiry{background:#14211f;border-color:#284941}
.expiry strong{font-variant-numeric:tabular-nums;color:var(--accent)}
.expiry time{font-size:.78rem;color:var(--muted)}
.rewardRow{display:flex;justify-content:space-between;gap:8px;padding-block:5px}
.claims{margin-top:20px}.claimHead,nav{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.claimHead h2{margin:0}table{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:14px}
th,td{text-align:left;padding:10px 4px;border-top:1px solid var(--line);overflow-wrap:anywhere}th:first-child{width:65%}
.member{display:flex;align-items:center;gap:10px}.member img{border-radius:50%;flex:none;background:#222833}
nav{justify-content:flex-start;margin-top:12px}a{color:var(--accent);text-underline-offset:.2em}
a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
@media(max-width:1000px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:740px){.brand,.layout{padding-inline:14px}.layout{grid-template-columns:1fr;gap:18px;padding-top:16px}.dropNav{position:static}.dropNav ul{max-height:190px}.details{grid-template-columns:1fr}.claims{padding:12px}.member img{width:30px;height:30px}}
</style></head>
<body>
<header class="brandbar"><div class="brand"><img src="/assets/server-icon-128.webp" alt="" width="36" height="36"><div><strong>TS Community Brawl</strong><small>Drops</small></div></div></header>
<div class="layout">
<aside class="dropNav" aria-labelledby="dropNavTitle">
<h2 id="dropNavTitle">Drops creados <small>${drops.length}</small></h2>
<ul>${list}</ul>
</aside>
<main class="wrap">
<div class="summary"><span id="dropStatus" class="status${status === 'Activo' ? '' : ' closed'}">${e(status)}</span><code>${e(code)}</code></div>
<h1>${e(title)}</h1>
<p class="muted">Creado el ${e(created)} · ${e(creator)}</p>
<section class="metrics" aria-label="Resumen del drop">
<div><span>Reclamados</span><strong>${claimed} / ${capacity}</strong></div>
<div><span>Disponibles</span><strong>${Math.max(0, capacity - claimed)}</strong></div>
<div><span>Tiempo transcurrido</span><strong>${e(elapsed)}</strong></div>
<div class="expiry">
    <span id="dropExpiryLabel">${expired ? 'Caducó' : 'Caduca en'}</span>
    <strong id="dropExpiry"${hasExpiry && !expired ? ' data-deadline="' + expiresAt + '"' : ''}>${expired ? e(expiryLabel) : hasExpiry ? e(formatRemaining(expiresAt)) : 'Sin fecha'}</strong>
    ${hasExpiry && !expired ? '<time datetime="' + new Date(expiresAt).toISOString() + '">' + e(expiryLabel) + ' (Madrid)</time>' : ''}
</div>
</section>
<div class="details">${details}</div>
<section class="claims">
<div class="claimHead"><h2>Reclamaciones</h2><span class="muted">Página ${page} de ${pages}</span></div>
<table><thead><tr><th scope="col">Miembro</th><th scope="col">Fecha</th></tr></thead><tbody>${rows || '<tr><td colspan="2">Nadie ha reclamado todavía.</td></tr>'}</tbody></table>
<nav aria-label="Reclamaciones">
${page > 1 ? '<a href="' + pageUrl(page - 1) + '">Anterior</a>' : ''}
${page < pages ? '<a href="' + pageUrl(page + 1) + '">Siguiente</a>' : ''}
<a href="${pageUrl(page)}">Actualizar</a>
<a href="${e(publicUrl)}">Abrir vista de reclamación</a>
</nav>
</section></main></div>
<script>
const clock = document.querySelector('[data-deadline]')
if (clock) {
    const formatRemaining = ${formatRemaining.toString()}
    const refresh = () => {
        const deadline = Number(clock.dataset.deadline)
        if (document.hidden) return
        const text = formatRemaining(deadline)
        if (clock.textContent !== text) clock.textContent = text
        if (deadline <= Date.now()) {
            clearInterval(timer)
            document.getElementById('dropExpiryLabel').textContent = 'Caducidad'
            const status = document.getElementById('dropStatus')
            status.textContent = 'Caducado'
            status.classList.add('closed')
        }
    }
    const timer = setInterval(refresh, 1000)
    document.addEventListener('visibilitychange', refresh)
}
</script></body></html>`
}

function formatRemaining(deadline) {
    const seconds = Math.ceil((deadline - Date.now()) / 1000)
    if (seconds <= 0) return 'Caducado'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor(seconds % 3600 / 60)
    if (hours >= 24) return Math.floor(hours / 24) + ' d ' + hours % 24 + ' h'
    if (hours) return hours + ' h ' + minutes + ' min'
    return minutes + ' min ' + String(seconds % 60).padStart(2, '0') + ' s'
}

module.exports = renderDropStaffPage
