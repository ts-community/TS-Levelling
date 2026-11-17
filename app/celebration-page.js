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
const GIFT_FILL = '<rect x="2.7" y="7.3" width="18.6" height="4" rx="1.3"/><path d="M4.4 11.3h15.2v8a2.4 2.4 0 0 1-2.4 2.4H6.8a2.4 2.4 0 0 1-2.4-2.4z"/>'
const GIFT_STROKE = '<rect x="2.7" y="7.3" width="18.6" height="4" rx="1.3"/><path d="M4.4 11.3v8a2.4 2.4 0 0 0 2.4 2.4h10.4a2.4 2.4 0 0 0 2.4-2.4v-8"/><path d="M12 7.3v14.4"/><path d="M12 7.3c-1.3 0-4.7-.3-4.7-2.2 0-1.2.9-1.9 2-1.9 1.9 0 2.7 1.8 2.7 4.1zm0 0c1.3 0 4.7-.3 4.7-2.2 0-1.2-.9-1.9-2-1.9-1.9 0-2.7 1.8-2.7 4.1z"/>'
const ICONS = {
    // f = relleno suave (duotono, del color del estado) · s = trazo
    egg: {
        f: '<path d="M12 2.9c-3.7 0-6.6 5.1-6.6 10 0 4.9 2.9 8.2 6.6 8.2s6.6-3.3 6.6-8.2c0-4.9-2.9-10-6.6-10z"/>',
        s: '<path d="M12 2.9c-3.7 0-6.6 5.1-6.6 10 0 4.9 2.9 8.2 6.6 8.2s6.6-3.3 6.6-8.2c0-4.9-2.9-10-6.6-10z"/><path d="M6.2 14.2c1.3-1 2.5-1 3.8 0s2.5 1 3.8 0 2.5-1 3.8 0"/><path d="M9.2 8.1c.5-1.2 1.2-2.1 2.1-2.8"/><path d="M20.3 2.3c.18 1.05.63 1.5 1.68 1.68-1.05.18-1.5.63-1.68 1.68-.18-1.05-.63-1.5-1.68-1.68 1.05-.18 1.5-.63 1.68-1.68z"/><path d="M4.1 6.2c.13.75.45 1.07 1.2 1.2-.75.13-1.07.45-1.2 1.2-.13-.75-.45-1.07-1.2-1.2.75-.13 1.07-.45 1.2-1.2z"/>',
    },
    gift: {
        f: GIFT_FILL,
        s: GIFT_STROKE,
    },
    trophy: {
        f: '<path d="M7.2 3.2h9.6v6.1a4.8 4.8 0 0 1-9.6 0z"/><path d="M11.2 14h1.6v4.1h-1.6z"/><path d="M9.2 18.1h5.6v2.9H9.2z"/>',
        s: '<path d="M7.2 3.2h9.6v6.1a4.8 4.8 0 0 1-9.6 0z"/><path d="M16.8 4.9h3.4v1.7a3.7 3.7 0 0 1-3.7 3.7M7.2 4.9H3.8v1.7a3.7 3.7 0 0 0 3.7 3.7"/><path d="M12 14.1v4.1"/><path d="M8.2 21h7.6M9.2 18.1h5.6v2.9H9.2z"/>',
    },
    check: {
        f: '<circle cx="12" cy="12" r="9.2"/>',
        s: '<circle cx="12" cy="12" r="9.2"/><path d="M7.5 12.3l3.1 3.1 6-6.4"/>',
    },
    search: {
        f: '<circle cx="10.6" cy="10.6" r="6.9"/>',
        s: '<circle cx="10.6" cy="10.6" r="6.9"/><path d="M15.5 15.5 21 21"/>',
    },
    // Reloj de arena: arena arriba, chorrito y montón abajo.
    hourglass: {
        f: '<path d="M9 5.1h6c-.18 1.65-1.28 3.05-2.8 4h-.4C10.28 8.15 9.18 6.75 9 5.1zM8.1 19.7c.35-2.5 1.9-4.2 3.9-4.2s3.55 1.7 3.9 4.2z"/>',
        s: '<path d="M5.7 2.6h12.6M5.7 21.4h12.6"/><path d="M7.6 2.6v4c0 1.5.8 2.9 2 3.7L12 12l-2.4 1.7c-1.2.8-2 2.2-2 3.7v4"/><path d="M16.4 2.6v4c0 1.5-.8 2.9-2 3.7L12 12l2.4 1.7c1.2.8 2 2.2 2 3.7v4"/><path d="M12 11.6v3.8"/>',
    },
    lock: {
        f: '<rect x="4.6" y="10.2" width="14.8" height="10.8" rx="2.6"/>',
        s: '<rect x="4.6" y="10.2" width="14.8" height="10.8" rx="2.6"/><path d="M8.1 10.2V7.4a3.9 3.9 0 0 1 7.8 0v2.8"/><circle cx="12" cy="14.7" r="1.15" fill="currentColor" stroke="none"/><path d="M12 15.6v1.8"/>',
    },
    // Sesión: persona dentro de un círculo (cuenta de Discord).
    login: {
        f: '<circle cx="12" cy="12" r="9.2"/>',
        s: '<circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="9.4" r="3.1"/><path d="M6.2 18.2c1.2-2.4 3.3-3.7 5.8-3.7s4.6 1.3 5.8 3.7"/>',
    },
    // Agotado: el mismo regalo del drop, tachado con una raya diagonal limpia.
    soldout: {
        f: `<g mask="url(#soldMask)">${GIFT_FILL}</g>`,
        s: `<defs><mask id="soldMask"><rect width="24" height="24" fill="#fff"/><path d="M4 4l16 16" stroke="#000" stroke-width="4.6" stroke-linecap="round" fill="none"/></mask></defs><g mask="url(#soldMask)">${GIFT_STROKE}</g><path d="M4 4l16 16" stroke-width="1.8"/>`,
    },
    shield: {
        f: '<path d="M12 2.6 4.5 5.3v6.4c0 5.7 7.5 9.4 7.5 9.4s7.5-3.7 7.5-9.4V5.3z"/>',
        s: '<path d="M12 2.6 4.5 5.3v6.4c0 5.7 7.5 9.4 7.5 9.4s7.5-3.7 7.5-9.4V5.3z"/><path d="M12 8.3v4.6"/><circle cx="12" cy="16.1" r=".95" fill="currentColor" stroke="none"/>',
    },
    alert: {
        f: '<path d="M10.9 3.1 2.6 18.1a2.2 2.2 0 0 0 1.9 3.3h15a2.2 2.2 0 0 0 1.9-3.3L13.1 3.1a1.3 1.3 0 0 0-2.2 0z"/>',
        s: '<path d="M10.9 3.1 2.6 18.1a2.2 2.2 0 0 0 1.9 3.3h15a2.2 2.2 0 0 0 1.9-3.3L13.1 3.1a1.3 1.3 0 0 0-2.2 0z"/><path d="M12 9.2v4.7"/><circle cx="12" cy="17.3" r=".95" fill="currentColor" stroke="none"/>',
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
            <link rel="icon" href="/assets/favicon.ico" sizes="32x32">
            <link rel="icon" href="/assets/favicon-48.png" type="image/png" sizes="48x48">
            <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
            <title>${escapeHtml(title)}</title>
            <link rel="stylesheet" href="/css/celebration.css?v=1">
            <style>:root {${paletteVars(pal)}}</style>
        </head>
        <body class="status-${escapeHtml(statusKey)}">
            <div class="bg" aria-hidden="true">
                <div class="glow one"></div>
                <div class="glow two"></div>
                <div class="glow three"></div>
            </div>

            <a class="brandBar" href="/"><img src="/assets/server-icon-128.webp" alt=""><span><b>TS Community <span class="brandAccent">Brawl</span></b><small>Sistema de niveles</small></span></a>
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
            <p class="footNote"><a href="/clasificacion">Ver la clasificación</a> · <a href="https://tscomunity.es">Web principal</a></p>

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
                            const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
                            if (document.hidden) { running = false; return; }
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
                            if (!running && !document.hidden) {
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
        <script src="/js/secret-egg.js" defer></script></body>
        </html>
    `
}

module.exports = { renderCelebrationPage, escapeHtml, createDropRateLimiter, badgeIcon }