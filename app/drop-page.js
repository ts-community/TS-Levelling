// Página de reclamación de drops (/drop/<guild>/<CODE>).
// Mismo lenguaje visual que /easteregg (fondo, tarjeta cristal, círculo con
// anillo, confetti, tilt 3D) + piezas propias de drops: cuenta atrás en vivo
// y barra de reclamados. celebration: false | true (burst al reclamar) |
// "soft" (lluvia suave: vista previa sin sesión o ya reclamado).

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}

// Anti-enumeración de códigos: tope de peticiones por IP y ventana.
// Sin esto, un script podría probar códigos a lo loco hasta dar con un drop
// abierto (el espacio es de 32^6 ≈ mil millones, pero mejor no regalar
// intentos infinitos). 120/min sobra para uso humano (carga + recargas) y
// no sirve para fuerza bruta. Detrás de nginx la IP real viene en
// X-Real-IP (ver drops.tscomunity.es.nginx); en local cae a req.ip.
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
            return res.status(429).send(renderDropPage({
                title: "Demasiados intentos",
                message: "Estás abriendo demasiados enlaces seguidos. Espera un minuto y vuelve a intentarlo.",
                badge: "🐢",
                status: "info",
                celebration: false,
                actionsHtml: `<a class="secondary" href="/servers">Ir al dashboard</a>`,
            }))
        }
        return next()
    }
}

function renderDropPage({ title, message, badge = "🎁", status = "info", celebration = false, detailsHtml = "", actionsHtml = "" }) {
    const mode = celebration === "soft" ? "soft" : celebration ? "full" : "none"
    return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title} · Drop de XP</title>
            <style>
                :root {
                    --bg1: #070b1f;
                    --bg2: #111b3b;
                    --bg3: #1b0f2f;
                    --text: #edf9ff;
                    --muted: #bfd7f5;
                    --accent: #87f3ff;
                    --accent-2: #a78bfa;
                    --success: #7ef0bc;
                    --warning: #ffd166;
                }
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
                    opacity: 0.48;
                    animation: floatGlow 10s ease-in-out infinite alternate;
                    pointer-events: none;
                }
                .glow.one { background: radial-gradient(circle, rgba(103, 233, 255, 0.42), rgba(103, 233, 255, 0)); top: 8%; left: 8%; }
                .glow.two { background: radial-gradient(circle, rgba(167, 139, 250, 0.42), rgba(167, 139, 250, 0)); bottom: 10%; right: 10%; animation-delay: 2s; }
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
                    border: 1px solid rgba(151, 215, 255, 0.2);
                    border-radius: 24px;
                    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.08);
                    backdrop-filter: blur(14px);
                    text-align: center;
                    z-index: 1;
                    animation: cardIn 0.75s cubic-bezier(.2,.8,.2,1) backwards, cardPulse 5s ease-in-out 1s infinite;
                    transition: transform 0.18s ease-out;
                }
                @keyframes cardPulse { 0%,100% { box-shadow: 0 30px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08); } 50% { box-shadow: 0 34px 90px rgba(0,0,0,.58), 0 0 34px rgba(135,243,255,.08), inset 0 1px 0 rgba(255,255,255,.1); } }
                @keyframes cardIn {
                    from { opacity: 0; transform: translateY(18px) scale(0.98); }
                    to { opacity: 1; transform: none; }
                }
                .card::before {
                    content: "";
                    position: absolute;
                    top: 0; left: 10%; right: 10%;
                    height: 3px;
                    border-radius: 999px;
                    background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent);
                    opacity: .7;
                }
                .status-success .card::before {
                    background: linear-gradient(90deg, transparent, #7ef0bc, #87f3ff, #f5d76e, transparent);
                    background-size: 250% 100%;
                    animation: barSlide 3s linear infinite;
                    opacity: 1;
                }
                @keyframes barSlide { to { background-position: 250% 0; } }
                .badgeWrap {
                    width: 92px;
                    height: 92px;
                    margin: 0 auto 0.7rem;
                    padding: 4px;
                    border-radius: 50%;
                    background: conic-gradient(from 0deg, #87f3ff, #a78bfa, #7ef0bc, #f5d76e, #f78fb3, #87f3ff);
                    animation: ringSpin 7s linear infinite;
                    box-shadow: 0 14px 34px rgba(135, 243, 255, 0.22);
                }
                .status-success .badgeWrap {
                    animation: ringSpin 3.2s linear infinite;
                    box-shadow: 0 14px 40px rgba(126, 240, 188, 0.35), 0 0 46px rgba(135, 243, 255, 0.22);
                }
                @keyframes ringSpin { to { transform: rotate(360deg); } }
                .badge {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    font-size: 2.1rem;
                    background: radial-gradient(circle at 32% 28%, rgba(64, 90, 130, 0.95), rgba(9, 14, 25, 0.96));
                    border: 1px solid rgba(255,255,255,0.14);
                    animation: badgeFloat 4s ease-in-out infinite;
                }
                .status-success .badge { animation: badgePop 0.7s cubic-bezier(.2,1.4,.4,1) both, badgeFloat 4s ease-in-out 0.7s infinite; }
                @keyframes badgeFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
                @keyframes badgePop { from { opacity: 0; transform: scale(0.4) rotate(-18deg); } to { opacity: 1; transform: none; } }
                h1 {
                    margin: 0;
                    font-size: clamp(1.5rem, 3.4vw, 2.2rem);
                    line-height: 1.1;
                    letter-spacing: -0.04em;
                }
                .status-success h1 {
                    background: linear-gradient(100deg, #fff 20%, var(--accent) 40%, #fff 60%);
                    background-size: 220% auto;
                    -webkit-background-clip: text;
                    background-clip: text;
                    -webkit-text-fill-color: transparent;
                    animation: titleShine 3.2s linear infinite;
                }
                @keyframes titleShine { to { background-position: 220% center; } }
                p {
                    margin: 0.7rem auto 0;
                    max-width: 52ch;
                    color: var(--muted);
                    font-size: 0.98rem;
                    line-height: 1.55;
                }
                strong { color: var(--success); }
                .ribbon {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.4rem;
                    margin-bottom: 0.7rem;
                    padding: 0.32rem 0.95rem;
                    border-radius: 999px;
                    font-size: 0.74rem;
                    font-weight: 800;
                    letter-spacing: 0.14em;
                    text-transform: uppercase;
                    color: #0b1526;
                    background: linear-gradient(135deg, #f5d76e, #ffb86c);
                    box-shadow: 0 8px 22px rgba(245, 215, 110, 0.3);
                }
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
                    background: rgba(135, 243, 255, 0.07);
                    border: 1px solid rgba(135, 243, 255, 0.14);
                    animation: detailIn .55s both;
                }
                .detail:nth-child(2) { animation-delay: .12s; }
                .detail:nth-child(3) { animation-delay: .24s; }
                @keyframes detailIn { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: none; } }
                .detail > span { font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
                .detail > strong { font-size: 1.02rem; color: var(--text); }
                .detail > small { color: var(--muted); font-size: 0.9rem; line-height: 1.5; }
                .claimBar { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.1); overflow: hidden; margin-top: 0.35rem; }
                .claimBar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width 0.8s ease; }
                .countdown { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--warning); }
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
                    color: #081521;
                    font-weight: 700;
                    background: linear-gradient(135deg, var(--accent), #d5fbff);
                    box-shadow: 0 12px 28px rgba(135, 243, 255, 0.28);
                    transition: transform 0.18s ease, box-shadow 0.18s ease, background-position 0.35s ease;
                }
                a:hover { transform: translateY(-1px); box-shadow: 0 18px 36px rgba(135, 243, 255, 0.32); }
                a.btn-primary { background: linear-gradient(135deg, #87f3ff, #a78bfa); }
                a.btn-primary:hover {
                    background: linear-gradient(135deg, #87f3ff, #a78bfa, #7ef0bc, #87f3ff);
                    background-size: 280% 280%;
                    animation: btnSlide 2.5s ease infinite;
                    box-shadow: 0 18px 36px rgba(135, 243, 255, 0.35);
                }
                @keyframes btnSlide { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
                a.secondary {
                    background: transparent;
                    color: var(--text);
                    border: 1px solid rgba(135, 243, 255, 0.35);
                    box-shadow: none;
                }
                canvas {
                    position: fixed;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 3;
                }
                .spark {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(1px);
                    pointer-events: none;
                    animation: sparkFloat 5s ease-in-out infinite;
                }
                @keyframes sparkFloat {
                    0%,100% { transform: translateY(0) scale(1); opacity: .85; }
                    50% { transform: translateY(-16px) scale(1.25); opacity: .4; }
                }
                @media (prefers-reduced-motion: reduce) {
                    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
                }
                @media (max-width: 520px) {
                    .card { width: min(94vw, 560px); padding: 1.1rem 0.9rem 0.85rem; }
                    .badgeWrap { width: 74px; height: 74px; }
                    .badge { font-size: 1.7rem; }
                    h1 { font-size: 1.45rem; }
                    p { font-size: .92rem; line-height: 1.5; }
                    .detail { padding: .55rem .7rem; }
                    .actions { flex-direction: column; align-items: stretch; }
                    .actions a { width: 100%; }
                }
            </style>
        </head>
        <body class="status-${status}">
            <div class="glow one"></div>
            <div class="glow two"></div>

            <div class="card">
                ${status === "claimed" ? `<div class="ribbon">✨ Ya lo tienes ✨</div>` : ""}
                ${mode !== "none" ? `
                <span class="spark" style="width:7px;height:7px;background:#7ef0bc;top:12%;left:9%;"></span>
                <span class="spark" style="width:5px;height:5px;background:#f5d76e;top:22%;right:10%;animation-delay:1s;"></span>
                <span class="spark" style="width:6px;height:6px;background:#f78fb3;bottom:18%;left:12%;animation-delay:2s;"></span>
                <span class="spark" style="width:5px;height:5px;background:#87f3ff;bottom:26%;right:12%;animation-delay:.5s;"></span>
                ` : ""}
                <div class="badgeWrap"><div class="badge">${badge}</div></div>
                <h1>${title}</h1>
                <p>${message}</p>
                ${detailsHtml ? `<div class="details">${detailsHtml}</div>` : ""}
                ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ""}
            </div>

            <script>
                // Tilt 3D: el panel se inclina hacia el cursor (solo ratón).
                (function() {
                    var card = document.querySelector('.card');
                    if (!card) return;
                    if (!window.matchMedia('(pointer: fine)').matches) return;
                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                    var raf = null;
                    function onMove(e) {
                        var r = card.getBoundingClientRect();
                        var px = (e.clientX - (r.left + r.width / 2)) / r.width;
                        var py = (e.clientY - (r.top + r.height / 2)) / r.height;
                        px = Math.max(-1, Math.min(1, px));
                        py = Math.max(-1, Math.min(1, py));
                        if (raf) cancelAnimationFrame(raf);
                        raf = requestAnimationFrame(function() {
                            card.style.transform = 'perspective(950px) rotateX(' + (-py * 8).toFixed(2) + 'deg) rotateY(' + (px * 10).toFixed(2) + 'deg)';
                        });
                    }
                    function onLeave() {
                        if (raf) cancelAnimationFrame(raf);
                        card.style.transform = '';
                    }
                    window.addEventListener('mousemove', onMove, { passive: true });
                    document.addEventListener('mouseleave', onLeave);
                    window.addEventListener('blur', onLeave);
                })();
                // Cuenta atrás del drop (si la página la incluye).
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
                    const canvas = document.getElementById('confetti');
                    const ctx = canvas.getContext('2d');
                    const pieces = [];
                    const colors = ['#7ef0bc', '#87f3ff', '#f5d76e', '#f78fb3', '#a78bfa', '#ffb86c'];
                    const celebrationMode = '${mode}';
                    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
                                dx: (Math.random() - 0.5) * 7,
                                dy: 1.8 + Math.random() * 3.2,
                                rot: Math.random() * Math.PI,
                                spin: (Math.random() - 0.5) * 0.25,
                                alpha: 1,
                                loop: false,
                            });
                        }
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
                                alpha: 0.55 + Math.random() * 0.35,
                                loop: true,
                            });
                        }
                    }

                    function animateConfetti() {
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
                            requestAnimationFrame(animateConfetti);
                        }
                    }

                    resizeCanvas();
                    if (!reduceMotion) {
                        if (celebrationMode === "full") {
                            spawnBurst(180, 0.18);
                            setTimeout(() => spawnBurst(110, 0.55), 550);
                            setTimeout(() => spawnBurst(80, 0.9), 1100);
                        } else {
                            spawnRain(70);
                        }
                        animateConfetti();
                    }
                    window.addEventListener('resize', resizeCanvas);
                </script>
            ` : ""}
        </body>
        </html>
    `
}

module.exports = { renderDropPage, escapeHtml, createDropRateLimiter }
