const { base, renderPageMeta, escapeHtml } = require('./page-meta')

function renderDropStaffPage({ title, status, code, created, creator, elapsed, claimed, capacity, page, pages, members, details, publicUrl, staffUrl }) {
    const e = escapeHtml
    const pageUrl = n => e(staffUrl + '&claimsPage=' + n)
    const rows = members.map(({ id, name, avatar, date }) => {
        const safeAvatar = /^https:\/\/cdn\.discordapp\.com\//.test(avatar || '') ? avatar : '/assets/avatar.png'
        return '<tr><td><div class="member"><img src="' + e(safeAvatar) + '" width="36" height="36" loading="lazy" decoding="async" alt=""><div><strong>' + e(name || id) + '</strong><small>' + e(id) + '</small></div></div></td><td>' + e(date || 'Sin fecha registrada') + '</td></tr>'
    }).join('')
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${renderPageMeta({ title: title + ' · Staff', description: 'Panel privado de seguimiento de drops.', url: base + publicUrl })}
<link rel="icon" href="/assets/favicon-48.png">
<style>
:root{color-scheme:dark;--bg:#0b0d11;--surface:#13161d;--line:#292e39;--text:#edf0f5;--muted:#a4adbb;--accent:#74e9d3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}
header,.wrap{max-width:1040px;margin:auto;padding:0 24px}
header{display:flex;align-items:center;gap:12px;padding-block:18px;border-bottom:1px solid var(--line)}
header img{border-radius:9px}header small{display:block;color:var(--muted)}
.wrap{padding-block:32px}h1{font-size:clamp(1.75rem,4vw,2.65rem);line-height:1.08;margin:12px 0;overflow-wrap:anywhere}
h2{font-size:1.05rem;margin:0 0 12px}.summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.status{display:inline-block;padding:4px 10px;border-radius:99px;background:#17382f;color:var(--accent);font-weight:650}
.status.closed{background:#34282b;color:#ffb4aa}code,small,.muted{color:var(--muted)}
.metrics,.details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}
.metrics div,.detail,.claims{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;overflow-wrap:anywhere}
.metrics span,.detail>span,.detail small,.member small{display:block;color:var(--muted)}
.metrics strong,.detail>strong{display:block;margin-top:5px}.metrics strong{font-size:1.22rem}
.rewardRow{display:flex;justify-content:space-between;gap:8px;padding-block:5px}
.claims{margin-top:20px}.claimHead,nav{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.claimHead h2{margin:0}table{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:14px}
th,td{text-align:left;padding:10px 4px;border-top:1px solid var(--line);overflow-wrap:anywhere}th:first-child{width:65%}
.member{display:flex;align-items:center;gap:10px}.member img{border-radius:50%;flex:none;background:#222833}
nav{justify-content:flex-start;margin-top:12px}a{color:var(--accent);text-underline-offset:.2em}
a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
@media(max-width:560px){header,.wrap{padding-inline:14px}.wrap{padding-block:22px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics div:last-child{grid-column:1/-1}.details{grid-template-columns:1fr}.claims{padding:12px}.member img{width:30px;height:30px}}
</style></head>
<body>
<header><img src="/assets/server-icon-128.webp" alt="" width="36" height="36"><div><strong>TS Community Brawl</strong><small>Panel del staff · Drops</small></div></header>
<main class="wrap">
<div class="summary"><span class="status${status === 'Activo' ? '' : ' closed'}">${e(status)}</span><code>${e(code)}</code></div>
<h1>${e(title)}</h1>
<p class="muted">Creado el ${e(created)} · ${e(creator)}</p>
<section class="metrics" aria-label="Resumen del drop">
<div><span>Reclamados</span><strong>${claimed} / ${capacity}</strong></div>
<div><span>Disponibles</span><strong>${Math.max(0, capacity - claimed)}</strong></div>
<div><span>Tiempo transcurrido</span><strong>${e(elapsed)}</strong></div>
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
</section></main></body></html>`
}

module.exports = renderDropStaffPage
