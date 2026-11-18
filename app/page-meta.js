const base = 'https://niveles.tscomunity.es'
const brand = 'TS Community Brawl'
const image = base + '/assets/og-niveles.png?v=1'

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char])
}

function renderPageMeta({ title, description, url, index = false }) {
    const name = escapeHtml(title + ' - ' + brand)
    const summary = escapeHtml(description)
    const canonical = escapeHtml(url)
    return [
        '<title>' + name + '</title>',
        '<meta name="description" content="' + summary + '">',
        '<meta name="robots" content="' + (index ? 'index, follow' : 'noindex, nofollow') + '">',
        '<link rel="canonical" href="' + canonical + '">',
        '<meta property="og:type" content="website">',
        '<meta property="og:locale" content="es_ES">',
        '<meta property="og:site_name" content="' + brand + '">',
        '<meta property="og:title" content="' + name + '">',
        '<meta property="og:description" content="' + summary + '">',
        '<meta property="og:url" content="' + canonical + '">',
        '<meta property="og:image" content="' + image + '">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="Sistema de niveles de ' + brand + '">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="' + name + '">',
        '<meta name="twitter:description" content="' + summary + '">',
        '<meta name="twitter:image" content="' + image + '">',
    ].join('\n    ')
}

function applyPageMeta(html, options) {
    return html.replace(/<title>[^<]*<\/title>|<meta (?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>|<link rel="canonical"[^>]*>/g, '')
        .replace('</head>', () => renderPageMeta(options) + '\n</head>')
}

module.exports = { base, escapeHtml, renderPageMeta, applyPageMeta }
