// this code is real messy forgive me

const express = require('express')
const cookieParser = require('cookie-parser')
const timeout = require('connect-timeout')
const cors = require('cors')

const path = require('path')
const mongoose = require("mongoose")
const Discord = require('discord.js')
const { REST } = require("@discordjs/rest")

const Tools = require('./classes/Tools.js')
const Model = require("./classes/DatabaseModel.js");
const LevelUpEmbed = require('./classes/LevelUpEmbed.js')
const LevelUpMessage = require("./classes/LevelUpMessage.js")
const { unlockWebEasterEgg, resolveServerId, DEFAULT_EASTEREGG_GUILD_ID } = require("./classes/WebEasterEgg.js")
const recordsConfig = require("./config/records.js")
const auth = require('./config.json')
const curvePresets = require('./json/curve_presets.json')
const schemaData = require("./database_schema.js")

module.exports = (client) => {

const app = express();
const tools = Tools.global

app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));  // keeping the limit pretty high for json imports, some servers are like 10+ megabytes
app.use(timeout('20s'));
app.set('json spaces', 2)

require('express-async-errors') // why is this NEEDED (actually malding)

const siteURL = tools.WEBSITE

// discord endpoints
const discordAPI = "https://discord.com/api/v9/"
const discord_auth = discordAPI + `oauth2/authorize?client_id=${process.env.DISCORD_ID}&redirect_uri=${encodeURIComponent(siteURL)}%2Fauth&response_type=code&scope=identify%20guilds`

// use this for discord requests
const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

// discord perms
// kept as BigInt on purpose - guild.permissions can exceed Number.MAX_SAFE_INTEGER for users with lots of perms,
// and converting to Number silently rounds it, corrupting the exact bits we're checking (like Administrator)
const manage_roles = Discord.PermissionFlagsBits.ManageRoles
const manage_messages = Discord.PermissionFlagsBits.ManageMessages
const manage_server = Discord.PermissionFlagsBits.ManageGuild
const server_admin = Discord.PermissionFlagsBits.Administrator

function hasPerm(permissions, bit) {
    return (BigInt(permissions || 0) & bit) !== 0n
}

// database
let schema = new mongoose.Schema({
    _id: String,
    access_token: String,
    refresh_token: String,
    expires: Number
}, { collection: "auth" })
let authDB = new Model("auth", schema)

function sendPage(res, name) {
    return res.sendFile(path.join(__dirname + `/app/html/${name}.html`))
}

function sendRedirect(res, name) {
    return res.redirect(name)
}

function canManageServer(guild) {
    if (!guild) return false
    return guild.owner || hasPerm(guild.permissions, server_admin)
}

function botIsPublic() {
    return client.application.fetch().then(x => x.botPublic)
}

function notFalse(val) {
    return val && val != "false" && val != "0"
} 

function clearDeletedData(settings, roles, channels) {
    if (roles) {
        settings.rewards = settings.rewards.filter(x => roles.some(r => r.id == x.id))
        settings.multipliers.roles = settings.multipliers.roles.filter(x => roles.some(r => r.id == x.id))
    }

    if (channels) {
        settings.multipliers.channels = settings.multipliers.channels.filter(x => channels.some(c => c.id == x.id))
        if (settings.levelUp.channel.length > 10 && !channels.some(c => c.id == settings.levelUp.channel)) settings.levelUp.channel = "current"
    }

    return settings
}

app.use("/css", express.static(__dirname + '/app/css'));
app.use("/assets", express.static(__dirname + '/app/assets'));
app.use("/polaris.js", express.static(__dirname + '/app/js/extras.js'));

app.use(function(req, res, next) {
    res.apiError = function(message, code) {
        let error = { apiError: true, message }
        if (code) error.code = code
        return res.status(400).send(error)
    }
    next()
})

app.get("/servers", (req, res) => sendPage(res, "servers"))
app.get("/settings/:id", (req, res) => sendPage(res, "config"))
app.get(["/leaderboard/:id", "/top/:id", "/rank/:id", "/roles/:id", "/levels/:id", "/records/:id"], (req, res) => sendPage(res, "leaderboard"))
app.get("/", (req, res) => sendPage(res, "home"))

app.get(["/leaderboard", "/top"], (req, res) => sendRedirect(res, `/leaderboard/${DEFAULT_EASTEREGG_GUILD_ID}`))
app.get(["/rank", "/roles", "/levels", "/records"], (req, res) => {
    const page = req.path.slice(1)
    return sendRedirect(res, `/${page}/${DEFAULT_EASTEREGG_GUILD_ID}`)
})
app.get(["/settings", "/servers"], (req, res) => sendRedirect(res, "/servers"))

app.get("/easteregg", async function(req, res) {
    const [user, guilds] = await getDiscordInfo(req)
    const guildId = resolveServerId({ guildId: req.query.guild || req.query.server || req.query.guildId, guilds, defaultGuildId: DEFAULT_EASTEREGG_GUILD_ID })

    function escapeHtml(s) {
        return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
    }

    function renderPage({ title, message, detailsHtml = "", status = "info", showConfetti = false, actionHref = "/servers", actionLabel = "Volver al dashboard", secondaryHref = null, secondaryLabel = null }) {
        return `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${title}</title>
                <style>
                    :root {
                        --bg1: #070b1f;
                        --bg2: #111b3b;
                        --bg3: #1b0f2f;
                        --panel: rgba(12, 20, 36, 0.76);
                        --panel-border: rgba(149, 233, 255, 0.28);
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
                        overflow: hidden;
                        position: relative;
                        background-size: 180% 180%;
                        animation: gradientFlow 16s ease-in-out infinite alternate;
                    }
                    body::before, body::after {
                        content: "";
                        position: fixed;
                        width: 5px;
                        height: 5px;
                        border-radius: 50%;
                        background: var(--accent);
                        box-shadow: 12vw 18vh var(--accent-2), 28vw 72vh var(--success), 72vw 22vh var(--warning), 86vw 78vh var(--accent), 54vw 88vh var(--accent-2);
                        opacity: .55;
                        animation: particles 9s linear infinite;
                        pointer-events: none;
                    }
                    body::after { animation-delay: -4s; transform: scale(.65); opacity: .35; }
                    @keyframes particles { from { translate: 0 18px; scale: .8; } 50% { translate: 0 -24px; scale: 1.15; } to { translate: 0 18px; scale: .8; } }
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
                    .glow.three { background: radial-gradient(circle, rgba(126, 240, 188, 0.25), rgba(126, 240, 188, 0)); left: 42%; top: 10%; animation-delay: 4s; }
                    @keyframes floatGlow {
                        from { transform: translateY(0px) scale(1); }
                        to { transform: translateY(-26px) scale(1.09); }
                    }
                    .card {
                        position: relative;
                        width: min(92vw, 600px);
                        padding: 2rem 1.5rem 1.5rem;
                        background: linear-gradient(180deg, rgba(16, 24, 40, 0.82), rgba(9, 14, 25, 0.88));
                        border: 1px solid rgba(151, 215, 255, 0.2);
                        border-radius: 24px;
                        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.08);
                        backdrop-filter: blur(14px);
                        text-align: center;
                        z-index: 1;
                        animation: cardIn 0.75s cubic-bezier(.2,.8,.2,1) both, cardPulse 5s ease-in-out 1s infinite;
                    }
                    @keyframes cardPulse { 0%,100% { box-shadow: 0 30px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08); } 50% { box-shadow: 0 34px 90px rgba(0,0,0,.58), 0 0 34px rgba(135,243,255,.08), inset 0 1px 0 rgba(255,255,255,.1); } }
                    @keyframes cardIn {
                        from { opacity: 0; transform: translateY(18px) scale(0.98); }
                        to { opacity: 1; transform: none; }
                    }
                    .badge {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        position: relative;
                        width: 66px;
                        height: 92px;
                        border-radius: 50% 50% 48% 48% / 38% 38% 62% 62%;
                        font-size: 2.4rem;
                        background: linear-gradient(135deg, rgba(135,243,255,0.18), rgba(167,139,250,0.22));
                        border: 1px solid rgba(255,255,255,0.18);
                        box-shadow: 0 14px 30px rgba(135, 243, 255, 0.18);
                        margin-bottom: 1rem;
                        animation: eggFloat 3.2s ease-in-out infinite, eggGlow 2.4s ease-in-out infinite alternate;
                    }
                    .badge::after { content: ""; position: absolute; inset: -5px; border-radius: inherit; border: 1px solid rgba(255,255,255,.25); animation: eggRing 2.8s ease-out infinite; }
                    @keyframes eggFloat { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-9px) rotate(3deg); } }
                    @keyframes eggGlow { from { box-shadow: 0 12px 26px rgba(135,243,255,.18); } to { box-shadow: 0 16px 42px rgba(167,139,250,.5); } }
                    @keyframes eggRing { from { opacity: .7; transform: scale(.92); } to { opacity: 0; transform: scale(1.35); } }
                    .status-success .badge { box-shadow: 0 14px 30px rgba(126, 240, 188, 0.22); }
                    .status-info .badge { box-shadow: 0 14px 30px rgba(135, 243, 255, 0.22); }
                    h1 {
                        margin: 0;
                        font-size: clamp(2rem, 4vw, 3rem);
                        line-height: 1.1;
                        letter-spacing: -0.04em;
                    }
                    p {
                        margin: 1rem auto 0;
                        max-width: 52ch;
                        color: var(--muted);
                        font-size: 1.04rem;
                        line-height: 1.7;
                    }
                    strong {
                        color: var(--success);
                    }
                    .details {
                        margin: 1.4rem auto 0;
                        max-width: 560px;
                        display: grid;
                        gap: 0.6rem;
                        text-align: left;
                    }
                    .detail {
                        display: grid;
                        gap: 0.15rem;
                        padding: 0.8rem 1rem;
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
                    .detail > strong img { height: 1.3em; width: auto; vertical-align: -0.25em; margin-right: 0.15em; }
                    .detail > small { color: var(--muted); font-size: 0.9rem; line-height: 1.5; }
                    .actions {
                        margin-top: 1.5rem;
                        display: flex;
                        justify-content: center;
                        gap: 0.7rem;
                        flex-wrap: wrap;
                    }
                    a {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: 0.5rem;
                        padding: 0.85rem 1.4rem;
                        border-radius: 999px;
                        text-decoration: none;
                        color: #081521;
                        font-weight: 700;
                        background: linear-gradient(135deg, var(--accent), #d5fbff);
                        box-shadow: 0 12px 28px rgba(135, 243, 255, 0.28);
                        transition: transform 0.18s ease, box-shadow 0.18s ease;
                    }
                    a:hover {
                        transform: translateY(-1px);
                        box-shadow: 0 18px 36px rgba(135, 243, 255, 0.32);
                    }
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
                    @media (prefers-reduced-motion: reduce) {
                        *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
                    }
                    @media (max-width: 520px) {
                        .card { width: min(94vw, 600px); padding: 1.6rem 1rem 1.1rem; }
                        h1 { font-size: 1.8rem; }
                        p { font-size: .95rem; line-height: 1.55; }
                        .detail { padding: .7rem .75rem; }
                        .actions a { width: 100%; }
                    }
                </style>
            </head>
            <body class="status-${status}">
                <div class="glow one"></div>
                <div class="glow two"></div>
                <div class="glow three"></div>

                <div class="card">
                    <div class="badge">${status === "success" ? "✅" : "🔎"}</div>
                    <h1>${title}</h1>
                    <p>${message}</p>
                    ${detailsHtml ? `<div class="details">${detailsHtml}</div>` : ""}
                    <div class="actions">
                        <a href="${actionHref}">${actionLabel}</a>
                        ${secondaryHref ? `<a class="secondary" href="${secondaryHref}">${secondaryLabel}</a>` : ""}
                    </div>
                </div>

                ${showConfetti ? `
                    <canvas id="confetti"></canvas>
                    <script>
                        const canvas = document.getElementById('confetti');
                        const ctx = canvas.getContext('2d');
                        const pieces = [];
                        const colors = ['#7ef0bc', '#87f3ff', '#f5d76e', '#f78fb3', '#a78bfa', '#ffb86c'];

                        function resizeCanvas() {
                            canvas.width = window.innerWidth * window.devicePixelRatio;
                            canvas.height = window.innerHeight * window.devicePixelRatio;
                            canvas.style.width = window.innerWidth + 'px';
                            canvas.style.height = window.innerHeight + 'px';
                            ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
                        }

                        function spawnBurst() {
                            pieces.length = 0;
                            for (let i = 0; i < 180; i++) {
                                pieces.push({
                                    x: window.innerWidth * (0.5 + (Math.random() - 0.5) * 0.18),
                                    y: window.innerHeight * 0.18 + Math.random() * 30,
                                    w: 8 + Math.random() * 10,
                                    h: 14 + Math.random() * 16,
                                    color: colors[Math.floor(Math.random() * colors.length)],
                                    dx: (Math.random() - 0.5) * 7,
                                    dy: 1.8 + Math.random() * 3.2,
                                    rot: Math.random() * Math.PI,
                                    spin: (Math.random() - 0.5) * 0.25,
                                    alpha: 1,
                                });
                            }
                        }

                        function animateConfetti() {
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            for (const p of pieces) {
                                p.x += p.dx;
                                p.y += p.dy;
                                p.rot += p.spin;
                                p.dy += 0.04;
                                p.alpha *= 0.996;

                                ctx.save();
                                ctx.translate(p.x, p.y);
                                ctx.rotate(p.rot);
                                ctx.globalAlpha = p.alpha;
                                ctx.fillStyle = p.color;
                                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                                ctx.restore();
                            }

                            if (pieces.some(p => p.alpha > 0.02)) {
                                requestAnimationFrame(animateConfetti);
                            }
                        }

                        resizeCanvas();
                        spawnBurst();
                        animateConfetti();
                        window.addEventListener('resize', resizeCanvas);
                    </script>
                ` : ""}
            </body>
            </html>
        `;
    }

    if (!user) {
        return res.status(401).send(renderPage({
            title: "Inicia sesión para reclamarlo",
            message: "Necesitas iniciar sesión con Discord para reclamar este logro.",
            status: "info",
            showConfetti: false,
            actionHref: "/discord",
            actionLabel: "Iniciar sesión",
        }));
    }

    if (!guildId) {
        return res.status(400).send(renderPage({
            title: "Easter egg",
            message: "No pude detectar el servidor. Usa ?guild=TU_GUILD_ID o entra desde tu dashboard.",
            status: "info",
            showConfetti: false,
        }));
    }

    const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${String(user.avatar).startsWith("a_") ? "gif" : "png"}?size=128` : ""
    const result = await unlockWebEasterEgg({
        client,
        guildId,
        userId: user.id,
        guild: client.guilds.cache.get(guildId) || null,
        guilds,
        avatarUrl,
    })

    const guildName = escapeHtml(client.guilds.cache.get(guildId)?.name || (Array.isArray(guilds) ? guilds.find(g => String(g.id) === String(guildId))?.name : null) || guildId)
    const meta = result.meta || result.result && { record: result.result.record, category: result.result.category, tier: result.result.tier } || null
    const tierXp = Number(meta?.tier?.xp ?? result.result?.tier?.xp ?? 20000)
    const recordEmoji = escapeHtml(meta?.record?.emoji || "🌐")
    const recordName = escapeHtml(meta?.tier?.name || meta?.record?.label || "Al otro lado")
    const recordDesc = escapeHtml(meta?.tier?.desc || "Encuentra el secreto escondido en la web.")
    const categoryName = escapeHtml(meta?.category?.name || "Ocultos")
    const xpStr = `+${tierXp.toLocaleString("es-ES")} XP`

    function buildDetails({ withProgress }) {
        const rows = []
        rows.push(`<div class="detail"><span>🏆 Record conseguido</span><strong>${recordEmoji} ${recordName}</strong><small>${recordDesc}</small></div>`)
        rows.push(`<div class="detail"><span>✨ Recompensa</span><strong><img src="/assets/icons/xp.png" alt="XP">${escapeHtml(xpStr)}</strong><small>${result.unlocked ? "Ya sumada a tu XP y a tu XP mensual." : "Ya la recibiste la primera vez; no se suma de nuevo."}</small></div>`)
        if (withProgress && result.result) {
            const done = result.result.done ?? 1
            const total = result.result.total ?? 1
            const completed = result.result.totalCompleted ?? done
            const visible = result.result.totalVisible ?? total
            rows.push(`<div class="detail"><span>📊 Tu progreso</span><strong><img src="/assets/icons/records.png" alt="Records">${completed}/${visible} Records</strong><small>Este logro: ${done}/${total} fases. Míralos con /records en Discord.</small></div>`)
        }
        return rows.join("")
    }

    const leaderboardHref = `/leaderboard/${encodeURIComponent(guildId)}`

    if (result.unlocked) {
        return res.send(renderPage({
            title: "¡Easter egg encontrado!",
            message: `Has desbloqueado el logro <strong>${recordEmoji} ${recordName}</strong> en <strong>${guildName}</strong>. Los <strong>Records</strong> son logros del servidor con recompensa de XP: este era un <strong>Record oculto</strong>, por eso no aparecía en la lista hasta descubrirlo.`,
            detailsHtml: buildDetails({ withProgress: true }),
            status: "success",
            showConfetti: true,
            actionHref: leaderboardHref,
            actionLabel: "Ver mi clasificación",
            secondaryHref: "/servers",
            secondaryLabel: "Volver al dashboard",
        }));
    }

    return res.send(renderPage({
        title: "Este easter egg ya estaba descubierto",
        message: `Ya habías completado el logro <strong>${recordEmoji} ${recordName}</strong> en <strong>${guildName}</strong>; no se repite ni da más XP. Los <strong>Records</strong> son logros del servidor y este era un <strong>Record oculto</strong> de la categoría ${categoryName}.`,
        detailsHtml: buildDetails({ withProgress: false }),
        status: "info",
        showConfetti: false,
        actionHref: leaderboardHref,
        actionLabel: "Ver mi clasificación",
        secondaryHref: "/servers",
        secondaryLabel: "Volver al dashboard",
    }));
})

if (auth.supportURL) app.get("/support", (req, res) => res.redirect(auth.supportURL))
if (auth.changelogURL) app.get("/changelog", (req, res) => res.redirect(auth.changelogURL))

app.get("/invite/:id?", (req, res) => {
    res.redirect(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=429765545024&scope=bot%20applications.commands${req.params.id ? `&guild_id=${req.params.id}` : ""}`)
})

app.get("/api/loggedin", async function(req, res) {
    let botPublic = await botIsPublic()
    let info = await getDiscordInfo(req, true)
    return res.send({ login: info ? { id: info.id, username: info.username } : null, botPublic })
})

app.get("/api/discordinfo", async function(req, res) {
    let info = await getDiscordInfo(req)
    return res.send(info)
})

app.get("/api/guilds", async function(req, res) {
    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!", "login")

    // don't send all user stuff, just the important things
    let userData = { id: user.id, username: user.username, displayName: user.global_name, avatar: user.avatar, color: user.banner_color }

    // find all servers that exist in the database + the user is currently in
    let guildList = guilds.map(x => x.id)
    let foundServers = await client.db.find({ "_id": { $in: guildList } }, "settings").catch(() => [])
    let validServers = guilds.filter(x => x.owner || hasPerm(x.permissions, manage_server) || foundServers.some(g => g._id == x.id)) // filter to just the servers above, OR manageable servers

    let activeIDs = await client.shard.broadcastEval(async (cl, xd) => {
        return xd.ids.filter(x => cl.guilds.cache.has(x))
    }, { context: { ids: validServers.map(x => x.id) } })
    activeIDs = activeIDs.flat()

    validServers = validServers.map(x => {
        let inServer = activeIDs.includes(x.id)
        let admin = x.owner || hasPerm(x.permissions, server_admin)
        let perms = {
            owner: x.owner,
            server: admin,
            roles: admin || hasPerm(x.permissions, manage_roles),
            messages: admin || hasPerm(x.permissions, manage_messages),
        }
        let foundDB = foundServers.find(g => g._id == x.id)
        let xpEnabled = inServer && foundDB?.settings?.enabled  // if xp is enabled for this server
        let hasLeaderboard = xpEnabled && !foundDB.settings.leaderboard.disabled // if leaderboard is enabled
        return { id: x.id, name: x.name, icon: x.icon, permissions: perms, xp: xpEnabled, inServer, leaderboard: hasLeaderboard, hasData: !!foundDB?.settings }
    })

    let botPublic = await botIsPublic()

    return res.send({ user: userData, guilds: validServers, botPublic })
})

app.get("/api/settings/:id", async function(req, res) {
    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!", "login")
    let serverID = req.params.id
    if (!serverID) return res.apiError("Invalid server ID!")

    // this allows devs to view and modify ANY SERVER
    // it's actually new to the open source version, previously i hacked together some other thing
    // main use for this is to make json imports easy
    let force = tools.isDev(user)

    let foundGuild = guilds.find(x => x.id == serverID)
    if (!foundGuild && !force) return res.apiError("Missing permissions!", "noPerms")

    let canManage = force || canManageServer(foundGuild)
    if (!canManage) return res.apiError("Missing permissions!", "noPerms")

    let serverData = await client.db.fetch(serverID, ["settings", "info"]) || await client.db.create({ _id: serverID })
    if (!serverData) return res.apiError("No server data!");

    let guildData = await client.shard.broadcastEval(async (cl, xd) => {
        const Discord = require('discord.js')
        const path = require("path")
        const Tools = require(path.join(xd.dir, "/classes/Tools.js"))  // broadcastEval executes from a different path so gotta do this
        const ChannelType = Discord.ChannelType
        let tools = Tools.global
        let guild = cl.guilds.cache.get(xd.guildID)
        if (!guild) return null

        let server = {
            name: guild.name,
            icon: guild.iconURL({format: "png", dynamic: true}),
            members: guild.memberCount
        }

        let roles = guild.roles.cache.sort((a, b) => b.position - a.position).map(x => ({
            id: x.id,
            name: x.name,
            color: x.hexColor,
            managed: x.managed,
            grantable: x.editable && x.id != guild.id
        }))

        let channels = guild.channels.cache
        .filter(x => x && (x.isTextBased() || x.type == ChannelType.GuildCategory || x.type == ChannelType.GuildForum || x.isVoiceBased()))
        .sort((a, b) => {
            let channelA = tools.getTrueChannelPos(a, ChannelType)
            let channelB = tools.getTrueChannelPos(b, ChannelType)
            return (channelA.group - channelB.group) || (channelA.section - channelB.section) || (channelA.position - channelB.position)
        }).map(x => ({
            id: x.id,
            name: x.name,
            pos: x.position,
            type: x.type == ChannelType.GuildForum ? "forum" : x.type == ChannelType.GuildCategory ? "category" : x.isVoiceBased() ? "vc" : x.isThread() ? "thread" : "channel",
            threads: x.threads?.cache?.size || undefined
        }))

        return { server, roles, channels }

    }, { context: { guildID: serverID, dir: __dirname } })
    .then(x => x.find(r => r)) // filter out empty shards
    .catch(console.error)

    if (!guildData) return res.apiError("Could not fetch server info!");

    let guildInfo = {
        name: guildData.server.name || foundGuild?.name || serverID,
        id: serverID,
        icon: guildData.server.icon,
        members: guildData.server.members || 0,
        lastUpdate: serverData.info.lastUpdate
    }
    if (force) guildInfo.botDev = true

    serverData.settings = clearDeletedData(serverData.settings, guildData.roles, guildData.channels)

    let lvlMessage = serverData.settings.levelUp.message
    if (serverData.settings.levelUp.embed && lvlMessage) {
        serverData.settings.levelUp.message = JSON.stringify(JSON.parse(lvlMessage), null, 2)
    }

    let ownedServers = guilds.filter(x => x.owner && x.id != serverID).map(x => ({ name: x.name, id: x.id }))

    let userData = { id: user.id, username: user.username, displayName: user.global_name, avatar: user.avatar, color: user.banner_color }

    return res.send({ guild: guildInfo, settings: serverData.settings, roles: guildData.roles, channels: guildData.channels, ownedServers, curvePresets, user: userData })
})

function validateSetting(val, setting, guildData={}) {
    switch (setting.type) {
        case "bool":
            return notFalse(val)
        case "int": case "float":
            let numVal = setting.type == "int" ? Math.round(val) : Number(Number(val).toFixed(setting.precision || 4))
            if (isNaN(numVal)) return setting.default
            else return tools.clamp(numVal, setting.min, setting.max)
        case "string":
            let strVal = String(val).slice(0, setting.maxlength || 64).trim()
            if (setting.accept) {
                let acceptList = setting.accept.filter(x => !x.startsWith("discord:"))
                if (setting.accept.includes("discord:role")) acceptList = acceptList.concat(guildData.roles)
                if (setting.accept.includes("discord:channel")) acceptList = acceptList.concat(guildData.channels)
                let foundAccept = acceptList.includes(strVal)
                if (!foundAccept) strVal = null
            }
            return strVal || setting.default
        case "collection":
            let collection = []
            if (!val || !Array.isArray(val)) return []
            val.forEach(x => {
                let validated = {}
                Object.entries(x).forEach(s => {
                    let [innerKey, innerVal] = s
                    let foundSetting = setting.values[innerKey]
                    if (foundSetting) validated[innerKey] = validateSetting(innerVal, foundSetting, guildData)
                })
                collection.push(validated)
            })
            return collection
    }
}

app.post("/api/settings", async function(req, res) {
    
    if (typeof req.body != "object") return res.apiError("Invalid save data!");
    let guildID = req.body.guildID
    if (!guildID) return res.apiError("No guild ID!");

    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!")

    let force = tools.isDev(user);

    let foundGuild = guilds.find(x => x.id == guildID)
    if (!foundGuild && !force) return res.apiError("Not in server!")

    let canManage = canManageServer(foundGuild)
    if (!canManage && !force) return res.apiError("Manage server permission required!")

    if (req.body.resetSettings) {
        return client.db.update(guildID, { $unset: { "settings": "x" }, $set: { "info.lastUpdate": Date.now() } }).exec().then(() => {
            return res.end("All settings reset!")
        }).catch(console.error)
    }

    else if (req.body.resetXP) {
        return client.db.update(guildID, { $unset: { "users": "x" } }).exec().then(() => {
            return res.end("All XP reset!")
        }).catch(console.error)
    }

    let guildData = await client.shard.broadcastEval(async (cl, xd) => {
        let guild = cl.guilds.cache.get(xd.guildID)
        if (!guild) return null

        return {
            roles: guild.roles.cache.map(x => x.id),
            channels: guild.channels.cache.map(x => x.id)
        }
    }, { context: { guildID } })
    .then(x => x.find(r => r))
    .catch(console.error)
    if (!guildData) return res.apiError("Could not fetch server info!");

    let dbObj = { }
    Object.entries(req.body).forEach(x => {
        let [key, val] = x
        let setting = schemaData.settingsIDs[key]
        if (!setting) return
        else dbObj["settings." + setting.db] = validateSetting(val, setting, guildData)
    })

    if (dbObj["settings.levelUp.embed"] && dbObj["settings.levelUp.message"]) {
        let lvlEmbed = new LevelUpEmbed(dbObj["settings.levelUp.message"])
        if (lvlEmbed.invalid) {
            dbObj["settings.levelUp.message"] = ""
            dbObj["settings.levelUp.embed"] = false
        }
        else dbObj["settings.levelUp.message"] = JSON.stringify(lvlEmbed.json())
    }

    // prevent min > max
    let xpMin = dbObj["settings.gain.min"]
    let xpMax = dbObj["settings.gain.max"]
    if (xpMin > xpMax) {
        dbObj["settings.gain.min"] = xpMax
        dbObj["settings.gain.max"] = xpMin
    }

    // prevent 0 curve
    if (dbObj["settings.curve.3"] == 0 && dbObj["settings.curve.2"] == 0 && dbObj["settings.curve.1"] == 0) dbObj["settings.curve.1"] = 1

    dbObj['info.lastUpdate'] = Date.now()

    client.db.update(guildID, { $set: dbObj }).exec().then(() => {
        return res.end("cool and good")
    }).catch(console.error)

})

app.post("/api/sendexample", async function(req, res) {
    if (typeof req.body != "object") return res.apiError("Invalid data!");
    if (!req.body.message) return res.apiError("No message!")

    let guildID = req.body.guildID
    if (!guildID) return res.apiError("No guild ID!");

    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!")

    let foundGuild = guilds.find(x => x.id == guildID)
    if (!foundGuild) return res.apiError("Not in server!")

    let canManage = canManageServer(foundGuild)
    if (!canManage) return res.apiError("Manage server permission required!")

    let forceLevel = req.body.level ? tools.clamp(Math.round(req.body.level), 1, 1000) : null

    let guildData = await client.shard.broadcastEval(async (cl, xd) => {
        let guild = cl.guilds.cache.get(xd.guildID)
        if (!guild) return null

        let server = {
            icon: guild.iconURL({format: "png", dynamic: true}),
        }

        let roles = guild.roles.cache.map(x => ({name: x.name, id: x.id}))

        let member = await guild.members.fetch(xd.userID).then(x => ({
            displayName: x.displayName,
            avatar: x.displayAvatarURL(),
            color: x.displayHexColor
        })).catch(() => ({}))

        return { server, roles, member }
    }, { context: { guildID, userID: user.id } })
    .then(x => x.find(r => r)) // filter out empty shards
    .catch(console.error)

    if (!guildData) return res.apiError("Could not fetch server info!");
 
    let data = await client.db.fetch(guildID, ["settings", `users.${user.id}`])
    if (!data || !data.settings) return res.apiError("No data!")
    let currentXP = forceLevel ? tools.xpForLevel(forceLevel, data.settings) : (data.users || [])[user.id]?.xp || 42069
    let currentLevel = forceLevel || tools.getLevel(currentXP, data.settings) || 1

    let msgData = {
        author: {
            id: user.id,
            username: user.username,
            displayName: user.global_name,
            discriminator: user.discriminator || "0",
        },
        member: {
            displayName: guildData.member.displayName || user.global_name || user.username,
            avatarLink: guildData.member.avatar || `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`
        },
        guild: {
            id: foundGuild.id,
            name: foundGuild.name,
            iconLink: guildData.server.icon || `https://cdn.discordapp.com/icons/${foundGuild.id}/${foundGuild.icon || "nope"}`
        },
        channel: {
            id: "944290668086448148",
            name: "channel"
        }
    }

    data.settings.levelUp.embed = !!req.body.embed
    data.settings.levelUp.message = req.body.message.slice(0, schemaData.settings.levelUp.message.maxlength)

    let storedPreviewUser = (data.users || [])[user.id] || {}
    let lvlMessage = new LevelUpMessage(data.settings, msgData, { level: currentLevel, roleList: guildData.roles, userData: { messages: 0, monthlyMessages: 0, ...storedPreviewUser, xp: currentXP }, example: true })
    if (lvlMessage.invalid) return res.apiError("Embed is invalid!");
     
    let fetchedUser = await client.users.fetch(user.id)
    fetchedUser.send( lvlMessage.msg )
    .then(() => res.end(JSON.stringify(lvlMessage.msg, null, 2)))
    .catch((e) => {
        fetchedUser.send(`**Error sending level up message!**\n\`\`\`${e.message}\`\`\``)
        .then(() => res.end("Error: " + e.message))
        .catch(() => {
            return res.apiError("Could not fetch server info!");
        })
    })
})

app.post("/api/pruneMembers", async function(req, res) {
    if (typeof req.body != "object") return res.apiError("Invalid data!");
    let num = Number(req.body.amount)

    if (!num || num <= 0) return res.apiError("No amount!")

    let guildID = req.body.guildID
    if (!guildID) return res.apiError("No guild ID!");

    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!")

    let foundGuild = guilds.find(x => x.id == guildID)
    if (!foundGuild) return res.apiError("Not in server!")

    let canManage = canManageServer(foundGuild)
    if (!canManage) return res.apiError("Manage server permission required!")

    let users = await client.db.fetch(guildID, ["users"]).then(x => x.users)
    let vals = Object.entries(users || {})
    let toPrune = vals.filter(x => (x[1].xp || 0) < num).length

    if (req.body.confirmPrune != "hell yes") {
        return res.send({ total: vals.length, matches: toPrune })
    }

    else {
        let newUsers = {}
        vals.forEach(x => {
            if ((x[1].xp || 0) >= num) newUsers[x[0]] = x[1]
        })
        client.db.update(guildID, { $set: { users: newUsers } }).exec().then(() => {
            return res.end(`Successfully pruned ${toPrune} user${toPrune == 1 ? "" : "s"}!`)
        }).catch(console.error)
    }

})

const importCooldowns = {}

app.post("/api/importfrombot", async function(req, res) {
    req.clearTimeout()
    req.setTimeout(60000)
    
    if (typeof req.body != "object" || !req.body.import || typeof req.body.import != "object") return res.apiError("Invalid data!");

    let guildID = req.body.guildID
    if (!guildID) return res.apiError("No guild ID!");

    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!")

    let isDev = tools.isDev(user)

    let foundGuild = guilds.find(x => x.id == guildID)
    if (!foundGuild && !isDev) return res.apiError("Not in server!")

    let canManage = canManageServer(foundGuild)
    if (!canManage && !isDev) return res.apiError("Manage server permission required!")

    let importSettings = req.body.import || {}
    let bot = importSettings.bot

    if (!Object.keys(importSettings).some(x => x != "bot")) return res.apiError("Invalid import options!")

    if (bot == "json") {
        if (!req.body.jsonData) return res.apiError("No .json data provided!")    
        if (!isDev) importSettings.settings = null;  // only devs can import settings
        else importSettings.isDev = true;
    }

    let importCode = `${guildID}-${bot}`
    if (importCooldowns[importCode] && importCooldowns[importCode] >= Date.now()) return res.apiError(`Please wait ${tools.time(importCooldowns[importCode] - Date.now(), 1)} seconds before the next import!`, "importCooldown")

    let newData;
    if (bot == "polaris") newData = await require("./commands/misc/polaris_transfer.js").run(client, guildID, importSettings, guilds)
    else if (bot == "json") newData = await require("./commands/misc/json_import.js").run(client, guildID, importSettings, req.body.jsonData)

    if (newData && newData.error) return res.apiError(newData.error, newData.code)
    else if (!newData || !newData.data || !Object.keys(newData.data).length) return res.apiError("No data!", "noData")

    else {
        client.db.update(guildID, { $set: newData.data }).exec()
        .then(() => {
            importCooldowns[importCode] = Date.now() + 60000
            res.end("Successfully imported!\n" + (newData.details || []).map(x => "- " + x).join("\n"))
        })
        .catch((e) => {
            console.error(e)
            if (bot == "json") return res.apiError(`The database rejected your json! Are the settings you provided valid? (Error: ${e.message})`)
            else return res.apiError(`Database error: ${e.message}`)
        })
    }


})

app.get("/api/leaderboard/:id", cors(), async function(req, res) {
    let guildID = req.params.id

    let data = await client.db.fetch(guildID)
    if (!data) return res.apiError("Invalid server!", "invalidServer");

    let settings = data.settings
    if (!settings.enabled) return res.apiError("XP is disabled in this server!", "xpDisabled")

    let singleUser = (req.query.user && req.query.user.match(/^\d{10,30}$/) ? req.query.user : null)

    let [userInfo, guildInfo] = singleUser ? [null, null] : await getDiscordInfo(req)
    let loggedIn = userInfo && guildInfo && userInfo.id
    let isInGuild = loggedIn && guildInfo.find(x => x.id == guildID)

    let isDev = tools.isDev(userInfo)
    let isMod = loggedIn && canManageServer(guildInfo.find(x => x.id == guildID))

    if (!isMod && settings.leaderboard.disabled) return res.apiError("The leaderboard is disabled in this server!", "leaderboardDisabled")

    // private leaderboard
    if (settings.leaderboard.private && !isInGuild) return res.apiError(loggedIn ? "Only server members can access this leaderboard!" : "This leaderboard is private! Login is required.", "privateLeaderboard")

    let minLeaderboardXP = settings.leaderboard.minLevel > 1 ? tools.xpForLevel(settings.leaderboard.minLevel, settings) : 0

    let rewardList = settings.leaderboard.hideRoles ? [] : settings.rewards.filter(x => x.level <= settings.maxLevel)
    let importantRoles = settings.multipliers.roles.concat(rewardList).map(x => x.id)
    
    // convert xp object to array (+ remove useless info like cooldowns)
    let xpArray = []
    let hiddenMembers = []

    Object.entries(data.users || {}).forEach(x => {
        if (!x || !x[0] || !x[1].xp || x[1].xp <= 0) return
        let isHidden = x[1].hidden
        if (!isHidden) xpArray.push(x)
        else if (isMod || isDev) hiddenMembers.push({ id: x[0], xp: x[1].xp })
    })

    xpArray = xpArray.sort((a, b) => b[1].xp - a[1].xp)
    .map((x, y) => ({ id: x[0], xp: x[1].xp, rank: y+1 })) 

    if (hiddenMembers.length) hiddenMembers = hiddenMembers.sort((a, b) => b.xp - a.xp)

    let trueTotalXP = xpArray.length
    let foundUser = xpArray.find(x => x.id == userInfo?.id)
    if (!foundUser) {
        let foundHidden = hiddenMembers.find(x => x.id == userInfo?.id)
        if (foundHidden) {
            foundUser = foundHidden
            foundUser.hidden = true
        }
    }
    if (singleUser) xpArray = xpArray.filter(x => x.id == singleUser)
    if (minLeaderboardXP > 0) xpArray = xpArray.filter(x => x.xp > minLeaderboardXP)
    if (settings.leaderboard.maxEntries > 0) xpArray = xpArray.slice(0, settings.leaderboard.maxEntries)

    let pageSize = tools.clamp(parseInt(req.query.pageSize || 100), 1, 100)
    let pageCount = Math.ceil(xpArray.length / pageSize)
    let page = Math.max(1, parseInt(req.query.page)) || 1
    
    let paginated = xpArray.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
    let memberList = paginated.map(x => x.id)
    if (loggedIn && !memberList.includes(userInfo.id)) memberList.push(userInfo.id)
    
    let guildData = await client.shard.broadcastEval(async (cl, xd) => {
        let guild = cl.guilds.cache.get(xd.guildID)
        if (!guild) return null

        let server = {
            name: guild.name,
            icon: guild.iconURL({format: "png", dynamic: true}),
            members: guild.memberCount,
            owner: guild.ownerId,
        }

        let roles = guild.roles.cache.filter(r => xd.importantRoles.includes(r.id)).sort((a, b) => b.position - a.position).map(x => ({
            id: x.id,
            name: x.name,
            color: x.hexColor
        }))

        let members = await guild.members.fetch({user: xd.members}).then(list => list.map(x => ({
            id: x.user.id,
            username: x.user.username,
            displayName: x.user.displayName,
            discriminator: x.user.discriminator || "0",
            nickname: x.nickname,
            avatar: x.displayAvatarURL({format: "png", dynamic: true}),
            color: x.displayHexColor,
            roles: x.roles.cache.filter(r => xd.importantRoles.includes(r.id)).map(r => r.id)
        }) )).catch((() => []))

        return { server, roles, members }

    }, { context: { members: memberList, guildID, importantRoles } })
    .then(x => x.find(r => r)) // filter out empty shards
    .catch(console.error)
    
    if (!guildData) return res.apiError("Couldn't get server data!")

    let guildMembers = guildData.members

    settings = clearDeletedData(settings, guildData.roles)
    if (rewardList.length) rewardList = settings.rewards

    paginated = paginated.map(raw => {
        let data = raw
        let found = guildMembers.find(g => g.id == data.id)
        if (found) data = Object.assign(data, found)
        else data.missing = true
        return data
    })

    // if logged in, show level info
    let userLevel = { noLogin: true }
    if (loggedIn) {
        let foundInPage = paginated.find(x => x.id == userInfo.id && !x.missing)
        if (foundInPage) userLevel = foundInPage
        else {
            let foundAsMember = guildMembers.find(x => x.id == userInfo.id)
            if (!foundAsMember && isInGuild) foundAsMember = {
                partial: true, id: userInfo.id, username: userInfo.username, displayName: userInfo.global_name,
                discriminator: userInfo.discriminator || "0", color: "#" + (userInfo.accent_color || 0xffffff).toString(16),
                avatar: `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}`, roles: []
            }
            if (foundUser && foundAsMember) userLevel = Object.assign(foundUser, foundAsMember)
            else userLevel = { missing: true, debug: { member: guildMembers.find(x => x.id == userInfo.id)?.id || "-", user: foundUser?.id || "-", info: userInfo?.id || "-" } }
        }

        userLevel.banner = userInfo.banner ? `https://cdn.discordapp.com/banners/${userInfo.id}/${userInfo.banner}.${userInfo.banner.startsWith("a_") ? "gif" : "png"}?size=600` : null
        userLevel.accentColor = userInfo.accent_color != null ? `#${userInfo.accent_color.toString(16).padStart(6, "0")}` : null
    }
    if (userLevel.partial) delete userLevel.missing

    // *almost* all settings
    let importantSettings = {
        enabled: settings.enabled,
        gain: settings.gain,
        curve: settings.curve, rounding: settings.rounding,
        multipliers: { roles: settings.multipliers.roles, rolePriority: settings.multipliers.rolePriority },
        leaderboard: settings.leaderboard,
        rewards: rewardList,
        rankCard: settings.rankCard,
        maxLevel: settings.maxLevel
    }

    if (settings.hideMultipliers) {
        importantSettings.hideMultipliers = true
        importantSettings.multipliers.roles = []
    }

    guildData.server.totalRanked = xpArray.length
    if (xpArray.length < trueTotalXP) guildData.server.totalPartial = true

    if (loggedIn && userLevel && !userLevel.noLogin) {
        const storedUser = data.users?.[userInfo.id] || {}
        // Reset lógico: marcador por usuario manda, de fallback el global.
        // Así se muestra 0 aunque el scheduler/lazy aún no haya flipeado.
        const effective = (kind) => {
            try {
                if (kind === "daily") {
                    const today = new Intl.DateTimeFormat("en-CA", {
                        timeZone: "Europe/Madrid",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                    }).format(new Date())
                    if (storedUser.dailyPeriod) {
                        if (String(storedUser.dailyPeriod) !== today) return 0
                    } else if (data.info?.dailyMessagesPeriod) {
                        if (String(data.info.dailyMessagesPeriod) !== today) return 0
                        return 0
                    } else if (data.info) {
                        return 0
                    }
                    return Number(storedUser.dailyMessages) || 0
                }
                const parts = new Intl.DateTimeFormat("en", {
                    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit",
                }).formatToParts(new Date())
                const v = Object.fromEntries(parts.map(p => [p.type, p.value]))
                const month = `${v.year}-${v.month}`
                if (storedUser.monthlyPeriod) {
                    if (String(storedUser.monthlyPeriod) !== month) return 0
                } else if (data.info?.monthlyMessagesPeriod) {
                    if (String(data.info.monthlyMessagesPeriod) !== month) return 0
                    return 0
                } else if (data.info) {
                    return 0
                }
                return Number(storedUser.monthlyMessages) || 0
            } catch { return 0 }
        }
        userLevel.records = storedUser.records || {}
        userLevel.messages = Number(storedUser.messages) || 0
        userLevel.monthlyMessages = effective("monthly")
        userLevel.dailyMessages = effective("daily")
        userLevel.reactionsSent = Number(storedUser.reactionsSent) || 0
        userLevel.reactionsReceived = Number(storedUser.reactionsReceived) || 0
        userLevel.countingSent = Number(storedUser.countingSent) || 0
        userLevel.pokemonCaught = Number(storedUser.pokemonCaught) || 0
        userLevel.voiceMinutes = Number(storedUser.voiceMinutes) || 0
        userLevel.streak = storedUser.streak || 0
    }

    return res.send({
        guild: guildData.server,
        user: userLevel,
        leaderboard: paginated,
        settings: importantSettings,
        roles: guildData.roles,
        records: recordsConfig.categories,
        moderator: isMod,
        hiddenMembers,
        pageInfo: { page, pageCount, pageSize },
    })
})

app.post("/api/editXP", async function(req, res) {
    if (typeof req.body != "object") return res.apiError("Invalid  data!");

    let guildID = req.body.guildID
    if (!guildID) return res.apiError("No guild ID!");

    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!")

    let foundGuild = guilds.find(x => x.id == guildID)
    if (!foundGuild) return res.apiError("Not in server!")

    let canManage = canManageServer(foundGuild)
    if (!canManage) return res.apiError("Manage server permission required!")

    let newXP = Math.round(req.body.xp)
    if (!newXP && newXP !== 0) return res.apiError("Invalid XP amount!")
    newXP = tools.clamp(newXP, 0, (1e16 - 1))

    let foundXP = await client.db.fetch(guildID, [`users.${req.body.user}`])
    if (!foundXP?.users || !foundXP.users[req.body.user]) return res.apiError("This user isn't ranked!")

    client.db.update(guildID, { $set: { [`users.${req.body.user}.xp`]: newXP } }).exec().then(() => res.end("cool and good"))
    .catch(() => res.apiError("Unknown error!"));
})

app.post("/api/leaderboardHide", async function(req, res) {
    if (typeof req.body != "object") return res.apiError("Invalid  data!");

    let guildID = req.body.guildID
    if (!guildID) return res.apiError("No guild ID!");

    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!")

    let foundGuild = guilds.find(x => x.id == guildID)
    if (!foundGuild) return res.apiError("Not in server!")

    let canManage = canManageServer(foundGuild)
    if (!canManage) return res.apiError("Manage server permission required!")

    let setHide = notFalse(req.body.hide)

    let foundXP = await client.db.fetch(guildID, [`users.${req.body.user}`])
    if (!foundXP?.users || !foundXP.users[req.body.user]) return res.apiError("This user isn't ranked!")

    client.db.update(guildID, { $set: { [`users.${req.body.user}.hidden`]: setHide } }).exec().then(() => res.end("cool and good"))
    .catch(() => res.apiError("Unknown error!"));
})

app.get("/api/xp/:id", cors(), async function(req, res) {
    let guildID = req.params.id
    let data = await client.db.fetch(guildID)
    if (!data) return res.apiError("Invalid server!");

    let [user, guilds] = await getDiscordInfo(req)
    if (!user || !guilds) return res.apiError("Not logged in!")

    let force = tools.isDev(user)

    let foundGuild = guilds.find(x => x.id == guildID)
    if (!foundGuild && !force) return res.apiError("Not in server!")

    let canManage = canManageServer(foundGuild)
    if (!canManage && !force) return res.apiError("Manage server permission required!")

    let xpList = tools.xpObjToArray(data.users || []).sort((a, b) => b.xp - a.xp)
    
    let format = (req.query.format || "").toLowerCase()

    switch (format) {

        case "txt": // plain text
            return res.send(xpList.map(x => `${x.id} - ${x.xp}`).join("\n"))

        case "csv": // spreadsheet
            let header = "ID,Total XP\n"
            return res.send(header + xpList.map(x => `${x.id},${x.xp}`).join("\n"))
        
        case "everything": // full data
            return res.send({ settings: data.settings, users: data.users })
            
        default: // xp json
            return res.send(`[\n${xpList.map(x => `\t{ "id": "${x.id}", "xp": ${x.xp} },`).join("\n").slice(0, -1)}\n]`)
    }
})



// ========================================================================= \\
// ======= WELCOME TO THE DISCORD AUTHORIZATION SECTION OF THE CODE! ======= \\
// ========================================================================= \\

/* STEP 1
The client visits this URL, which takes them to a Discord authorization page
By authorizing, they give permission for us to view basic info and see what servers they're in (identify + guilds) */
app.get("/discord", function(req, res) { return res.redirect(discord_auth) })

/* STEP 2
After authorizing, Discord redirects them to /auth over on our end, with a few secret codes that we can use
Think of these codes as a parent signed permission slip for us to get the data they authorized for */ 
app.get("/auth", async function(req, res) {

    // if they actually authorized, there will be a code here
    if (req.query.code && req.query.code.length > 10) { 

        // prove we're allowed to do this
        let authCreds = Buffer.from(`${process.env.DISCORD_ID}:${process.env.DISCORD_SECRET}`).toString('base64');

        // make a request to the discord token endpoint, to show that the code is in the right hands
        // tried using rest for this but ran into issues, oh well
        fetch(discordAPI + "/oauth2/token", {
            method: "POST",
            headers: {
                "Authorization": `Basic ${authCreds}`,
                "Content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: req.query.code,
                redirect_uri: siteURL + "/auth"
            })
        }).then(x => x.json()).then(data => {
            if (data["error"]) return sendRedirect(res, "/"); // if discord sends an error (fake code, etc)
            else return storeAuthToken(res, data) // if we reach here, it means the code was valid! on to step 3!
        }).catch(e => { console.error(e); sendRedirect(res, "/?authorized") })
    }
    
    // if there's no code, do nothing
    else sendRedirect(res, "/?authorized");
})

/* STEP 3
Discord gave us the codes we need to get their private information, let's goooo!
Now it gets stored in the database for a week, and we give the client our own made up token so we know when it's them */ 
function storeAuthToken(res, tokens) {
    let randomNumbers = [tools.rng(1e3, 1e4-1), tools.rng(1e4, 1e5-1), tools.rng(1e5, 1e6-1), tools.rng(1e6, 1e7-1), Number(Date.now().toString().slice(-7))]
    let randomID = randomNumbers.map(x => x.toString(16)).join("-") // just combine a bunch of random numbers!!!! pretty much anything goes here
    let expiration = Date.now() + (1000 * tokens.expires_in) // when the token expires (one week)
    authDB.delete({ expires: { $lt: Date.now() } }).then(() => {}) // clear expired tokens
    authDB.create({ _id: randomID, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires: expiration }).then((data) => {
        res.cookie("polaris", randomID, { "expires": new Date(expiration) });
        sendRedirect(res, "/?authorized") // sweet, back to the homepage
    }).catch((e) => { console.error(e); sendRedirect(res, "/") })
}

/* STEP 4
Everything's in place, so now we can make requests using the token!
But first we need a way to check if the client's token matches up with the one on our server
Also, "token" no longer sounds like a word to me */
let tokenCache = {} // cache tokens to speed things up a little
async function getDiscordToken(token) {
    if (!token) return null
    let foundCache = tokenCache[token] // check the cache for the token stuff
    if (foundCache && foundCache.expires > Date.now()) return foundCache // if it exists, send that instead of checking the database
    return await authDB.fetch(token).then(data => { // otherwise, check the database
        if (data && data.access_token && data.expires > Date.now()) { // if a token was found, cache and return it
            tokenCache[token] = data
            return data
        }
        else return null // if no token was found, return nothing
    }).catch(e => null)
}

/* STEP 5
Now we can make requests to Discord to get the client's stuff! */
let discordCache = {} // cache data to prevent rate limits
async function getDiscordInfo(req, userOnly) {
    let token = await getDiscordToken(req.cookies.polaris) // get discord's tokens using the token in their cookies
    if (!token) return userOnly ? null : [null, null]

    let foundData = discordCache[token] // check for cached data
    if (foundData && Date.now() <= foundData.expires) return foundData.data // return cached data if it exists and hasn't expired

    // the two things the client authorized - user data and guilds. this is all we need
    let options = { auth: false, headers: { authorization: `Bearer ${token.access_token}` } };
    let userData = await rest.get("/users/@me", options).catch(e => null)
    if (userOnly) return userData || null

    // /users/@me/guilds is paginated (200 max per request), so keep paging until we run out
    // otherwise users in 200+ servers can be missing from this list, breaking their mod/owner status
    let guilds = []
    let after = null
    while (true) {
        let page = await rest.get(`/users/@me/guilds?limit=200${after ? `&after=${after}` : ""}`, options).catch(e => null)
        if (!page || page.message || !Array.isArray(page)) { guilds = page; break } // propagate error as-is
        guilds = guilds.concat(page)
        if (page.length < 200 || guilds.length >= 2000) break // no more pages, or hit safety cap
        after = page[page.length - 1].id
    }

    if (!userData || !guilds || userData.message || guilds.message || !userData.id) return [null, null] // if discord sends error
    let discordRes = [userData, guilds] // return this as an array, so we can do "let [userData, guilds]"
    discordCache[token] = {data: discordRes, expires: Date.now() + 15000} // 15 second cache to prevent ratelimits uwu
    return discordRes
}

/* STEP 6
If the client wants to log out, we should probably respect that and delete their stuff */
app.get("/logout", async function(req, res) {
    let token = await getDiscordToken(req.cookies.polaris)
    if (!token) return sendRedirect(res, "/")

    fetch(discordAPI + "oauth2/token/revoke", {
        method: "POST",
        headers: { "Content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: auth.id,
            client_secret: auth.secret,
            token
        })
    }).then(() => { // discord has invalidated the token!
        res.clearCookie("polaris"); // remove token from cookies
        sendRedirect(res, "/"); // return home
    }).catch(e => sendRedirect(res, "/"))
})

// ========================================================================= \\
// ===== OK BYE THAT'S ALL THE AUTHORIZATION CODE HOPE IT DOESN'T SUCK ===== \\
// ========================================================================= \\

app.get("/api", function(req, res) { res.send("ඞ") })

app.get("*", function(req, res) { res.status(404); sendPage(res, "404") })

app.use(function (err, req, res, next) {
    if (err && err.message == "Response timeout") res.status(500).send({ apiError: true, internalError: true, message: 'Internal server error! (Timed out)'})
    else {
        console.warn(err)
        res.status(500).send({ apiError: true, internalError: true, message: `Internal server error! (${err.message})`})
    }
})

process.on('uncaughtException', (e) => { console.warn(e) });
process.on('unhandledRejection', (e, p) => { console.warn(e) });

app.listen(auth.serverPort, () => console.log(`Web server online at http://localhost:${auth.serverPort} (${+process.uptime().toFixed(2)} secs)`));

}