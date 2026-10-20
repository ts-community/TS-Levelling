// Página "celebración" compartida por /easteregg y los drops (/drop/<guild>/<CODE>).
// Un solo render: fondo animado, tarjeta cristal con rejilla que se ilumina
// bajo el cursor + tilt 3D, anillo estático con icono SVG (no emoji, no giro),
// barra superior con colores en deriva, confetti DETRÁS de la tarjeta y
// botones simples. celebration: false | true (burst al conseguirlo, luego
// lluvia suave tarda) | "soft" (solo lluvia suave, con retardo).

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}

// Iconos SVG (trazo), por nombre. Sin emojis: el círculo grande lleva un
// símbolo fino y limpio, coloreado blanco traslúcido.
const ICONS = {
    egg: '<path d="M12 2.7c-3.7 0-6.9 5.2-6.9 10.4C5.1 18.4 8.1 22 12 22s6.9-3.6 6.9-8.9C18.9 7.9 15.7 2.7 12 2.7z"/><path d="M9.1 11c.3-2.5 1.5-4.6 3-5.6"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    hourglass: '<path d="M19 2H5"/><path d="M19 22H5"/><path d="M17 2v3.5a3.5 3.5 0 0 1-1.4 2.8L12 11l-3.6-2.7A3.5 3.5 0 0 1 7 5.5V2"/><path d="M7 22v-3.5a3.5 3.5 0 0 1 1.4-2.8L12 13l3.6 2.7a3.5 3.5 0 0 1 1.4 2.8V22"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"/>',
}

function badgeIcon(name) {
    const body = ICONS[name] || ICONS.gift
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
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
                message: "Estás abriendo demasiados enlaces seguidos. Espera un minuto y vuelve a intentarlo.",
                badge: "alert",
                status: "info",
                celebration: false,
                actionsHtml: `<a class="secondary" href="/servers">Ir al dashboard</a>`,
            }))
        }
        return next()
    }
}

function renderCelebrationPage({ title, message, badge = "gift", kicker = "", status = "info", celebration = false, detailsHtml = "", actionsHtml = "" }) {
    const mode = celebration === "soft" ? "soft" : celebration ? "full" : "none"
    const kickerHtml = kicker ? `<div class="kicker">${escapeHtml(kicker)}</div>` : ""
    return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${escapeHtml(title)}</title>
            <style>
                :root {
                    --bg1: #070b1f;
                    --bg2: #111b3b;
                    --bg3: #1b0f2f;
                    --text: #edf9ff;
                    --muted: #bfd7f5;
                    --accent: #87f3ff;
                    --accent-rgb: 135, 243, 255;
                    --accent-2: #a78bfa;
                    --accent-2-rgb: 167, 139, 250;
                    --success: #7ef0bc;
                    --warning: #ffd166;
                }
                /* Paleta por estado: cada situación tinta acentos y glows. */
                body.status-success { --accent: #7ef0bc; --accent-rgb: 126, 240, 188; }
                body.status-claimed { --accent: #c9b6ff; --accent-rgb: 190, 160, 255; --accent-2: #ffd166; --accent-2-rgb: 245, 215, 110; }
                body.status-expired { --accent: #ff9d7a; --accent-rgb: 255, 157, 122; --accent-2: #ffd166; --accent-2-rgb: 255, 184, 108; }
                * { box-sizing: border-box; }
                html, body {
                    margin: 0;
                    min-height: 100%;
                    font-family: Inter, "Segoe UI", sans-serif;
                    background: linear-gradient(135deg, var(--bg1) 0%, var(--bg2) 35%, var(--bg3) 100%);
                    color: var(--text);
                }
                body {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow-x: hidden;
                    overflow-y: auto;
                    padding: 28px 12px;
                    position: relative;
                    background-size: 180% 180%;
                    animation: gradientFlow 16s ease-in-out infinite alternate;
                }
                @keyframes gradientFlow {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                .glow {
                    position: absolute;
                    width: min(32rem, 58vw);
                    height: min(32rem, 58vw);
                    border-radius: 999px;
                    filter: blur(90px);
                    opacity: 0.4;
                    animation: floatGlow 10s ease-in-out infinite alternate;
                    pointer-events: none;
                }
                .glow.one { background: radial-gradient(circle, rgba(var(--accent-rgb), 0.4), rgba(var(--accent-rgb), 0)); top: 8%; left: 8%; }
                .glow.two { background: radial-gradient(circle, rgba(var(--accent-2-rgb), 0.38), rgba(var(--accent-2-rgb), 0)); bottom: 10%; right: 10%; animation-delay: 2s; }
                @keyframes floatGlow {
                    from { transform: translateY(0px) scale(1); }
                    to { transform: translateY(-26px) scale(1.09); }
                }
                .card {
                    position: relative;
                    width: min(92vw, 560px);
                    margin: auto;
                    padding: 1.4rem 1.25rem 1.1rem;
                    background: linear-gradient(180deg, rgba(16, 24, 40, 0.82), rgba(9, 14, 25, 0.88));
                    border: 1px solid rgba(var(--accent-rgb), 0.22);
                    border-radius: 24px;
                    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.08);
                    backdrop-filter: blur(14px);
                    text-align: center;
                    z-index: 2; /* por encima del confetti */
                    animation: cardIn 0.75s cubic-bezier(.2,.8,.2,1) backwards;
                    transition: transform 0.18s ease-out;
                }
                @keyframes cardIn {
                    from { opacity: 0; transform: translateY(18px) scale(0.98); }
                    to { opacity: 1; transform: none; }
                }
                /* Barra superior: llegando a punta y cola, colores en deriva
                   suave todo el rato, tintada según el estado. */
                .card::before {
                    content: "";
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 3px;
                    border-radius: 999px;
                    background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent);
                    background-size: 300% 100%;
                    animation: barDrift 7s linear infinite;
                    opacity: .8;
                }
                .status-success .card::before { background: linear-gradient(90deg, transparent, var(--success), var(--accent), var(--warning), transparent); background-size: 300% 100%; opacity: 1; }
                .status-expired .card::before { background: linear-gradient(90deg, transparent, var(--accent), #ff7759, var(--accent-2), transparent); background-size: 300% 100%; }
                @keyframes barDrift { to { background-position: 300% 0; } }
                /* Rejilla fina que solo aparece cerca del cursor (máscara radial
                   que muere al 75%) + foco suave en el mismo punto. */
                .cardGrid, .cardSpot {
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    pointer-events: none;
                }
                .cardGrid {
                    background-image:
                        linear-gradient(rgba(var(--accent-rgb), 0.18) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(var(--accent-rgb), 0.18) 1px, transparent 1px);
                    background-size: 22px 22px;
                    opacity: 0;
                    transition: opacity .25s ease;
                    -webkit-mask-image: radial-gradient(150px circle at var(--mx, 50%) var(--my, 50%), black 0%, transparent 75%);
                    mask-image: radial-gradient(150px circle at var(--mx, 50%) var(--my, 50%), black 0%, transparent 75%);
                }
                .cardSpot {
                    background: radial-gradient(200px circle at var(--mx, 50%) var(--my, 50%), rgba(var(--accent-rgb), 0.09), transparent 70%);
                    opacity: 0;
                    transition: opacity .25s ease;
                }
                .card:hover .cardGrid { opacity: 1; }
                .card:hover .cardSpot { opacity: 1; }
                /* Anillo estático (sin giro) con pulso de luz sutil. */
                .badgeWrap {
                    width: 92px;
                    height: 92px;
                    margin: 0 auto 0.7rem;
                    padding: 4px;
                    border-radius: 50%;
                    background: conic-gradient(from 0deg, var(--accent), var(--accent-2), var(--success), var(--warning), var(--accent));
                    box-shadow: 0 14px 34px rgba(var(--accent-rgb), 0.2);
                    animation: ringPulse 4.5s ease-in-out infinite;
                }
                .status-login .badgeWrap { animation: ringPulse 4.5s ease-in-out infinite, sonar 2.4s ease-out infinite; }
                @keyframes ringPulse {
                    0%, 100% { box-shadow: 0 14px 34px rgba(var(--accent-rgb), 0.18); }
                    50% { box-shadow: 0 14px 42px rgba(var(--accent-rgb), 0.3); }
                }
                @keyframes sonar {
                    0% { box-shadow: 0 14px 34px rgba(var(--accent-rgb), .22), 0 0 0 0 rgba(var(--accent-rgb), .45); }
                    70% { box-shadow: 0 14px 34px rgba(var(--accent-rgb), .22), 0 0 0 16px rgba(var(--accent-rgb), 0); }
                    100% { box-shadow: 0 14px 34px rgba(var(--accent-rgb), .22), 0 0 0 0 rgba(var(--accent-rgb), 0); }
                }
                .badge {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    background: radial-gradient(circle at 32% 28%, rgba(64, 90, 130, 0.95), rgba(9, 14, 25, 0.96));
                    border: 1px solid rgba(255,255,255,0.14);
                    animation: badgeFloat 4s ease-in-out infinite;
                }
                .badge svg { width: 2.6rem; height: 2.6rem; color: rgba(255, 255, 255, 0.92); filter: drop-shadow(0 2px 8px rgba(var(--accent-rgb), 0.35)); }
                .status-success .badge { animation: badgePop 0.7s cubic-bezier(.2,1.4,.4,1) both, badgeFloat 4s ease-in-out 0.7s infinite; }
                @keyframes badgeFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
                @keyframes badgePop { from { opacity: 0; transform: scale(0.4) rotate(-18deg); } to { opacity: 1; transform: none; } }
                .kicker {
                    display: inline-flex;
                    align-items: center;
                    margin-bottom: 0.6rem;
                    padding: 0.3rem 0.9rem;
                    border-radius: 999px;
                    font-size: 0.72rem;
                    font-weight: 800;
                    letter-spacing: 0.14em;
                    text-transform: uppercase;
                    color: var(--text);
                    background: rgba(var(--accent-rgb), 0.12);
                    border: 1px solid rgba(var(--accent-rgb), 0.3);
                }
                h1 {
                    margin: 0;
                    font-size: clamp(1.5rem, 3.4vw, 2.2rem);
                    line-height: 1.1;
                    letter-spacing: -0.04em;
                    overflow-wrap: anywhere;
                }
                .status-success h1 {
                    color: var(--success);
                }
                p {
                    margin: 0.7rem auto 0;
                    max-width: 52ch;
                    color: var(--muted);
                    font-size: 0.98rem;
                    line-height: 1.55;
                    overflow-wrap: anywhere;
                }
                strong { color: var(--success); }
                .details {
                    margin: 1rem auto 0;
                    max-width: 560px;
                    display: grid;
                    gap: 0.5rem;
                    text-align: left;
                }
                .detail {
                    display: grid;
                    gap: 0.15rem;
                    padding: 0.6rem 0.85rem;
                    border-radius: 16px;
                    background: rgba(var(--accent-rgb), 0.06);
                    border: 1px solid rgba(var(--accent-rgb), 0.15);
                    animation: detailIn .55s both;
                }
                .detail:nth-child(2) { animation-delay: .12s; }
                .detail:nth-child(3) { animation-delay: .24s; }
                @keyframes detailIn { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: none; } }
                .detail > span { font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
                .detail > strong { font-size: 1.02rem; color: var(--text); }
                .detail > strong img { height: 1.3em; width: auto; vertical-align: -0.25em; margin-right: 0.15em; }
                .detail > small { color: var(--muted); font-size: 0.9rem; line-height: 1.5; }
                /* Filas sueltas dentro de un apartado (lista de recompensas). */
                .rewardRow { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; padding: 0.25rem 0; }
                .rewardRow b { font-size: 1rem; color: var(--text); }
                .rewardRow small { color: var(--muted); font-size: 0.85rem; text-align: right; max-width: 60%; }
                .rewardRow + .rewardRow { border-top: 1px solid rgba(255,255,255,0.06); }
                .claimBar { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.1); overflow: hidden; margin-top: 0.35rem; }
                .claimBar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width 0.8s ease; }
                .countdown { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--warning); }
                .countdownPast { color: var(--muted); font-weight: 700; }
                .actions {
                    margin-top: 1.1rem;
                    display: flex;
                    justify-content: center;
                    gap: 0.6rem;
                    flex-wrap: wrap;
                }
                a {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    padding: 0.7rem 1.2rem;
                    border-radius: 999px;
                    text-decoration: none;
                    color: #062417;
                    font-weight: 700;
                    background: linear-gradient(135deg, #7ef0bc, #87f3ff);
                    box-shadow: 0 12px 28px rgba(135, 243, 255, 0.22);
                    transition: transform 0.18s ease, filter 0.18s ease, background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
                }
                a:hover { transform: translateY(-1px); filter: brightness(1.08); }
                /* Secundario: al posarlo se enciende en azul. */
                a.secondary {
                    background: transparent;
                    color: var(--text);
                    border: 1px solid rgba(var(--accent-rgb), 0.35);
                    box-shadow: none;
                }
                a.secondary:hover {
                    background: rgba(135, 243, 255, 0.16);
                    border-color: #87f3ff;
                    color: #bfeaff;
                    filter: none;
                }
                canvas {
                    position: fixed;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 1; /* detrás de la tarjeta */
                }
                @media (prefers-reduced-motion: reduce) {
                    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
                }
                @media (max-width: 520px) {
                    .card { width: min(94vw, 560px); padding: 1.1rem 0.9rem 0.85rem; }
                    .badgeWrap { width: 74px; height: 74px; }
                    .badge svg { width: 2rem; height: 2rem; }
                    h1 { font-size: 1.45rem; }
                    p { font-size: .92rem; line-height: 1.5; }
                    .detail { padding: .55rem .7rem; }
                    .actions { flex-direction: column; align-items: stretch; }
                    .actions a { width: 100%; }
                }
            </style>
        </head>
        <body class="status-${escapeHtml(status)}">
            <div class="glow one"></div>
            <div class="glow two"></div>

            <div class="card">
                ${kickerHtml}
                <div class="badgeWrap"><div class="badge">${badgeIcon(badge)}</div></div>
                <h1>${escapeHtml(title)}</h1>
                <p>${message}</p>
                ${detailsHtml ? `<div class="details">${detailsHtml}</div>` : ""}
                ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ""}
            </div>

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
                            location.reload();
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
                        const colors = ['#7ef0bc', '#87f3ff', '#f5d76e', '#f78fb3', '#a78bfa', '#ffb86c'];
                        const mode = '${mode}';
                        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                        let loopActive = false;

                        function resizeCanvas() {
                            canvas.width = window.innerWidth * window.devicePixelRatio;
                            canvas.height = window.innerHeight * window.devicePixelRatio;
                            canvas.style.width = window.innerWidth + 'px';
                            canvas.style.height = window.innerHeight + 'px';
                            ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
                        }

                        function spawnBurst(count, spread) {
                            for (let i = 0; i < count; i++) {
                                pieces.push({
                                    x: window.innerWidth * (0.5 + (Math.random() - 0.5) * (spread || 0.18)),
                                    y: window.innerHeight * 0.18 + Math.random() * 30,
                                    w: 8 + Math.random() * 10,
                                    h: 14 + Math.random() * 16,
                                    color: colors[Math.floor(Math.random() * colors.length)],
                                    dx: (Math.random() - 0.5) * 6,
                                    dy: 1.8 + Math.random() * 3.2,
                                    rot: Math.random() * Math.PI,
                                    spin: (Math.random() - 0.5) * 0.25,
                                    alpha: 1,
                                    loop: false,
                                });
                            }
                            ensureLoop();
                        }

                        function spawnRain(count) {
                            for (let i = 0; i < count; i++) {
                                pieces.push({
                                    x: Math.random() * window.innerWidth,
                                    y: Math.random() * window.innerHeight,
                                    w: 5 + Math.random() * 7,
                                    h: 8 + Math.random() * 10,
                                    color: colors[Math.floor(Math.random() * colors.length)],
                                    dx: (Math.random() - 0.5) * 1.4,
                                    dy: 0.9 + Math.random() * 1.6,
                                    rot: Math.random() * Math.PI,
                                    spin: (Math.random() - 0.5) * 0.15,
                                    alpha: 0.45 + Math.random() * 0.3,
                                    loop: true,
                                });
                            }
                            ensureLoop();
                        }

                        function animateConfetti() {
                            loopActive = false;
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            for (const p of pieces) {
                                p.x += p.dx;
                                p.y += p.dy;
                                p.rot += p.spin;
                                if (p.loop) {
                                    if (p.y > window.innerHeight + 24) {
                                        p.y = -24;
                                        p.x = Math.random() * window.innerWidth;
                                    }
                                    if (p.x < -24) p.x = window.innerWidth + 24;
                                    if (p.x > window.innerWidth + 24) p.x = -24;
                                } else {
                                    p.dy += 0.04;
                                    p.alpha *= 0.996;
                                }
                                ctx.save();
                                ctx.translate(p.x, p.y);
                                ctx.rotate(p.rot);
                                ctx.globalAlpha = p.alpha;
                                ctx.fillStyle = p.color;
                                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                                ctx.restore();
                            }
                            if (pieces.some(p => !p.loop && p.alpha > 0.02) || pieces.some(p => p.loop)) {
                                loopActive = true;
                                requestAnimationFrame(animateConfetti);
                            }
                        }

                        function ensureLoop() {
                            if (!loopActive) {
                                loopActive = true;
                                requestAnimationFrame(animateConfetti);
                            }
                        }

                        resizeCanvas();
                        window.addEventListener('resize', resizeCanvas);
                        if (!reduceMotion) {
                            if (mode === "full") {
                                // Un solo estallido al entrar; la lluvia suave
                                // acompaña después, con retardo.
                                setTimeout(() => spawnBurst(120, 0.16), 100);
                                setTimeout(() => spawnRain(55), 1900);
                            } else {
                                // "Ya lo tienes": lluvia suave, empezando tarde
                                // para que primero se lea la tarjeta.
                                setTimeout(() => spawnRain(55), 2300);
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
