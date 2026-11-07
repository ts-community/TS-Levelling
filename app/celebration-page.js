// Página "celebración" compartida por /easteregg y los drops (/drop/<guild>/<CODE>).
// Un solo render: fondo animado, tarjeta cristal con rejilla que se ilumina
// bajo el cursor + tilt 3D, anillo con icono SVG, barra superior con colores
// en deriva, confetti DETRÁS de la tarjeta y botones simples.
//
// status → paleta completa (fondo, acentos, confetti):
//   info | success | claimed | expired | login | error | warning | easter
// celebration: false | true (burst al conseguirlo, luego lluvia suave tarde)
//              | "soft" (solo lluvia suave, con retardo).

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}

// Iconos SVG (trazo), por nombre. Sin emojis.
// egg · gift · trophy · check · search · hourglass · lock · login · soldout · shield · alert
const ICONS = {
    // f = relleno suave (duotono, del color del estado) · s = trazo
    egg: {
        f: '<path d="M12 2.8c-3.8 0-6.8 5.2-6.8 10.3 0 5 3 8.6 6.8 8.6s6.8-3.6 6.8-8.6C18.8 8 15.8 2.8 12 2.8z"/>',
        s: '<path d="M12 2.8c-3.8 0-6.8 5.2-6.8 10.3 0 5 3 8.6 6.8 8.6s6.8-3.6 6.8-8.6C18.8 8 15.8 2.8 12 2.8z"/><path d="M5.4 13.6l2.2-1.7 2.2 1.7 2.2-1.7 2.2 1.7 2.2-1.7 2.2 1.7"/><path d="M9.3 17.5h.01M14.7 17.5h.01M12 18.8h.01"/><path d="M9 8.2c.4-1.3 1.1-2.3 2-2.9"/><path d="M20.5 2.5v3M19 4h3"/><path d="M3.5 5.5v2.2M2.4 6.6h2.2"/>',
    },
    gift: {
        f: '<rect x="3.5" y="10" width="17" height="11" rx="2"/>',
        s: '<rect x="2.5" y="7" width="19" height="4" rx="1.3"/><path d="M4.5 11v8a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-8"/><path d="M12 7v14"/><path d="M12 7C10.6 7 7 6.6 7 4.6 7 3.4 7.9 2.7 9 2.7c1.9 0 3 1.7 3 4.3zm0 0c1.4 0 5-.4 5-2.4 0-1.2-.9-1.9-2-1.9-1.9 0-3 1.7-3 4.3z"/>',
    },
    trophy: {
        f: '<path d="M7.5 3.5h9v6a4.5 4.5 0 0 1-9 0z"/>',
        s: '<path d="M7.5 3.5h9v6a4.5 4.5 0 0 1-9 0z"/><path d="M16.5 5H20v1.6A3.4 3.4 0 0 1 16.6 10M7.5 5H4v1.6A3.4 3.4 0 0 0 7.4 10"/><path d="M12 14v4M8.5 21h7M9.5 18h5"/>',
    },
    check: {
        f: '<circle cx="12" cy="12" r="9.5"/>',
        s: '<circle cx="12" cy="12" r="9.5"/><path d="M7.6 12.4l3 3 5.8-6.2"/>',
    },
    search: {
        f: '<circle cx="10.5" cy="10.5" r="7.2"/>',
        s: '<circle cx="10.5" cy="10.5" r="7.2"/><path d="M21 21l-5.4-5.4"/><path d="M8 8l5 5M13 8l-5 5"/>',
    },
    // Reloj de arena: arena arriba, chorrito y montón abajo.
    hourglass: {
        f: '<path d="M9.2 4.8h5.6c-.3 1.8-1.4 3.2-2.8 4.2-1.4-1-2.5-2.4-2.8-4.2zM7.8 21.3c.5-2.8 2.1-4.6 4.2-4.6s3.7 1.8 4.2 4.6z"/>',
        s: '<path d="M5.5 2.5h13M5.5 21.5h13"/><path d="M7.5 2.5v4.2a4.5 4.5 0 0 0 1.7 3.5L12 12l-2.8 1.8a4.5 4.5 0 0 0-1.7 3.5v4.2"/><path d="M16.5 2.5v4.2a4.5 4.5 0 0 1-1.7 3.5L12 12l2.8 1.8a4.5 4.5 0 0 1 1.7 3.5v4.2"/><path d="M12 11.5v4.5"/>',
    },
    lock: {
        f: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/>',
        s: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3"/><path d="M12 14.8v2.6"/>',
    },
    // Sesión: persona dentro de un círculo (cuenta de Discord).
    login: {
        f: '<circle cx="12" cy="12" r="9.5"/>',
        s: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="9.700" r="3.200"/><path d="M5.8 18.3c1.3-2.5 3.5-3.9 6.2-3.9s4.9 1.4 6.2 3.9"/>',
    },
    // Agotado: el mismo regalo del drop, tachado con una raya diagonal limpia.
    soldout: {
        f: '<g mask="url(#soldMask)"><rect x="3.5" y="10" width="17" height="11" rx="2"/></g>',
        s: '<defs><mask id="soldMask"><rect width="24" height="24" fill="#fff"/><path d="M3 3l18 18" stroke="#000" stroke-width="4.6" stroke-linecap="round" fill="none"/></mask></defs><g mask="url(#soldMask)"><rect x="2.5" y="7" width="19" height="4" rx="1.3"/><path d="M4.5 11v8a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-8"/><path d="M12 7v14"/><path d="M12 7C10.6 7 7 6.6 7 4.6 7 3.4 7.9 2.7 9 2.7c1.9 0 3 1.7 3 4.3zm0 0c1.4 0 5-.4 5-2.4 0-1.2-.9-1.9-2-1.9-1.9 0-3 1.7-3 4.3z"/></g><path d="M3 3l18 18"/>',
    },
    shield: {
        f: '<path d="M12 21.5s8-3.8 8-9.8V5.2L12 2.5 4 5.2v6.5c0 6 8 9.8 8 9.8z"/>',
        s: '<path d="M12 21.5s8-3.8 8-9.8V5.2L12 2.5 4 5.2v6.5c0 6 8 9.8 8 9.8z"/><path d="M12 8v4.4M12 16h.01"/>',
    },
    alert: {
        f: '<path d="M12 3.3L2.7 19.4a1.3 1.3 0 0 0 1.1 2h16.4a1.3 1.3 0 0 0 1.1-2z"/>',
        s: '<path d="M12 3.3L2.7 19.4a1.3 1.3 0 0 0 1.1 2h16.4a1.3 1.3 0 0 0 1.1-2z"/><path d="M12 9.5v4.5M12 17.3h.01"/>',
    },
}

function badgeIcon(name) {
    const ic = ICONS[name] || ICONS.gift
    const fill = ic.f ? `<g style="fill:var(--accent);fill-opacity:.32;stroke:none">${ic.f}</g>` : ""
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${fill}${ic.s}</svg>`
}

// Paletas por situación. bg = 3 tonos del degradado de fondo; a / b = acentos
// principal y secundario; confetti = colores de las piezas.
const PALETTES = {
    // Neutro: cian + violeta sobre azul noche.
    info: {
        bg: ["#070b1f", "#111b3b", "#1b0f2f"], a: "#87f3ff", b: "#a78bfa",
        confetti: ["#87f3ff", "#a78bfa", "#7ef0bc", "#f5d76e", "#f78fb3"],
    },
    // Conseguido: verde esmeralda + oro sobre verde profundo.
    success: {
        bg: ["#031510", "#063326", "#08213a"], a: "#5df2b0", b: "#ffd166",
        confetti: ["#5df2b0", "#ffd166", "#87f3ff", "#f78fb3", "#ffffff", "#a78bfa"],
    },
    // Ya reclamado: violeta + oro sobre morado.
    claimed: {
        bg: ["#0f0824", "#1e1245", "#2d0f33"], a: "#c9b6ff", b: "#ffd166",
        confetti: ["#c9b6ff", "#ffd166", "#f78fb3", "#87f3ff"],
    },
    // Caducado: naranja ardiente sobre marrón rojizo.
    expired: {
        bg: ["#1c0b08", "#321510", "#1c0e22"], a: "#ff9d7a", b: "#ff6b6b",
        confetti: ["#ff9d7a", "#ff6b6b", "#ffd166"],
    },
    // Necesita iniciar sesión: azul eléctrico tipo Discord.
    login: {
        bg: ["#050a26", "#0d1b52", "#1b1257"], a: "#7ea2ff", b: "#b4a7ff",
        confetti: ["#7ea2ff", "#b4a7ff", "#87f3ff"],
    },
    // Error: rojo rosado.
    error: {
        bg: ["#1d0810", "#33101c", "#1c0b24"], a: "#ff6b81", b: "#ff9d7a",
        confetti: ["#ff6b81", "#ff9d7a"],
    },
    // Aviso / límite de intentos: ámbar.
    warning: {
        bg: ["#1d1505", "#33230a", "#1d0f22"], a: "#ffd166", b: "#ff9d7a",
        confetti: ["#ffd166", "#ff9d7a"],
    },
    // Easter egg: rosa chicle + oro + cian.
    easter: {
        bg: ["#140726", "#2a0f45", "#0e1c3d"], a: "#ff8fd8", b: "#ffe08a",
        confetti: ["#ff8fd8", "#ffe08a", "#87f3ff", "#b79bff", "#7ef0bc", "#ffffff"],
    },
}

// Etiqueta que va encima del icono. Todas las pantallas llevan una (si no se pasa
// `kicker`, sale la de su estado) para que el espacio de arriba sea siempre el mismo.
const DEFAULT_KICKERS = {
    info: "Información",
    success: "¡Conseguido!",
    claimed: "Ya lo tienes",
    expired: "Terminado",
    login: "Sesión necesaria",
    error: "Error",
    warning: "Aviso",
    easter: "Logro oculto",
}

function hexToRgb(hex) {
    const h = hex.replace("#", "")
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(", ")
}

function paletteVars(p) {
    return `
                    --bg1: ${p.bg[0]};
                    --bg2: ${p.bg[1]};
                    --bg3: ${p.bg[2]};
                    --accent: ${p.a};
                    --accent-rgb: ${hexToRgb(p.a)};
                    --accent-2: ${p.b};
                    --accent-2-rgb: ${hexToRgb(p.b)};`
}

// Anti-enumeración de códigos: tope de peticiones por IP y ventana.
// Detrás de nginx la IP real viene en X-Real-IP; en local cae a req.ip.
function createDropRateLimiter({ max = 120, windowMs = 60 * 1000 } = {}) {
    const hits = new Map()
    return function dropRateLimit(req, res, next) {
        const now = Date.now()
        for (const [ip, entry] of hits) {
            if (entry.resetAt <= now) hits.delete(ip)
        }
        const ip = String(req.headers?.["x-real-ip"] || req.ip || "unknown")
        const entry = hits.get(ip) || { count: 0, resetAt: now + windowMs }
        if (entry.resetAt <= now) {
            entry.count = 0
            entry.resetAt = now + windowMs
        }
        entry.count++
        hits.set(ip, entry)
        if (entry.count > max) {
            res.set?.("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)))
            return res.status(429).send(renderCelebrationPage({
                title: "Demasiados intentos",
                kicker: "Espera un poco",
                message: "Estás abriendo demasiados enlaces seguidos. Espera un minuto y vuelve a intentarlo.",
                badge: "shield",
                status: "warning",
                celebration: false,
                actionsHtml: `<a class="secondary" href="/">Volver al inicio</a>`,
            }))
        }
        return next()
    }
}

function renderCelebrationPage({ title, message, badge = "gift", kicker = "", status = "info", celebration = false, detailsHtml = "", actionsHtml = "" }) {
    const mode = celebration === "soft" ? "soft" : celebration ? "full" : "none"
    const statusKey = PALETTES[status] ? status : "info"
    const pal = PALETTES[statusKey]
    const kickerText = kicker || DEFAULT_KICKERS[statusKey]
    const kickerHtml = `<div class="kicker">${escapeHtml(kickerText)}</div>`
    return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
            <meta name="theme-color" content="${pal.bg[0]}">
            <meta name="robots" content="noindex, nofollow">
            <meta name="referrer" content="no-referrer">
            <title>${escapeHtml(title)}</title>
            <style>
                :root {${paletteVars(pal)}
                    --text: #f2fbff;
                    --muted: #c3d8f2;
                    --success: #7ef0bc;
                    --warning: #ffd166;
                }
                * { box-sizing: border-box; }
                html {
                    margin: 0;
                    background: var(--bg1);
                    -webkit-text-size-adjust: 100%;
                    text-size-adjust: 100%;
                }
                body {
                    margin: 0;
                    min-height: 100vh;
                    min-height: 100dvh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: flex-start;
                    overflow-x: hidden;
                    padding: clamp(16px, 4vw, 36px) clamp(12px, 3vw, 24px);
                    padding-top: max(clamp(16px, 4vw, 36px), env(safe-area-inset-top));
                    padding-bottom: max(clamp(16px, 4vw, 36px), env(safe-area-inset-bottom));
                    font-family: Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
                    color: var(--text);
                    position: relative;
                }

                /* ── Fondo: degradado en deriva + 3 luces + polvo de estrellas ── */
                .bg {
                    position: fixed;
                    inset: 0;
                    z-index: 0;
                    overflow: hidden;
                    pointer-events: none;
                    background: linear-gradient(135deg, var(--bg1) 0%, var(--bg2) 38%, var(--bg3) 70%, var(--bg2) 100%);
                    background-size: 220% 220%;
                    animation: gradientFlow 18s ease-in-out infinite alternate;
                }
                .bg::after {
                    content: "";
                    position: absolute;
                    inset: -50%;
                    background-image:
                        radial-gradient(1.5px 1.5px at 20px 30px, rgba(255,255,255,.6), transparent),
                        radial-gradient(1px 1px at 90px 80px, rgba(var(--accent-rgb), .7), transparent),
                        radial-gradient(1.5px 1.5px at 150px 20px, rgba(255,255,255,.4), transparent),
                        radial-gradient(1px 1px at 60px 105px, rgba(var(--accent-2-rgb), .6), transparent);
                    background-size: 180px 120px;
                    opacity: .38;
                    animation: starDrift 90s linear infinite;
                }
                @keyframes gradientFlow {
                    0% { background-position: 0% 50%; }
                    100% { background-position: 100% 50%; }
                }
                @keyframes starDrift { to { transform: translate3d(-180px, 120px, 0); } }
                .glow {
                    position: absolute;
                    border-radius: 999px;
                    filter: blur(90px);
                    animation: floatGlow 11s ease-in-out infinite alternate;
                }
                .glow.one { width: min(34rem, 70vw); height: min(34rem, 70vw); top: -6%; left: -8%; background: radial-gradient(circle, rgba(var(--accent-rgb), .5), transparent 70%); opacity: .55; }
                .glow.two { width: min(32rem, 66vw); height: min(32rem, 66vw); bottom: -8%; right: -8%; background: radial-gradient(circle, rgba(var(--accent-2-rgb), .46), transparent 70%); opacity: .5; animation-delay: 2s; }
                .glow.three { width: min(22rem, 50vw); height: min(22rem, 50vw); top: 38%; left: 52%; background: radial-gradient(circle, rgba(var(--accent-rgb), .22), transparent 70%); opacity: .6; animation-delay: 4s; }
                @keyframes floatGlow {
                    from { transform: translate3d(0, 0, 0) scale(1); }
                    to { transform: translate3d(0, -28px, 0) scale(1.1); }
                }

                /* ── Tarjeta cristal ── */
                .card {
                    position: relative;
                    width: min(100%, 640px);
                    margin: auto;
                    padding: clamp(1.5rem, 4vw, 2.2rem) clamp(1.15rem, 4vw, 2rem) clamp(1.3rem, 3.4vw, 1.8rem);
                    background: linear-gradient(180deg, rgba(18, 26, 44, 0.78), rgba(8, 12, 24, 0.88));
                    border: 1px solid rgba(var(--accent-rgb), 0.28);
                    border-radius: clamp(24px, 5vw, 30px);
                    box-shadow:
                        0 34px 90px rgba(0, 0, 0, 0.55),
                        0 0 0 1px rgba(255, 255, 255, 0.03),
                        0 0 60px rgba(var(--accent-rgb), 0.08),
                        inset 0 1px 0 rgba(255, 255, 255, 0.1);
                    -webkit-backdrop-filter: blur(16px);
                    backdrop-filter: blur(16px);
                    text-align: center;
                    z-index: 2; /* por encima del confetti */
                    animation: cardIn 0.8s cubic-bezier(.2,.8,.2,1) backwards;
                    transition: transform 0.18s ease-out;
                    will-change: transform;
                }
                @keyframes cardIn {
                    from { opacity: 0; transform: translateY(22px) scale(0.97); }
                    to { opacity: 1; transform: none; }
                }
                /* Barra superior con colores en deriva. */
                .card::before {
                    content: "";
                    position: absolute;
                    top: 0; left: 8%; right: 8%;
                    height: 3px;
                    border-radius: 999px;
                    background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), var(--accent), transparent);
                    background-size: 300% 100%;
                    animation: barDrift 6s linear infinite;
                    opacity: .95;
                }
                @keyframes barDrift { to { background-position: 300% 0; } }

                /* Rejilla y foco que siguen al cursor (solo escritorio). */
                .cardGrid, .cardSpot {
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity .25s ease;
                }
                .cardGrid {
                    background-image:
                        linear-gradient(rgba(var(--accent-rgb), 0.2) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(var(--accent-rgb), 0.2) 1px, transparent 1px);
                    background-size: 22px 22px;
                    -webkit-mask-image: radial-gradient(160px circle at var(--mx, 50%) var(--my, 50%), black 0%, transparent 75%);
                    mask-image: radial-gradient(160px circle at var(--mx, 50%) var(--my, 50%), black 0%, transparent 75%);
                }
                .cardSpot { background: radial-gradient(240px circle at var(--mx, 50%) var(--my, 50%), rgba(var(--accent-rgb), 0.11), transparent 70%); }
                .card:hover .cardGrid, .card:hover .cardSpot { opacity: 1; }

                .content { position: relative; }
                .content > * { animation: rise .65s cubic-bezier(.2,.8,.2,1) both; }
                .content > :nth-child(1) { animation-delay: .08s; }
                .content > :nth-child(2) { animation-delay: .16s; }
                .content > :nth-child(3) { animation-delay: .24s; }
                .content > :nth-child(4) { animation-delay: .32s; }
                .content > :nth-child(5) { animation-delay: .4s; }
                .content > :nth-child(6) { animation-delay: .48s; }
                @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

                /* ── Icono: anillo en los colores del estado + halo ── */
                .badgeWrap {
                    position: relative;
                    width: 104px;
                    height: 104px;
                    margin: 0 auto 1rem;
                    padding: 4px;
                    border-radius: 50%;
                    background: conic-gradient(from 0deg, var(--accent), var(--accent-2), var(--accent), var(--accent-2), var(--accent));
                    box-shadow: 0 16px 40px rgba(var(--accent-rgb), 0.24);
                    animation: ringPulse 4.5s ease-in-out infinite, badgeIn .85s cubic-bezier(.2,1.3,.4,1) .12s both;
                }
                .badgeWrap::after {
                    content: "";
                    position: absolute;
                    inset: -14px;
                    border-radius: 50%;
                    background: radial-gradient(circle, rgba(var(--accent-rgb), .28), transparent 68%);
                    z-index: -1;
                    filter: blur(6px);
                }
                @keyframes ringPulse {
                    0%, 100% { box-shadow: 0 16px 36px rgba(var(--accent-rgb), 0.2); }
                    50% { box-shadow: 0 16px 48px rgba(var(--accent-rgb), 0.36); }
                }
                .badge {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    background: radial-gradient(circle at 30% 24%, rgba(var(--accent-rgb), 0.38), rgba(8, 13, 24, 0.97) 74%);
                    border: 1px solid rgba(255, 255, 255, 0.16);
                }
                .badge svg { width: 2.9rem; height: 2.9rem; color: #fff; filter: drop-shadow(0 2px 10px rgba(var(--accent-rgb), 0.55)); }
                @keyframes badgeIn { from { opacity: 0; transform: scale(.55) rotate(-8deg); } to { opacity: 1; transform: none; } }

                .kicker {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin-bottom: 0.75rem;
                    padding: 0.38rem 1rem;
                    border-radius: 999px;
                    font-size: 0.8rem;
                    font-weight: 700;
                    letter-spacing: 0.04em;
                    color: var(--text);
                    background: rgba(var(--accent-rgb), 0.14);
                    border: 1px solid rgba(var(--accent-rgb), 0.34);
                }
                .kicker::before {
                    content: "";
                    width: 7px; height: 7px;
                    border-radius: 50%;
                    background: var(--accent);
                    box-shadow: 0 0 0 0 rgba(var(--accent-rgb), .6);
                    animation: dotPulse 2s ease-out infinite;
                }
                @keyframes dotPulse {
                    0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), .6); }
                    100% { box-shadow: 0 0 0 9px rgba(var(--accent-rgb), 0); }
                }

                h1 {
                    margin: 0;
                    padding-bottom: 0.06em;
                    font-size: clamp(1.9rem, 4.6vw, 2.7rem);
                    line-height: 1.1;
                    letter-spacing: -0.035em;
                    font-weight: 800;
                    overflow-wrap: anywhere;
                    background: linear-gradient(180deg, #ffffff 25%, var(--accent) 140%);
                    -webkit-background-clip: text;
                    background-clip: text;
                    -webkit-text-fill-color: transparent;
                    color: transparent;
                }
                p {
                    margin: 0.85rem auto 0;
                    max-width: 52ch;
                    color: var(--muted);
                    font-size: clamp(1.02rem, 2vw, 1.12rem);
                    line-height: 1.6;
                    overflow-wrap: anywhere;
                }
                p a { display: inline; min-height: 0; padding: 0; background: none; box-shadow: none; color: var(--accent); text-decoration: underline; font-weight: 600; }
                strong { color: var(--accent); }

                /* ── Apartados ── */
                .details {
                    margin: 1.3rem auto 0;
                    max-width: 100%;
                    display: grid;
                    gap: 0.65rem;
                    text-align: left;
                }
                .detail {
                    display: grid;
                    gap: 0.25rem;
                    padding: 0.85rem 1.05rem;
                    border-radius: 18px;
                    background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.09), rgba(var(--accent-2-rgb), 0.05)), #0b1120;
                    border: 1px solid rgba(var(--accent-rgb), 0.2);
                    animation: detailIn .55s cubic-bezier(.2,.8,.2,1) both;
                }
                .detail:nth-child(1) { animation-delay: .3s; }
                .detail:nth-child(2) { animation-delay: .4s; }
                .detail:nth-child(3) { animation-delay: .5s; }
                .detail:nth-child(n+4) { animation-delay: .6s; }
                @keyframes detailIn { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
                .detail > span { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.02em; color: var(--accent); opacity: .9; }
                .detail > strong { font-size: 1.14rem; color: var(--text); }
                .detail > strong img { height: 1.35em; width: auto; vertical-align: -0.28em; margin-right: 0.2em; }
                .detail > small { color: var(--muted); font-size: 0.96rem; line-height: 1.5; }
                .rewardRow { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; padding: 0.4rem 0; }
                .rewardRow b { font-size: 1.06rem; color: var(--text); }
                .rewardRow small { color: var(--muted); font-size: 0.9rem; text-align: right; max-width: 62%; line-height: 1.4; }
                .rewardRow + .rewardRow { border-top: 1px solid rgba(255,255,255,0.08); }
                .claimBar { height: 10px; border-radius: 999px; background: rgba(255,255,255,0.1); overflow: hidden; margin-top: 0.4rem; }
                .claimBar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-2)); box-shadow: 0 0 12px rgba(var(--accent-rgb), .5); transition: width 0.8s ease; }
                .countdown { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--warning); }
                .countdownPast { color: var(--muted); font-weight: 700; }

                /* ── Botones ── */
                .actions {
                    margin-top: 1.5rem;
                    display: flex;
                    justify-content: center;
                    gap: 0.75rem;
                    flex-wrap: wrap;
                }
                .actions a {
                    position: relative;
                    overflow: hidden;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    min-height: 52px;
                    padding: 0.85rem 1.7rem;
                    border-radius: 999px;
                    text-decoration: none;
                    color: #04141c;
                    font-size: 1.04rem;
                    font-weight: 800;
                    letter-spacing: 0.005em;
                    background: linear-gradient(135deg, var(--accent), var(--accent-2));
                    box-shadow: 0 14px 32px rgba(var(--accent-rgb), 0.28), inset 0 1px 0 rgba(255,255,255,.35);
                    transition: transform 0.18s ease, filter 0.18s ease, background 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
                    -webkit-tap-highlight-color: transparent;
                }
                .actions a::after {
                    content: "";
                    position: absolute;
                    inset: 0;
                    background: linear-gradient(110deg, transparent 35%, rgba(255,255,255,.45) 50%, transparent 65%);
                    transform: translateX(-120%);
                    transition: transform .7s ease;
                }
                .actions a:hover { transform: translateY(-2px); filter: brightness(1.07); box-shadow: 0 18px 38px rgba(var(--accent-rgb), 0.38), inset 0 1px 0 rgba(255,255,255,.35); }
                .actions a:hover::after { transform: translateX(120%); }
                .actions a:active { transform: translateY(0) scale(.98); }
                .actions a.secondary {
                    background: #0d1424;
                    color: var(--text);
                    border: 1px solid rgba(var(--accent-rgb), 0.4);
                    box-shadow: none;
                }
                .actions a.secondary::after { display: none; }
                .actions a.secondary:hover {
                    background: linear-gradient(rgba(var(--accent-rgb), 0.2), rgba(var(--accent-rgb), 0.2)), #0d1424;
                    border-color: var(--accent);
                    color: #fff;
                    filter: none;
                    box-shadow: 0 10px 26px rgba(var(--accent-rgb), 0.18);
                }
                a:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
                @media (forced-colors: active) { h1 { background: none; -webkit-text-fill-color: CanvasText; color: CanvasText; } }

                canvas {
                    position: fixed;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 1; /* detrás de la tarjeta */
                }

                @media (prefers-reduced-motion: reduce) {
                    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
                }

                /* ── Móvil: todo más grande, tarjeta a ancho completo,
                   botones apilados con objetivo táctil cómodo ── */
                @media (max-width: 600px) {
                    body { padding: 12px 10px; padding-top: max(12px, env(safe-area-inset-top)); padding-bottom: max(12px, env(safe-area-inset-bottom)); }
                    .card {
                        width: 100%;
                        padding: 1.9rem 1.25rem 1.5rem;
                        border-radius: 28px;
                    }
                    .cardGrid, .cardSpot { display: none; }
                    .badgeWrap { width: 124px; height: 124px; margin-bottom: 1.2rem; }
                    .badge svg { width: 3.5rem; height: 3.5rem; }
                    .kicker { font-size: 0.88rem; padding: 0.45rem 1.1rem; margin-bottom: 0.9rem; }
                    h1 { font-size: clamp(2.2rem, 10.5vw, 2.8rem); }
                    p { font-size: 1.14rem; line-height: 1.6; margin-top: 1rem; }
                    .details { margin-top: 1.5rem; gap: 0.75rem; }
                    .detail { padding: 1rem 1.05rem; border-radius: 20px; }
                    .detail > span { font-size: 0.86rem; }
                    .detail > strong { font-size: 1.25rem; }
                    .detail > small { font-size: 1.02rem; }
                    .rewardRow { display: grid; gap: 0.15rem; padding: 0.5rem 0; }
                    .rewardRow b { font-size: 1.15rem; }
                    .rewardRow small { max-width: none; text-align: left; font-size: 0.98rem; }
                    .claimBar { height: 12px; }
                    .actions { flex-direction: column; align-items: stretch; gap: 0.7rem; margin-top: 1.7rem; }
                    .actions a { width: 100%; min-height: 60px; font-size: 1.14rem; padding: 1rem 1.4rem; }
                }
                @media (max-width: 380px) {
                    .card { padding: 1.6rem 1rem 1.3rem; }
                    h1 { font-size: 2rem; }
                    p { font-size: 1.06rem; }
                    .badgeWrap { width: 108px; height: 108px; }
                    .badge svg { width: 3.1rem; height: 3.1rem; }
                }
                /* Pantallas bajas (móvil en horizontal): compacta el icono. */
                @media (max-height: 560px) {
                    .badgeWrap { width: 76px; height: 76px; margin-bottom: 0.6rem; }
                    .badge svg { width: 2.1rem; height: 2.1rem; }
                    .card { padding-top: 1.1rem; }
                }
            </style>
        </head>
        <body class="status-${escapeHtml(statusKey)}">
            <div class="bg" aria-hidden="true">
                <div class="glow one"></div>
                <div class="glow two"></div>
                <div class="glow three"></div>
            </div>

            <main class="card">
                <div class="cardGrid"></div>
                <div class="cardSpot"></div>
                <div class="content">
                    ${kickerHtml}
                    <div class="badgeWrap"><div class="badge">${badgeIcon(badge)}</div></div>
                    <h1>${escapeHtml(title)}</h1>
                    <p>${message}</p>
                    ${detailsHtml ? `<div class="details">${detailsHtml}</div>` : ""}
                    ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ""}
                </div>
            </main>

            <script>
                // Tilt + rejilla: solo mientras el cursor está sobre la tarjeta.
                (function() {
                    var card = document.querySelector('.card');
                    if (!card) return;
                    if (!window.matchMedia('(pointer: fine)').matches) return;
                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                    var raf = null;
                    function update(e) {
                        var r = card.getBoundingClientRect();
                        var x = e.clientX - r.left;
                        var y = e.clientY - r.top;
                        card.style.setProperty('--mx', x + 'px');
                        card.style.setProperty('--my', y + 'px');
                        var px = (x - r.width / 2) / r.width;
                        var py = (y - r.height / 2) / r.height;
                        if (raf) cancelAnimationFrame(raf);
                        raf = requestAnimationFrame(function() {
                            card.style.transform = 'perspective(950px) rotateX(' + (-py * 6).toFixed(2) + 'deg) rotateY(' + (px * 9).toFixed(2) + 'deg)';
                        });
                    }
                    card.addEventListener('mouseenter', update);
                    card.addEventListener('mousemove', update, { passive: true });
                    card.addEventListener('mouseleave', function() {
                        if (raf) cancelAnimationFrame(raf);
                        card.style.transform = '';
                    });
                    window.addEventListener('blur', function() { card.style.transform = ''; });
                })();
                // Cuenta atrás (solo si la página la incluye y no ha cerrado).
                (function() {
                    var el = document.getElementById('dropCountdown');
                    if (!el) return;
                    var expires = Number(el.getAttribute('data-expires')) || 0;
                    function pad(n) { return String(n).padStart(2, '0'); }
                    function tick() {
                        var left = Math.max(0, expires - Date.now());
                        var h = Math.floor(left / 3600000);
                        var m = Math.floor(left % 3600000 / 60000);
                        var s = Math.floor(left % 60000 / 1000);
                        var d = Math.floor(h / 24);
                        el.textContent = d > 0 ? d + 'd ' + pad(h % 24) + ':' + pad(m) + ':' + pad(s) : pad(h) + ':' + pad(m) + ':' + pad(s);
                        if (left <= 0 && el.dataset.done !== "1") {
                            el.dataset.done = "1";
                            // Un solo reload cada 30 s: evita un bucle si el reloj
                            // del cliente va adelantado respecto al servidor.
                            var k = 'celebReload:' + location.pathname, last = 0;
                            try { last = Number(sessionStorage.getItem(k)) || 0; } catch (e) {}
                            if (Date.now() - last > 30000) {
                                try { sessionStorage.setItem(k, String(Date.now())); } catch (e) {}
                                location.reload();
                            }
                        }
                    }
                    tick();
                    setInterval(tick, 1000);
                })();
            </script>
            ${mode !== "none" ? `
                <canvas id="confetti"></canvas>
                <script>
                    (function() {
                        const canvas = document.getElementById('confetti');
                        const ctx = canvas.getContext('2d');
                        const pieces = [];
                        const colors = ${JSON.stringify(pal.confetti)};
                        const mode = '${mode}';
                        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                        const small = window.innerWidth < 600;
                        // En móvil las piezas son algo más grandes para que se vean.
                        const scale = small ? 1.35 : 1;
                        let W = 0, H = 0, running = false;

                        function resize() {
                            const dpr = window.devicePixelRatio || 1;
                            W = window.innerWidth;
                            H = window.innerHeight;
                            canvas.width = W * dpr;
                            canvas.height = H * dpr;
                            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                        }

                        function pick() { return colors[Math.floor(Math.random() * colors.length)]; }

                        function piece(o) {
                            return Object.assign({
                                w: (7 + Math.random() * 8) * scale,
                                h: (12 + Math.random() * 10) * scale,
                                color: pick(),
                                rot: Math.random() * Math.PI * 2,
                                spin: (Math.random() - 0.5) * 0.3,
                                tilt: Math.random() * Math.PI * 2,
                                tiltSpeed: 0.08 + Math.random() * 0.18,
                                round: Math.random() < 0.22,
                                alpha: 1,
                                age: 0,
                                gravity: 0.3,
                                drag: 0.985,
                                loop: false
                            }, o);
                        }

                        // Una tanda de los dos cañones (esquinas de abajo), disparando
                        // hacia arriba y hacia el centro.
                        function cannonBatch(count) {
                            const power = Math.min(Math.max(H, 480), 900) / 32;
                            for (let i = 0; i < count; i++) {
                                const left = i % 2 === 0;
                                const angle = (56 + Math.random() * 26) * Math.PI / 180;
                                const speed = power * (0.6 + Math.random() * 0.8);
                                pieces.push(piece({
                                    x: left ? -8 : W + 8,
                                    y: H * (0.78 + Math.random() * 0.2),
                                    dx: (left ? 1 : -1) * Math.cos(angle) * speed,
                                    dy: -Math.sin(angle) * speed
                                }));
                            }
                            ensureLoop();
                        }

                        // La descarga sale en 6 tandas seguidas (no todo de golpe),
                        // así parece una ráfaga y no un bloque.
                        function cannons(total) {
                            const batches = 6;
                            for (let b = 0; b < batches; b++) {
                                setTimeout(() => cannonBatch(Math.ceil(total / batches)), b * 90);
                            }
                        }

                        // Lluvia suave que ENTRA POR ARRIBA: las piezas nacen por encima
                        // de la pantalla, escalonadas, y van apareciendo poco a poco.
                        // Después, al salir por abajo, vuelven a entrar por arriba.
                        function rain(count) {
                            for (let i = 0; i < count; i++) {
                                pieces.push(piece({
                                    x: Math.random() * W,
                                    y: -20 - Math.random() * H * 1.1,
                                    w: (5 + Math.random() * 6) * scale,
                                    h: (8 + Math.random() * 9) * scale,
                                    dx: (Math.random() - 0.5) * 1.2,
                                    dy: 1.1 + Math.random() * 1.7,
                                    spin: (Math.random() - 0.5) * 0.15,
                                    alpha: 0.45 + Math.random() * 0.3,
                                    loop: true
                                }));
                            }
                            ensureLoop();
                        }

                        function frame() {
                            ctx.clearRect(0, 0, W, H);
                            for (let i = pieces.length - 1; i >= 0; i--) {
                                const p = pieces[i];
                                p.age++;
                                if (p.loop) {
                                    p.x += p.dx;
                                    p.y += p.dy;
                                    if (p.y > H + 24) { p.y = -24; p.x = Math.random() * W; }
                                    if (p.x < -24) p.x = W + 24;
                                    if (p.x > W + 24) p.x = -24;
                                } else {
                                    p.dx *= p.drag;
                                    p.dy = Math.min(p.dy * p.drag + p.gravity, 5.5);
                                    p.x += p.dx;
                                    p.y += p.dy;
                                    if (p.age > 110) p.alpha -= 0.012;
                                    if (p.alpha <= 0 || p.y > H + 40) { pieces.splice(i, 1); continue; }
                                }
                                p.rot += p.spin;
                                p.tilt += p.tiltSpeed;
                                // Las piezas de la lluvia aún fuera de pantalla no se dibujan.
                                if (p.y < -30) continue;
                                ctx.save();
                                ctx.translate(p.x, p.y);
                                ctx.rotate(p.rot);
                                // El "giro" 3D de cada pieza: se aplasta y se estira.
                                ctx.scale(1, Math.cos(p.tilt));
                                ctx.globalAlpha = p.alpha;
                                ctx.fillStyle = p.color;
                                if (p.round) {
                                    ctx.beginPath();
                                    ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
                                    ctx.fill();
                                } else {
                                    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                                }
                                ctx.restore();
                            }
                            if (pieces.length) requestAnimationFrame(frame);
                            else running = false;
                        }

                        function ensureLoop() {
                            if (!running) {
                                running = true;
                                requestAnimationFrame(frame);
                            }
                        }

                        resize();
                        window.addEventListener('resize', resize);
                        if (!reduceMotion) {
                            if (mode === "full") {
                                // Descarga de los cañones y, mientras todavía hay confetti en
                                // el aire, la lluvia empieza a entrar por arriba: sin cortes.
                                setTimeout(() => cannons(small ? 60 : 90), 150);
                                setTimeout(() => rain(small ? 40 : 70), 700);
                            } else {
                                // "Ya lo tienes": solo lluvia suave, entrando por arriba.
                                setTimeout(() => rain(small ? 40 : 70), 1200);
                            }
                        }
                    })();
                </script>
            ` : ""}
        </body>
        </html>
    `
}

module.exports = { renderCelebrationPage, escapeHtml, createDropRateLimiter, badgeIcon }