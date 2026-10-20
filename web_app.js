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
const Drops = require("./classes/Drops.js")
const { createDropRateLimiter } = require("./app/celebration-page.js")
// Tope anti-fuerza-bruta en páginas de drops (ver createDropRateLimiter).
const dropRateLimit = createDropRateLimiter()
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

// Subdominio dedicado a drops (config.json -> dropsHostname, p. ej.
// drops.tscomunity.es): ahí solo viven las páginas de drops, /discord y
// /auth; lo demás redirige a la web principal. Requiere apuntar el
// subdominio al mismo puerto en nginx (ver drops.tscomunity.es.nginx).
app.use(function(req, res, next) {
    const dropsHost = Drops.dropsHostname()
    if (!dropsHost || req.hostname !== dropsHost) return next()
    if (/^\/(drop|discord|auth)(\/|$)/.test(req.path)) return next()
    // Ruta corta de drops: /<servidor>/<CODIGO>.
    if (/^\/\d{10,30}\/[A-Z0-9]{6,10}\/?$/.test(req.path)) return next()
    return res.redirect(`${siteURL}${req.originalUrl}`)
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
    const { renderCelebrationPage, escapeHtml } = require("./app/celebration-page.js")
    const [user, guilds] = await getDiscordInfo(req)
    const guildId = resolveServerId({ guildId: req.query.guild || req.query.server || req.query.guildId, guilds, defaultGuildId: DEFAULT_EASTEREGG_GUILD_ID })

    const meta = getWebEasterMeta()
    // El módulo ya escapa el título: aquí va el valor crudo.
    const eggNameRaw = meta?.tier?.name || meta?.record?.label || "Al otro lado"
    const eggName = escapeHtml(eggNameRaw)
    const eggDesc = escapeHtml(meta?.tier?.desc || "Encuentra el secreto escondido en la web.")
    const eggXp = Number(meta?.tier?.xp ?? 20000)
    const xpStr = `+${eggXp.toLocaleString("es-ES")} XP`
    // Textos cortos: el título lleva el nombre del reto y el párrafo no lo
    // repite. Tras reclamar, dos CTA: rango (primario) y records (secundario).
    const rewardDetail = (note) => `<div class="detail"><span>Recompensa</span><strong><img src="/assets/icons/xp.png" alt="XP">${escapeHtml(xpStr)}</strong><small>${note}</small></div>`

    if (!user) {
        // Sin sesión: celebra el hallazgo, pero el CTA es iniciar sesión.
        const anonGuild = escapeHtml((guildId && client.guilds.cache.get(guildId)?.name) || guildId || "el servidor")
        return res.status(401).send(renderCelebrationPage({
            title: "¡Easter egg encontrado!",
            message: `Has descubierto el logro oculto <strong>${eggName}</strong> en <strong>${anonGuild}</strong>. Inicia sesión con Discord para reclamarlo.`,
            badge: "egg",
            kicker: "Logro oculto",
            status: "login",
            celebration: true,
            detailsHtml: rewardDetail(`${eggDesc}. Se suma a tu XP y a tu XP mensual.`),
            actionsHtml: `<a class="btn-primary" href="/discord?next=${encodeURIComponent(req.originalUrl)}">Iniciar sesión para reclamar</a>`
                + (guildId ? `<a class="secondary" href="/leaderboard/${encodeURIComponent(guildId)}">Ver clasificación</a>`
                    : `<a class="secondary" href="/servers">Ir al dashboard</a>`),
        }))
    }

    if (!guildId) {
        return res.status(400).send(renderCelebrationPage({
            title: "Easter egg",
            message: "No pude detectar el servidor. Abre el secreto desde la web o añade ?guild=TU_ID.",
            badge: "egg",
            status: "info",
            celebration: false,
            actionsHtml: `<a class="btn-primary" href="/servers">Ir al dashboard</a>`,
        }))
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
    const name = escapeHtml(client.guilds.cache.get(guildId)?.name || (Array.isArray(guilds) ? guilds.find(g => String(g.id) === String(guildId))?.name : null) || guildId)
    const progress = result.result
        ? `${result.result.totalCompleted ?? result.result.done ?? 1}/${result.result.totalVisible ?? result.result.total ?? 1} Records`
        : null
    const progressDetail = progress ? `<div class="detail"><span>Tu progreso</span><strong><img src="/assets/icons/records.png" alt="Records">${escapeHtml(progress)}</strong><small>Sigue con /records en Discord o en la web.</small></div>` : ""

    if (result.unlocked) {
        return res.send(renderCelebrationPage({
            title: eggNameRaw,
            message: `Logro oculto conseguido en <strong>${name}</strong>: la recompensa ya está sumada a tu XP y a tu XP mensual.`,
            badge: "trophy",
            kicker: "Desbloqueado",
            status: "success",
            celebration: true,
            detailsHtml: rewardDetail(eggDesc) + progressDetail,
            actionsHtml: `<a class="btn-primary" href="/rank/${encodeURIComponent(guildId)}">Ver mi rango</a>`
                + `<a class="secondary" href="/records/${encodeURIComponent(guildId)}">Ver records</a>`,
        }))
    }

    return res.send(renderCelebrationPage({
        title: eggNameRaw,
        message: `Ya reclamaste este secreto en <strong>${name}</strong>: la recompensa no se repite, pero puedes volver a celebrarlo cuando quieras.`,
        badge: "check",
        kicker: "Ya lo tienes",
        status: "claimed",
        celebration: "soft",
        detailsHtml: rewardDetail(`${eggDesc} — ya la recibiste la primera vez.`) + progressDetail,
        actionsHtml: `<a class="btn-primary" href="/rank/${encodeURIComponent(guildId)}">Ver mi rango</a>`
            + `<a class="secondary" href="/records/${encodeURIComponent(guildId)}">Ver records</a>`,
    }))
})


// Drops de XP: el staff crea un reparto (/drop) y este enlace lo reclama.
// Abrir el enlace con sesión iniciada reclama directamente (una vez por
// persona, hasta agotar usos o que caduque).
async function handleDropClaim(req, res) {
    const { renderCelebrationPage, escapeHtml: escapeDropHtml } = require("./app/celebration-page.js")
    const Drops = require("./classes/Drops.js")

    const guildId = String(req.params.guild || "")
    const code = String(req.params.code || "").toUpperCase()
    const validPath = /^\d{10,30}$/.test(guildId) && /^[A-Z0-9]{6,10}$/.test(code)

    const [user] = await getDiscordInfo(req)
    const doc = validPath ? await client.db.fetch(guildId, ["drops"]).exec().catch(() => null) : null
    const drop = validPath ? (doc?.drops || {})[code] : null
    const guildName = escapeDropHtml(client.guilds.cache.get(guildId)?.name || guildId || "el servidor")
    const leaderboardHref = `/leaderboard/${encodeURIComponent(guildId)}`

    // Premio resumido en una frase (para mensajes de estado).
    const dropPrize = d => {
        if (d.kind === "bundle") {
            const p = d.prizes || {}
            const parts = []
            if (Number(p.xp) > 0) parts.push(`${Number(p.xp).toLocaleString("es-ES")} XP`)
            if (Number(p.coins) > 0) parts.push(`${Number(p.coins).toLocaleString("es-ES")} monedas`)
            for (const r of (Array.isArray(p.roles) ? p.roles : [])) parts.push(`rol ${escapeDropHtml(r.name || "del evento")}`)
            for (const it of (Array.isArray(p.items) ? p.items : [])) parts.push(`${Number(it.qty).toLocaleString("es-ES")}x ${escapeDropHtml(it.name || "objeto")}`)
            return parts.join(" + ") || "un pack vacío"
        }
        if (d.kind === "role") return `rol ${escapeDropHtml(d.roleName || "del evento")}`
        if (d.kind === "item") return `${Number(d.amount).toLocaleString("es-ES")}x ${escapeDropHtml(d.itemName || "objeto")}`
        return `+${Number(d.amount).toLocaleString("es-ES")} ${Drops.kindName(d.kind)}`
    }

    // Apartado 1: lista de recompensas personalizada, una fila por premio.
    const rewardRows = d => {
        const rows = []
        if (d.kind === "bundle") {
            const p = d.prizes || {}
            if (Number(p.xp) > 0) rows.push([`+${Number(p.xp).toLocaleString("es-ES")} XP`, "se suma a tu XP y a tu XP mensual"])
            if (Number(p.coins) > 0) rows.push([`+${Number(p.coins).toLocaleString("es-ES")} monedas`, "van a tu cash de UnbelievaBoat"])
            for (const r of (Array.isArray(p.roles) ? p.roles : [])) rows.push([`Rol ${escapeDropHtml(r.name || "del evento")}`, "tuyo para siempre"])
            for (const it of (Array.isArray(p.items) ? p.items : [])) rows.push([`${Number(it.qty).toLocaleString("es-ES")}x ${escapeDropHtml(it.name || "objeto")}`, "a tu inventario de UnbelievaBoat"])
        } else if (d.kind === "coins") {
            rows.push([`+${Number(d.amount).toLocaleString("es-ES")} monedas`, "van a tu cash de UnbelievaBoat"])
        } else if (d.kind === "role") {
            rows.push([`Rol ${escapeDropHtml(d.roleName || "del evento")}`, "tuyo para siempre"])
        } else if (d.kind === "item") {
            rows.push([`${Number(d.amount).toLocaleString("es-ES")}x ${escapeDropHtml(d.itemName || "objeto")}`, "a tu inventario de UnbelievaBoat"])
        } else {
            rows.push([`+${Number(d.amount).toLocaleString("es-ES")} XP`, "se suma a tu XP y a tu XP mensual"])
        }
        return rows.map(([value, note]) => `<div class="rewardRow"><b>${value}</b><small>${note}</small></div>`).join("")
    }
    const rewardsDetail = d => `<div class="detail"><span>Recompensas</span>${rewardRows(d)}</div>`

    // Apartado 2: cuántos han reclamado, con barra de progreso.
    const claimsDetail = (d, left) => {
        const claimed = Math.max(0, (d.maxClaims || 0) - Math.max(0, left))
        const pct = d.maxClaims > 0 ? Math.min(100, Math.round((claimed / d.maxClaims) * 100)) : 100
        return `<div class="detail"><span>Reclamados</span><strong>${claimed} de ${d.maxClaims}</strong><div class="claimBar"><i style="width:${pct}%"></i></div><small>${left > 0 ? `Quedan ${left} usos.` : "No quedan usos."}</small></div>`
    }

    // Apartado 3: cuenta atrás viva si sigue abierto; fecha de cierre si no.
    const expiryDetail = (d, ended) => {
        if (ended) {
            const closed = new Date(d.expiresAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            return `<div class="detail"><span>Cerró el</span><strong class="countdownPast">${escapeDropHtml(closed)}</strong><small>El enlace ya no reparte premios.</small></div>`
        }
        return `<div class="detail"><span>Caduca en</span><strong class="countdown" id="dropCountdown" data-expires="${Number(d.expiresAt) || 0}">…</strong><small>Después el enlace deja de funcionar.</small></div>`
    }
    const expiredDrop = d => Number(d.expiresAt) <= Date.now()

    // CTA fija: rango primero (donde se ve el resultado) y records después.
    const serverButtons = `<a class="btn-primary" href="/rank/${encodeURIComponent(guildId)}">Ver mi rango</a>`
        + `<a class="secondary" href="/records/${encodeURIComponent(guildId)}">Ver records</a>`

    if (!validPath || !drop) {
        return res.status(404).send(renderCelebrationPage({
            title: "Este drop no existe",
            message: "Revisa que el enlace esté completo: lo crea el staff con <strong>/drops</strong> y puede haberse borrado.",
            badge: "search",
            status: "info",
            celebration: false,
            actionsHtml: `<a class="secondary" href="/servers">Ir al dashboard</a>`,
        }))
    }

    const check = Drops.validateClaim(drop, user?.id || "", Date.now())
    const left = Drops.claimsLeft(drop)
    const dropDetails = (d, l, ended = expiredDrop(d)) => rewardsDetail(d) + claimsDetail(d, l) + expiryDetail(d, ended)

    if (!user) {
        return res.status(401).send(renderCelebrationPage({
            title: drop.name,
            message: `El staff de <strong>${guildName}</strong> está repartiendo <strong>${dropPrize(drop)}</strong>. <strong>Inicia sesión con Discord</strong> para reclamar el tuyo antes de que se agote o caduque.`,
            badge: "gift",
            status: "login",
            celebration: "soft",
            detailsHtml: dropDetails(drop, left),
            actionsHtml: `<a class="btn-primary" href="/discord?next=${encodeURIComponent(req.path)}">Iniciar sesión para reclamar</a>`
                + `<a class="secondary" href="${leaderboardHref}">Ver clasificación</a>`,
        }))
    }

    if (expiredDrop(drop)) {
        return res.send(renderCelebrationPage({
            title: drop.name,
            message: `Cerró el ${new Date(drop.expiresAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. El enlace ya no reparte premios.`,
            badge: "hourglass",
            kicker: "Terminado",
            status: "expired",
            celebration: false,
            detailsHtml: rewardsDetail(drop) + claimsDetail(drop, left) + expiryDetail(drop, true),
            actionsHtml: serverButtons,
        }))
    }

    if (check.reason === "expired") {
        return res.send(renderCelebrationPage({
            title: drop.name,
            message: "Este drop terminó hace un momento. Estate atento a los próximos que lance el staff.",
            badge: "hourglass",
            kicker: "Terminado",
            status: "expired",
            celebration: false,
            detailsHtml: rewardsDetail(drop) + claimsDetail(drop, 0) + expiryDetail(drop, true),
            actionsHtml: serverButtons,
        }))
    }

    if (check.reason === "soldout") {
        return res.send(renderCelebrationPage({
            title: drop.name,
            message: "Todos los usos ya están repartidos. ¡Más suerte la próxima vez!",
            badge: "gift",
            kicker: "Agotado",
            status: "info",
            celebration: false,
            detailsHtml: rewardsDetail(drop) + claimsDetail(drop, 0),
            actionsHtml: serverButtons,
        }))
    }

    if (check.reason === "already") {
        return res.send(renderCelebrationPage({
            title: drop.name,
            message: "Ya pediste este drop antes. Cada persona solo puede reclamarlo una vez.",
            badge: "check",
            kicker: "Ya lo tienes",
            status: "claimed",
            celebration: "soft",
            detailsHtml: dropDetails(drop, left),
            actionsHtml: serverButtons,
        }))
    }

    const claimed = await Drops.claimDrop(client, guildId, code, String(user.id))
    if (!claimed.ok) {
        if (claimed.reason === "role-hierarchy") {
            return res.status(403).send(renderCelebrationPage({
                title: drop.name,
                message: `El rol de este drop está <strong>por encima de tu rol más alto</strong>, así que no se entrega. Avisa al staff. <strong>No has perdido tu reclamo.</strong>`,
                badge: "alert",
                kicker: "Rol no entregado",
                status: "info",
                celebration: false,
                detailsHtml: dropDetails(claimed.drop || drop, Drops.claimsLeft(claimed.drop || drop)),
                actionsHtml: serverButtons,
            }))
        }
        if (claimed.reason === "role-unsafe") {
            return res.status(403).send(renderCelebrationPage({
                title: drop.name,
                message: `El rol cambió desde que se creó el drop y ahora tiene <strong>permisos peligrosos</strong>, así que no se entrega. Avisa al staff para que lo revise. <strong>No has perdido tu reclamo.</strong>`,
                badge: "alert",
                kicker: "Rol no entregado",
                status: "info",
                celebration: false,
                detailsHtml: dropDetails(claimed.drop || drop, Drops.claimsLeft(claimed.drop || drop)),
                actionsHtml: serverButtons,
            }))
        }
        if (claimed.reason === "api-error") {
            const retryNote = claimed.drop?.kind === "coins"
                ? "No se pudo conectar con UnbelievaBoat."
                : "No se pudo entregar el premio (rol sin permisos o economía caída)."
            return res.status(502).send(renderCelebrationPage({
                title: drop.name,
                message: `${retryNote} <strong>No has perdido tu reclamo: recarga la página e inténtalo de nuevo.</strong> Si sigue fallando, avisa al staff.`,
                badge: "alert",
                kicker: "Error",
                status: "info",
                celebration: false,
                detailsHtml: dropDetails(claimed.drop || drop, Drops.claimsLeft(claimed.drop || drop)),
                actionsHtml: `<a class="btn-primary" href="">Reintentar</a>` + serverButtons,
            }))
        }
        if (claimed.reason === "missing") {
            return res.status(404).send(renderCelebrationPage({
                title: "Este drop no existe",
                message: "Justo se ha borrado: revisa el enlace si quieres los próximos.",
                badge: "search",
                status: "info",
                celebration: false,
                actionsHtml: `<a class="secondary" href="/servers">Ir al dashboard</a>`,
            }))
        }
        return res.send(renderCelebrationPage({
            title: drop.name,
            message: "Justo se te han adelantado: ya no quedan usos.",
            badge: "gift",
            kicker: "Agotado",
            status: "info",
            celebration: false,
            detailsHtml: rewardsDetail(drop) + claimsDetail(drop, 0),
            actionsHtml: serverButtons,
        }))
    }

    return res.send(renderCelebrationPage({
        title: drop.name,
        message: `Has reclamado tu parte del drop. ${walletNote(claimed.drop)}`,
        badge: "trophy",
        kicker: "Reclamado",
        status: "success",
        celebration: true,
        detailsHtml: dropDetails(claimed.drop, claimed.claimsLeft),
        actionsHtml: serverButtons,
    }))
}


app.get("/drop/:guild/:code", dropRateLimit, handleDropClaim)
// En el subdominio de drops la ruta es corta: drops.tscomunity.es/<guild>/<CODE>.
// Fuera de él redirige a la completa para no duplicar URLs.
app.get("/:guild(\\d{10,30})/:code([A-Z0-9]{6,10})", function(req, res, next) {
    const dropsHost = Drops.dropsHostname()
    if (dropsHost && req.hostname === dropsHost) return dropRateLimit(req, res, () => handleDropClaim(req, res))
    return res.redirect(`/drop/${req.params.guild}/${req.params.code}`)
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

// Vistas de la clasificación al estilo de /top en el bot: cada clave ordena
// por un dato que ya vive en la DB. Mensuales/diarios usan el "reset lógico"
// (marcador por usuario manda, fallback el marcador global del server).
const TOP_VIEWS = {
    xp: { label: "XP total", get: user => Number(user?.xp) || 0 },
    monthly: { label: "XP este mes", get: user => Number(user?.monthlyXP) || 0 },
    daily: { label: "XP de hoy", get: user => Number(user?.dailyXP) || 0 },
    messages: { label: "Mensajes", get: user => Number(user?.messages) || 0 },
    monthlyMessages: { label: "Mensajes este mes", get: (user, ctx) => effectiveMessages(user, "monthly", ctx) },
    dailyMessages: { label: "Mensajes de hoy", get: (user, ctx) => effectiveMessages(user, "daily", ctx) },
    voiceMinutes: { label: "Tiempo en voz", unit: "min en voz", get: user => Number(user?.voiceMinutes) || 0 },
    pokemonCaught: { label: "Poketwo", unit: "poketwo", get: user => Number(user?.pokemonCaught) || 0 },
    coinsMax: { label: "Monedas máximas", unit: "monedas", get: user => Number(user?.coinsMax) || 0 },
    reactionsSent: { label: "Reacciones enviadas", unit: "reacciones", get: user => Number(user?.reactionsSent) || 0 },
    reactionsReceived: { label: "Reacciones recibidas", unit: "reacciones", get: user => Number(user?.reactionsReceived) || 0 },
    countingSent: { label: "Números en counting", unit: "números", get: user => Number(user?.countingSent) || 0 },
    streak: { label: "Racha", unit: "días", get: user => typeof user?.streak === "object" ? Number(user?.streak?.current ?? user?.streak?.days) || 0 : Number(user?.streak) || 0 },
}

function periodContext() {
    const now = new Date()
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now)
    const parts = new Intl.DateTimeFormat("en", {
        timeZone: "Europe/Madrid", year: "numeric", month: "2-digit",
    }).formatToParts(now)
    const v = Object.fromEntries(parts.map(p => [p.type, p.value]))
    return { today, month: `${v.year}-${v.month}` }
}

// Mensajes del mes/día "en vigor": 0 si el periodo del usuario ya pasó o si
// el server aún no marcó el suyo. Idéntico a la closure effective() del
// endpoint, pero con las fechas precalculadas para no pagar Intl en orden.
function effectiveMessages(userData, kind, ctx) {
    try {
        if (kind === "daily") {
            if (userData?.dailyPeriod) {
                if (String(userData.dailyPeriod) !== ctx.today) return 0
            } else if (ctx.info?.dailyMessagesPeriod || ctx.info) {
                return 0
            }
            return Number(userData?.dailyMessages) || 0
        }
        if (userData?.monthlyPeriod) {
            if (String(userData.monthlyPeriod) !== ctx.month) return 0
        } else if (ctx.info?.monthlyMessagesPeriod || ctx.info) {
            return 0
        }
        return Number(userData?.monthlyMessages) || 0
    } catch { return 0 }
}

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
    
    // convert xp object to array (+ remove useless info like cooldowns).
    // ?sort= elige la categoría (como las vistas de /top del bot); por
    // defecto XP total. Todas las categorías salen del mismo pool de
    // "clasificados" (XP > 0, sin ocultos) para que los rangos cuadren.
    let sortKey = Object.prototype.hasOwnProperty.call(TOP_VIEWS, req.query.sort) ? req.query.sort : "xp"
    let sortView = TOP_VIEWS[sortKey]
    let pkCtx = { ...periodContext(), info: data.info }
    let statOf = user => Number(sortView.get(user, pkCtx)) || 0

    let xpCandidates = []
    let hiddenMembers = []

    Object.entries(data.users || {}).forEach(x => {
        if (!x || !x[0] || !x[1].xp || x[1].xp <= 0) return
        let isHidden = x[1].hidden
        if (!isHidden) xpCandidates.push(x)
        else if (isMod || isDev) hiddenMembers.push({ id: x[0], xp: x[1].xp })
    })

    xpCandidates.sort((a, b) => (statOf(b[1]) - statOf(a[1])) || (b[1].xp - a[1].xp))
    let xpArray = xpCandidates.map((x, y) => ({ id: x[0], xp: x[1].xp, rank: y + 1, statValue: statOf(x[1]) }))

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
        // Misma lógica que effectiveMessages() de las vistas del top.
        userLevel.records = storedUser.records || {}
        userLevel.messages = Number(storedUser.messages) || 0
        userLevel.monthlyMessages = effectiveMessages(storedUser, "monthly", pkCtx)
        userLevel.dailyMessages = effectiveMessages(storedUser, "daily", pkCtx)
        userLevel.reactionsSent = Number(storedUser.reactionsSent) || 0
        userLevel.reactionsReceived = Number(storedUser.reactionsReceived) || 0
        userLevel.countingSent = Number(storedUser.countingSent) || 0
        userLevel.pokemonCaught = Number(storedUser.pokemonCaught) || 0
        userLevel.coinsMax = Number(storedUser.coinsMax) || 0
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
        sort: { key: sortKey, label: sortView.label, unit: sortView.unit || "" },
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
// Destino tras el login (p. ej. el drop que se iba a reclamar). Solo rutas
// relativas internas, para que no sea un open redirect.
function safeNext(value) {
    value = String(value || "")
    if (!/^\/(?!\/)[\w\-\/?=&.%]*$/.test(value) || value.length > 200) return ""
    return value
}

// Dominio padre compartido entre la web y el subdominio de drops, para que
// la cookie de sesión valga en ambos.
function sharedCookieDomain() {
    const dropsHost = Drops.dropsHostname()
    if (!dropsHost) return undefined
    let siteHost
    try { siteHost = new URL(siteURL).hostname } catch { return undefined }
    const a = siteHost.split(".").reverse(), b = dropsHost.split(".").reverse()
    const common = []
    for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) common.push(a[i])
    return common.length >= 2 ? "." + common.reverse().join(".") : undefined
}

app.get("/discord", function(req, res) {
    const next = safeNext(req.query.next)
    if (!next) return res.redirect(discord_auth)
    return res.redirect(discord_auth + "&state=" + Buffer.from(next).toString("base64url"))
})

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
            else return storeAuthToken(res, data, decodeNext(req.query.state)) // if we reach here, it means the code was valid! on to step 3!
        }).catch(e => { console.error(e); sendRedirect(res, "/?authorized") })
    }
    
    // if there's no code, do nothing
    else sendRedirect(res, "/?authorized");
})

/* STEP 3
Discord gave us the codes we need to get their private information, let's goooo!
Now it gets stored in the database for a week, and we give the client our own made up token so we know when it's them */ 
function decodeNext(state) {
    try { return safeNext(Buffer.from(String(state || ""), "base64url").toString()) } catch { return "" }
}

function storeAuthToken(res, tokens, next) {
    let randomNumbers = [tools.rng(1e3, 1e4-1), tools.rng(1e4, 1e5-1), tools.rng(1e5, 1e6-1), tools.rng(1e6, 1e7-1), Number(Date.now().toString().slice(-7))]
    let randomID = randomNumbers.map(x => x.toString(16)).join("-") // just combine a bunch of random numbers!!!! pretty much anything goes here
    let expiration = Date.now() + (1000 * tokens.expires_in) // when the token expires (one week)
    authDB.delete({ expires: { $lt: Date.now() } }).then(() => {}) // clear expired tokens
    authDB.create({ _id: randomID, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires: expiration }).then((data) => {
        res.cookie("polaris", randomID, { "expires": new Date(expiration), domain: sharedCookieDomain() });
        if (next) { // vuelve a donde estaba (p. ej. el drop), en el subdominio de drops si es una ruta de drop
            const dropsHost = Drops.dropsHostname()
            const isDrop = /^\/(drop\/)?\d{10,30}\/[A-Z0-9]{6,10}$/.test(next)
            return sendRedirect(res, isDrop && dropsHost ? `https://${dropsHost}${next}` : next)
        }
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

// Un /CODE suelto (6-10 alfanuméricos): solo es un drop del servidor
// principal. Va al final para pisar ninguna ruta fija (/rank, /logout…).
app.get("/:code([A-Z0-9]{6,10})", function(req, res, next) {
    const dropsHost = Drops.dropsHostname()
    if (dropsHost && req.hostname === dropsHost) {
        req.params.guild = Drops.MAIN_GUILD_ID
        return dropRateLimit(req, res, () => handleDropClaim(req, res))
    }
    return next()
})

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
