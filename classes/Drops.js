// Sistema de drops: el staff crea repartos de XP reclamables por web
// (/drop/<guild>/<CODE>). Cada usuario reclama una vez, el drop tiene un
// cupo total de reclamaciones y caduca pasado un tiempo.
//
// Guardado en el doc del servidor: drops { "<CODE>": {
//   name, amount, maxClaims, claims: [userIds], expiresAt, createdBy, createdAt } }

const CODE_LENGTH = 6
// Sin caracteres ambiguos (0/O, 1/I/L) para dictarlos sin errores.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// Niveles cuadrados con equivalencia en mensajes y nivel desde 0 (XP).
const AMOUNT_PRESETS = [
    { xp: 3000, name: "Muy bajo" },
    { xp: 5000, name: "Bajo" },
    { xp: 10000, name: "Medio" },
    { xp: 15000, name: "Alto" },
    { xp: 30000, name: "Muy alto" },
]

// Las monedas llevan otra escala (la pone cada economía): 5 niveles como
// en XP pero empezando en 5.000, que es "muy poco".
const COIN_PRESETS = [
    { coins: 5000, name: "Muy bajo" },
    { coins: 10000, name: "Bajo" },
    { coins: 25000, name: "Medio" },
    { coins: 50000, name: "Alto" },
    { coins: 100000, name: "Muy alto" },
]

// Texto "≈13 min de chat, nivel 3" con los valores por defecto de la
// economía (database_schema.js: ~75 XP por mensaje, curva base). Se usa
// TIEMPO y no mensajes brutos a propósito: con el cooldown (60 s por
// defecto) solo ~1 mensaje por minuto da XP, así que "333 mensajes" suena
// a nada pero son 5 horas y media chateando. Lleva ≈ porque cada servidor
// puede tener otra ganancia u otra curva.
const DEFAULT_MSG_XP = 75
const DEFAULT_CURVE_SETTINGS = { maxLevel: 1000, curve: { 1: 100, 2: 50, 3: 1 }, rounding: 100 }
function presetEquiv(xp) {
    const n = Math.max(0, Math.round(Number(xp) || 0))
    const mins = Math.max(1, Math.round(n / DEFAULT_MSG_XP))
    const time = mins < 60
        ? `≈${mins} min de chat`
        : `≈${String(Math.round((mins / 60) * 10) / 10).replace(".", ",")} h de chat`
    let levelText = ""
    try {
        const Tools = require("./Tools.js")
        const level = Tools.global.getLevel(n, DEFAULT_CURVE_SETTINGS)
        if (Number.isFinite(level)) levelText = `, nivel ${level}`
    } catch {}
    return `${time}${levelText}`
}

// Valor especial de la opción cantidad: usar cantidad_extra.
const CUSTOM_AMOUNT = 0

// Duraciones ofrecidas en el comando (minutos).
const DURATION_PRESETS = [
    { minutes: 15, label: "15 minutos" },
    { minutes: 60, label: "1 hora" },
    { minutes: 360, label: "6 horas" },
    { minutes: 1440, label: "24 horas" },
    { minutes: 4320, label: "3 días" },
    { minutes: 10080, label: "7 días" },
]

const LIMITS = {
    amountMin: 100,
    amountMax: 100000, // por encima de Leyenda (75.000) no tiene sentido
    coinMin: 100,
    coinMax: 100000000, // int32 de la API de Boat: no pasar de ~2.100M
    qtyMin: 1,
    qtyMax: 100, // unidades por reclamo en drops de objetos
    usesMin: 1,
    usesMax: 5000,
    durationMin: 5, // minutos
    durationMax: 30 * 24 * 60, // 30 días
    nameMax: 40,
}

// ¿Puede usar /drop? Gestores siempre; si no, roles de la allowlist
// (settings.dropRoles [{ id }]). memberRoles: colección con .has(id).
function canUseDrops({ isManager, memberRoles, settings }) {
    if (isManager) return true
    const allowed = Array.isArray(settings?.dropRoles)
        ? settings.dropRoles.map(r => String(r?.id || "")).filter(Boolean)
        : []
    if (!allowed.length) return false
    try {
        if (memberRoles && typeof memberRoles.has === "function") {
            return allowed.some(id => memberRoles.has(id))
        }
        if (Array.isArray(memberRoles)) {
            return memberRoles.map(String).some(id => allowed.includes(id))
        }
    } catch {}
    return false
}

const DROP_KINDS = ["xp", "coins", "role", "item", "bundle"]

function kindName(kind) {
    if (kind === "coins") return "monedas"
    if (kind === "role") return "rol"
    if (kind === "item") return "objeto"
    if (kind === "bundle") return "pack"
    return "XP"
}

function kindEmoji(kind) {
    if (kind === "coins") return "🪙"
    if (kind === "role") return "🎭"
    if (kind === "item") return "📦"
    return "🆙"
}

// Permisos que un rol de drop NUNCA puede tener (raid): ni al crear el drop
// ni al reclamarlo (el rol pudo cambiar entre medias y se re-verifica).
// Se comprueba por nombre (PermissionsBitField lo resuelve) para no
// depender de discord.js aquí.
const ROLE_DANGEROUS_PERMS = [
    "Administrator",
    "ManageGuild",
    "ManageRoles",
    "ManageChannels",
    "ManageMessages",
    "ManageWebhooks",
    "ManageThreads",
    "ManageEmojisAndStickers",
    "ManageEvents",
    "BanMembers",
    "KickMembers",
    "ModerateMembers",
]

// true si el rol tiene algún permiso peligroso. Ante la duda (objeto raro
// o error), se considera peligroso: fallar cerrado.
function roleIsDangerous(role) {
    try {
        const has = role?.permissions?.has?.bind(role.permissions)
        if (typeof has !== "function") return true
        return ROLE_DANGEROUS_PERMS.some(p => {
            try {
                return !!has(p)
            } catch {
                return true
            }
        })
    } catch {
        return true
    }
}

// ¿Puede alguien con techo creatorTopPos repartir un rol en rolePos?
// El dueño del servidor sí puede siempre (ya podría darlo a mano).
function creatorCanGiveRole({ isOwner, creatorTopPos, rolePos }) {
    if (isOwner) return true
    if (!Number.isFinite(Number(creatorTopPos))) return false
    return Number(rolePos) < Number(creatorTopPos)
}

// Texto de ayuda según la cantidad: el preset más cercano (en escala
// logarítmica, para que 12.000 sea "alto" y no "medio"). levelFor opcional.
function balanceHint(amount, levelFor) {
    const n = Number(amount) || 0
    let best = AMOUNT_PRESETS[0]
    for (const p of AMOUNT_PRESETS) {
        if (Math.abs(Math.log(n / p.xp)) < Math.abs(Math.log(n / best.xp))) best = p
    }
    const size = best.name.toLowerCase()
    if (typeof levelFor === "function") {
        try {
            const level = levelFor(n)
            if (Number.isFinite(level)) return `${size} (≈ nivel ${level} con tu curva)`
        } catch {}
    }
    return size
}

// Host del subdominio de drops, solo en config.json (dropsHostname) junto
// a siteURL: es fijo por instalación (siempre encendida en el mismo sitio),
// no hay nada por máquina que justifique el .env.
function dropsHostname() {
    try {
        const config = require("../config.json")
        return String(config.dropsHostname || "").trim().toLowerCase()
    } catch {
        return ""
    }
}

// Base pública de los enlaces de drops.
function dropsBaseUrl(fallback = "") {
    const host = dropsHostname()
    if (host) return `https://${host}`
    return fallback
}

// Ruta del enlace según dónde se sirva: en el subdominio de drops es corta
// (/<guild>/<CODE>), en la web principal es completa (/drop/<guild>/<CODE>).
function dropPath(guildId, code) {
    if (dropsHostname()) return `/${guildId}/${code}`
    return `/drop/${guildId}/${code}`
}

function genCode(existing = {}, rand = null) {
    // crypto por defecto (impredecible); rand inyectable para tests.
    const crypto = require("crypto")
    const pick = typeof rand === "function" ? rand : () => crypto.randomInt(0, CODE_ALPHABET.length) / CODE_ALPHABET.length
    for (let attempt = 0; attempt < 50; attempt++) {
        let code = ""
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_ALPHABET[Math.floor(pick() * CODE_ALPHABET.length)]
        }
        if (!existing[code]) return code
    }
    // Colisión persistente (casi imposible): añade tiempo para desempatar.
    return (genCode({}, rand) + Date.now().toString(36)).slice(0, CODE_LENGTH + 4).toUpperCase()
}

function sanitizeName(name) {
    return String(name || "").trim().slice(0, LIMITS.nameMax)
}

function normalizePrizes(p) {
    const roles = (Array.isArray(p?.roles) ? p.roles : [])
        .map(r => ({ id: String(r?.id || ""), name: String(r?.name || "").slice(0, 100) }))
        .filter(r => r.id)
    const items = (Array.isArray(p?.items) ? p.items : [])
        .map(it => ({
            id: String(it?.id || ""),
            name: String(it?.name || "").slice(0, 100),
            qty: Math.min(LIMITS.qtyMax, Math.max(1, Math.round(Number(it?.qty) || 1))),
        }))
        .filter(it => it.id)
    return {
        xp: Math.max(0, Math.round(Number(p?.xp) || 0)),
        coins: Math.max(0, Math.round(Number(p?.coins) || 0)),
        roles: roles.slice(0, 1),
        items: items.slice(0, 3),
    }
}

function prizesCount(prizes) {
    const p = normalizePrizes(prizes)
    return (p.xp > 0 ? 1 : 0) + (p.coins > 0 ? 1 : 0) + p.roles.length + p.items.length
}

function buildDrop({ code, name, amount, maxClaims, claims, expiresAt, createdBy, createdAt, kind, roleId, roleName, itemId, itemName, prizes }) {
    const cleanKind = kind === "coins" ? "coins" : kind === "role" ? "role" : kind === "item" ? "item" : kind === "bundle" ? "bundle" : "xp"
    return {
        name: sanitizeName(name) || "Drop de XP",
        amount: Math.round(Number(amount) || 0),
        maxClaims: Math.round(Number(maxClaims) || 0),
        claims: Array.isArray(claims) ? claims.map(String) : [],
        expiresAt: Number(expiresAt) || 0,
        createdBy: String(createdBy || ""),
        createdAt: Number(createdAt) || Date.now(),
        kind: cleanKind,
        roleId: String(roleId || ""),
        roleName: String(roleName || "").slice(0, 100),
        itemId: String(itemId || ""),
        itemName: String(itemName || "").slice(0, 100),
        prizes: cleanKind === "bundle" ? normalizePrizes(prizes) : null,
    }
}

function validateDropInput({ amount, maxClaims, durationMin, kind = "xp", roleId = "", itemId = "", prizes = null, boatAvailable = boatEnabled() }) {
    const errors = []
    if (!DROP_KINDS.includes(kind)) errors.push("el tipo debe ser XP, monedas, rol, objeto o pack")
    if (kind === "bundle") {
        const p = normalizePrizes(prizes)
        if (prizesCount(p) === 0) {
            errors.push("el drop debe tener al menos un premio: XP, monedas, objeto o rol")
        } else {
            if (p.xp > 0 && (p.xp < LIMITS.amountMin || p.xp > LIMITS.amountMax)) {
                errors.push(`el XP debe estar entre ${LIMITS.amountMin} y ${LIMITS.amountMax}`)
            }
            if (p.coins > 0 && (p.coins < LIMITS.coinMin || p.coins > LIMITS.coinMax)) {
                errors.push(`las monedas deben estar entre ${LIMITS.coinMin} y ${LIMITS.coinMax}`)
            }
            for (const r of p.roles) {
                if (!/^\d{17,20}$/.test(r.id)) errors.push("falta un rol válido")
            }
            for (const it of p.items) {
                if (!it.id.trim()) errors.push("falta el objeto de la tienda")
            }
            if ((p.coins > 0 || p.items.length > 0) && !boatAvailable) {
                errors.push("la economía no está conectada (falta UNBELIEVABOAT_TOKEN en el servidor del bot)")
            }
        }
    } else if (kind === "role") {
        if (!/^\d{17,20}$/.test(String(roleId || ""))) errors.push("falta un rol válido")
    } else if (kind === "item") {
        if (!String(itemId || "").trim()) errors.push("falta el objeto de la tienda")
        if (!Number.isInteger(Number(amount)) || Number(amount) < LIMITS.qtyMin || Number(amount) > LIMITS.qtyMax) {
            errors.push(`las unidades deben estar entre ${LIMITS.qtyMin} y ${LIMITS.qtyMax}`)
        }
    } else if (kind === "coins") {
        if (!Number.isFinite(Number(amount)) || Number(amount) < LIMITS.coinMin || Number(amount) > LIMITS.coinMax) {
            errors.push(`las monedas deben estar entre ${LIMITS.coinMin} y ${LIMITS.coinMax}`)
        }
    } else if (!Number.isFinite(Number(amount)) || Number(amount) < LIMITS.amountMin || Number(amount) > LIMITS.amountMax) {
        errors.push(`la cantidad debe estar entre ${LIMITS.amountMin} y ${LIMITS.amountMax}`)
    }
    if (!Number.isInteger(Number(maxClaims)) || Number(maxClaims) < LIMITS.usesMin || Number(maxClaims) > LIMITS.usesMax) {
        errors.push(`los usos deben estar entre ${LIMITS.usesMin} y ${LIMITS.usesMax}`)
    }
    if (!Number.isFinite(Number(durationMin)) || Number(durationMin) < LIMITS.durationMin || Number(durationMin) > LIMITS.durationMax) {
        errors.push(`la duración debe estar entre ${LIMITS.durationMin} minutos y 30 días`)
    }
    if ((kind === "coins" || kind === "item") && !boatAvailable) {
        errors.push("la economía no está conectada (falta UNBELIEVABOAT_TOKEN en el servidor del bot)")
    }
    return errors
}

// --- Economía externa (UnbelievaBoat) ---
function boatEnabled() {
    return !!String(process.env.UNBELIEVABOAT_TOKEN || "").trim()
}

function boatHeaders() {
    // Ojo: el token va a pelo, SIN "Bearer" (así lo pide su documentación).
    return { Authorization: String(process.env.UNBELIEVABOAT_TOKEN || "").trim(), "Content-Type": "application/json" }
}

// Suma `amount` al cash del usuario. Lanza si la API falla (el reclamo NO
// se registra y se puede reintentar). Sin dependencias: fetch nativo.
async function addBoatCoins(guildId, userId, amount, reason = "Drop", fetchImpl = fetch) {
    if (!boatEnabled()) throw new Error("boat-disabled")
    const res = await fetchImpl(
        `https://unbelievaboat.com/api/v1/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}`,
        {
            method: "PATCH",
            headers: boatHeaders(),
            body: JSON.stringify({ cash: Math.round(Number(amount) || 0), reason: String(reason).slice(0, 64) }),
            signal: AbortSignal.timeout(10000),
        },
    )
    if (!res.ok) throw new Error(`boat-${res.status}`)
    return res.json().catch(() => ({}))
}

// Saldo del usuario en UnbelievaBoat (cash + bank). Lanza si la API falla.
// Sin dependencias: fetch nativo. Se usa para los récords/estadísticas de
// monedas (el saldo actual que la API sí conoce).
async function getBoatBalance(guildId, userId, fetchImpl = fetch) {
    if (!boatEnabled()) throw new Error("boat-disabled")
    const res = await fetchImpl(
        `https://unbelievaboat.com/api/v1/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}`,
        { headers: boatHeaders(), signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) throw new Error(`boat-${res.status}`)
    return res.json().catch(() => ({}))
}

// Total de monedas de una respuesta de UnbelievaBoat: cash + bank. Si el
// objeto no trae esos campos se acepta un `total` ya calculado. Nunca
// negativo.
function boatBalanceTotal(data) {
    if (!data || typeof data !== "object") return 0
    const cash = Number(data.cash) || 0
    const bank = Number(data.bank) || 0
    if (cash || bank) return Math.max(0, Math.round(cash + bank))
    return Math.max(0, Math.round(Number(data.total) || 0))
}

// Tienda del servidor, cacheada 5 minutos por guild (el autocompletado del
// comando la pide a cada tecla). Devuelve [{ id, name, price, emoji }].
const storeCache = new Map()
const STORE_CACHE_MS = 5 * 60 * 1000

async function fetchBoatStore(guildId, fetchImpl = fetch) {
    if (!boatEnabled()) throw new Error("boat-disabled")
    const cached = storeCache.get(String(guildId))
    if (cached && Date.now() - cached.at < STORE_CACHE_MS) return cached.items
    const res = await fetchImpl(
        `https://unbelievaboat.com/api/v1/guilds/${encodeURIComponent(guildId)}/items?limit=100`,
        { headers: boatHeaders(), signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) throw new Error(`boat-${res.status}`)
    const data = await res.json().catch(() => ({}))
    const items = (Array.isArray(data?.items) ? data.items : []).map(it => ({
        id: String(it?.id || ""),
        name: String(it?.name || "Sin nombre"),
        price: it?.price ?? null,
        emoji: String(it?.emoji_unicode || ""),
    })).filter(it => it.id)
    storeCache.set(String(guildId), { at: Date.now(), items })
    return items
}

function clearBoatStoreCache(guildId) {
    if (guildId) storeCache.delete(String(guildId))
    else storeCache.clear()
}

// Para el autocompletado: filtra por nombre (o devuelve todo si no hay texto).
async function suggestBoatItems(guildId, query, fetchImpl = fetch) {
    const items = await fetchBoatStore(guildId, fetchImpl)
    const q = String(query || "").trim().toLowerCase()
    if (!q) return items
    return items.filter(it => it.name.toLowerCase().includes(q))
}

// Resuelve lo escrito en el comando a un item: primero por ID exacto,
// si no por nombre exacto (insensible a mayúsculas). null si no existe.
async function resolveBoatItem(guildId, text, fetchImpl = fetch) {
    const clean = String(text || "").trim()
    if (!clean) return null
    const items = await fetchBoatStore(guildId, fetchImpl)
    return items.find(it => it.id === clean)
        || items.find(it => it.name.toLowerCase() === clean.toLowerCase())
        || null
}

// Da `quantity` unidades del item al inventario del usuario. Lanza si falla.
async function addBoatItem(guildId, userId, itemId, quantity, fetchImpl = fetch) {
    if (!boatEnabled()) throw new Error("boat-disabled")
    const res = await fetchImpl(
        `https://unbelievaboat.com/api/v1/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}/inventory`,
        {
            method: "POST",
            headers: boatHeaders(),
            body: JSON.stringify({ item_id: String(itemId), quantity: Math.max(1, Math.round(Number(quantity) || 1)) }),
            signal: AbortSignal.timeout(10000),
        },
    )
    if (!res.ok) throw new Error(`boat-${res.status}`)
    return res.json().catch(() => ({}))
}

// Quita `quantity` unidades (compensación si el cupo se llenó en una
// carrera). La doc nombra el parámetro "integer"; se mandan los dos nombres
// por si acaso (los query desconocidos se ignoran).
async function removeBoatItem(guildId, userId, itemId, quantity, fetchImpl = fetch) {
    if (!boatEnabled()) throw new Error("boat-disabled")
    const qty = Math.max(1, Math.round(Number(quantity) || 1))
    const res = await fetchImpl(
        `https://unbelievaboat.com/api/v1/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}/inventory/${encodeURIComponent(itemId)}?quantity=${qty}&integer=${qty}`,
        {
            method: "DELETE",
            headers: boatHeaders(),
            signal: AbortSignal.timeout(10000),
        },
    )
    if (!res.ok && res.status !== 204) throw new Error(`boat-${res.status}`)
    return true
}

// --- Roles (el bot los gestiona, como las recompensas de nivel) ---
// Da o quita un rol al usuario en el shard que tenga la guild. Lanza si no
// se puede (sin guild, sin miembro, sin rol o sin permisos): el reclamo NO
// se registra y se puede reintentar. Al DAR (no al quitar) re-verifica la
// seguridad aunque el drop se creara bien: el rol pudo cambiar después
// (permisos nuevos) y el bot o tu posición también.
async function setDropRole(client, guildId, userId, roleId, remove = false) {
    if (!client?.shard?.broadcastEval) throw new Error("role-no-shard")
    const results = await client.shard.broadcastEval(async (cl, ctx) => {
        try {
            const guild = cl.guilds.cache.get(ctx.guildId)
            if (!guild) return null
            const member = await guild.members.fetch(ctx.userId).catch(() => null)
            if (!member) return { ok: false, reason: "no-member" }
            const role = guild.roles.cache.get(ctx.roleId)
            if (!role) return { ok: false, reason: "no-role" }
            if (ctx.remove) {
                await member.roles.remove(ctx.roleId)
                return { ok: true }
            }
            const has = (obj, perm) => {
                try {
                    return !!obj?.permissions?.has?.(perm)
                } catch {
                    return false
                }
            }
            const bot = guild.members.me
            if (!has(bot, "ManageRoles") || role.position >= bot.roles.highest.position) {
                return { ok: false, reason: "no-permission" }
            }
            if ((ctx.dangerous || []).some(p => {
                try {
                    return !!role.permissions?.has?.(p)
                } catch {
                    return true
                }
            })) {
                return { ok: false, reason: "role-unsafe" }
            }
            // Doble verificación: nada por encima de tu propio rol más alto
            // (dueño y gestores del servidor están exentos: ya podrían darlo).
            let exempt = String(guild.ownerId) === String(ctx.userId)
            try {
                exempt = exempt || has(member, "ManageGuild")
            } catch {}
            if (!exempt) {
                let topPos = 0
                try {
                    topPos = member.roles.highest.position
                } catch {
                    return { ok: false, reason: "no-member" }
                }
                if (role.position >= topPos) return { ok: false, reason: "role-hierarchy" }
            }
            await member.roles.add(ctx.roleId)
            return { ok: true }
        } catch (e) {
            return { ok: false, reason: "discord:" + (e?.message || "error") }
        }
    }, { context: { guildId: String(guildId), userId: String(userId), roleId: String(roleId), remove: !!remove, dangerous: ROLE_DANGEROUS_PERMS } })
    const hit = Array.isArray(results) ? results.find(r => r) : results
    if (!hit?.ok) throw new Error(`role-${hit?.reason || "missing"}`)
    return hit
}

async function grantDropRole(client, guildId, userId, roleId) {
    return setDropRole(client, guildId, userId, roleId, false)
}

async function revokeDropRole(client, guildId, userId, roleId) {
    return setDropRole(client, guildId, userId, roleId, true)
}

// Estado de un reclamo sin tocar la DB. now inyectable (tests).
function validateClaim(drop, userId, now = Date.now()) {
    if (!drop) return { ok: false, reason: "missing" }
    if (Number(drop.expiresAt) <= now) return { ok: false, reason: "expired" }
    const claims = Array.isArray(drop.claims) ? drop.claims : []
    if (claims.map(String).includes(String(userId))) return { ok: false, reason: "already" }
    if (claims.length >= Number(drop.maxClaims)) return { ok: false, reason: "soldout" }
    return { ok: true }
}

function claimsLeft(drop) {
    if (!drop) return 0
    return Math.max(0, Number(drop.maxClaims) - (Array.isArray(drop.claims) ? drop.claims.length : 0))
}

// Candado por (servidor, código): los reclamos del mismo drop se procesan
// en serie en este proceso. Además se verifica tras escribir y se compensa
// si hubo carrera entre procesos (ver claimDrop).
const dropLocks = new Map()

async function withDropLock(guildId, code, fn) {
    const key = `${guildId}:${code}`
    const prev = dropLocks.get(key)
    if (prev) { try { await prev } catch {} }
    let release
    const mine = new Promise(resolve => { release = resolve })
    dropLocks.set(key, mine)
    try {
        return await fn()
    } finally {
        if (dropLocks.get(key) === mine) dropLocks.delete(key)
        release()
    }
}

async function fetchDoc(client, guildId, filter) {
    const q = filter ? client.db.fetch(guildId, filter) : client.db.fetch(guildId)
    return q?.exec ? await q.exec().catch(() => null) : await q.catch(() => null)
}

async function createDrop(client, guildId, { amount, maxClaims, durationMin, name, createdBy, kind = "xp", roleId = "", roleName = "", itemId = "", itemName = "", prizes = null, now = Date.now(), boatAvailable = boatEnabled() }) {
    const errors = validateDropInput({ amount, maxClaims, durationMin, kind, roleId, itemId, prizes, boatAvailable })
    if (errors.length) return { ok: false, errors }

    const doc = await fetchDoc(client, guildId, ["drops"])
    if (!doc) return { ok: false, errors: ["servidor sin datos"] }
    const drops = doc.drops || {}

    const code = genCode(drops)
    const drop = buildDrop({
        code,
        name,
        amount,
        maxClaims,
        expiresAt: now + Number(durationMin) * 60 * 1000,
        createdBy,
        createdAt: now,
        kind,
        roleId,
        roleName,
        itemId,
        itemName,
        prizes,
    })
    await client.db.update(guildId, { $set: { [`drops.${code}`]: drop } }).exec()
    return { ok: true, code, drop, url: dropPath(guildId, code) }
}

// Traduce un fallo al dar un rol a reason de reclamo: los de seguridad se
// distinguen (página propia), lo operativo cae en "api-error" (reintentable).
function roleClaimReason(e) {
    const reason = String(e?.message || "")
    if (reason === "role-unsafe" || reason === "role-hierarchy") return reason
    return "api-error"
}

// Concede todos los premios externos de un pack en orden (monedas, rol,
// objetos). Si algo falla, compensa lo ya dado y devuelve el motivo.
async function grantBundlePrizes(client, guildId, userId, code, prizes, deps) {
    const { addCoins, grantRole, addItem } = deps
    const given = { coins: 0, roleId: "", items: [] }
    try {
        if (prizes.coins > 0) {
            await addCoins(guildId, userId, prizes.coins, `Drop ${code}`)
            given.coins = prizes.coins
        }
        if (prizes.roles[0]) {
            await grantRole(client, guildId, userId, prizes.roles[0].id)
            given.roleId = prizes.roles[0].id
        }
        for (const it of prizes.items) {
            await addItem(guildId, userId, it.id, it.qty)
            given.items.push(it)
        }
    } catch (e) {
        await revertBundlePrizes(client, guildId, userId, code, given, deps)
        return { ok: false, reason: roleClaimReason(e) }
    }
    return { ok: true, given }
}

async function revertBundlePrizes(client, guildId, userId, code, given, deps) {
    const { addCoins, revokeRole, removeItem } = deps
    if (given.coins) {
        try { await addCoins(guildId, userId, -given.coins, `Reembolso drop ${code}`) } catch {}
    }
    if (given.roleId) {
        try { await revokeRole(client, guildId, userId, given.roleId) } catch {}
    }
    for (const it of given.items) {
        try { await removeItem(guildId, userId, it.id, it.qty) } catch {}
    }
}

// Reclama un drop. deps inyectables (tests): addCoins, grantRole,
// revokeRole, addItem, removeItem. Si el premio externo (monedas/rol/objeto)
// falla, el reclamo NO se registra y se puede reintentar (reason "api-error").
async function claimDrop(client, guildId, code, userId, now = Date.now(), deps = {}) {
    code = String(code || "").toUpperCase()
    userId = String(userId || "")
    if (!code || !userId) return { ok: false, reason: "missing" }
    const addCoins = deps.addCoins || addBoatCoins
    const grantRole = deps.grantRole || grantDropRole
    const revokeRole = deps.revokeRole || revokeDropRole
    const addItem = deps.addItem || addBoatItem
    const removeItem = deps.removeItem || removeBoatItem

    return withDropLock(guildId, code, async () => {
        const doc = await fetchDoc(client, guildId)
        if (!doc) return { ok: false, reason: "missing" }
        const drop = (doc.drops || {})[code]
        const check = validateClaim(drop, userId, now)
        if (!check.ok) return { ok: false, reason: check.reason, drop: drop || null }

        const amount = Math.round(Number(drop.amount) || 0)
        const isCoins = drop.kind === "coins"
        const isRole = drop.kind === "role"
        const isItem = drop.kind === "item"
        const isBundle = drop.kind === "bundle"
        let bundleGiven = null
        let bundlePrizes = null

        if (isCoins) {
            try {
                await addCoins(guildId, userId, amount, `Drop ${code}`)
            } catch {
                return { ok: false, reason: "api-error", drop }
            }
            await client.db.update(guildId, {
                $addToSet: { [`drops.${code}.claims`]: userId },
            }).exec()
        } else if (isRole) {
            try {
                await grantRole(client, guildId, userId, drop.roleId)
            } catch (e) {
                return { ok: false, reason: roleClaimReason(e), drop }
            }
            await client.db.update(guildId, {
                $addToSet: { [`drops.${code}.claims`]: userId },
            }).exec()
        } else if (isItem) {
            try {
                await addItem(guildId, userId, drop.itemId, amount)
            } catch {
                return { ok: false, reason: "api-error", drop }
            }
            await client.db.update(guildId, {
                $addToSet: { [`drops.${code}.claims`]: userId },
            }).exec()
        } else if (isBundle) {
            const prizes = normalizePrizes(drop.prizes)
            const granted = await grantBundlePrizes(client, guildId, userId, code, prizes, { addCoins, grantRole, revokeRole, addItem, removeItem })
            if (!granted.ok) return { ok: false, reason: granted.reason, drop }
            const inc = prizes.xp > 0 ? { $inc: {
                [`users.${userId}.xp`]: prizes.xp,
                [`users.${userId}.monthlyXP`]: prizes.xp,
                [`users.${userId}.dailyXP`]: prizes.xp,
            } } : {}
            await client.db.update(guildId, {
                $addToSet: { [`drops.${code}.claims`]: userId },
                ...inc,
            }).exec()
            bundleGiven = granted.given
            bundlePrizes = prizes
        } else {
            await client.db.update(guildId, {
                $addToSet: { [`drops.${code}.claims`]: userId },
                $inc: {
                    [`users.${userId}.xp`]: amount,
                    [`users.${userId}.monthlyXP`]: amount,
                    [`users.${userId}.dailyXP`]: amount,
                },
            }).exec()
        }

        // Verificación tras escribir: si una carrera entre procesos llenó el
        // cupo, se compensa en vez de regalar de más (reembolso / quitar rol
        // u objeto).
        const after = await fetchDoc(client, guildId, [`drops.${code}`, `users.${userId}.xp`])
        const fresh = after?.drops?.[code]
        const freshClaims = Array.isArray(fresh?.claims) ? fresh.claims.map(String) : []
        if (!fresh || freshClaims.length > Number(fresh.maxClaims) || !freshClaims.includes(userId)) {
            const xpToRevert = isBundle ? (bundlePrizes?.xp || 0)
                : (!isCoins && !isRole && !isItem) ? amount : 0
            const revert = { $pull: { [`drops.${code}.claims`]: userId } }
            if (xpToRevert > 0) {
                revert.$inc = {
                    [`users.${userId}.xp`]: -xpToRevert,
                    [`users.${userId}.monthlyXP`]: -xpToRevert,
                    [`users.${userId}.dailyXP`]: -xpToRevert,
                }
            }
            await client.db.update(guildId, revert).exec().catch(() => {})
            if (isCoins) {
                try { await addCoins(guildId, userId, -amount, `Reembolso drop ${code}`) } catch {}
            }
            if (isRole && fresh?.roleId) {
                try { await revokeRole(client, guildId, userId, fresh.roleId) } catch {}
            }
            if (isItem && fresh?.itemId) {
                try { await removeItem(guildId, userId, fresh.itemId, amount) } catch {}
            }
            if (isBundle && bundleGiven) {
                await revertBundlePrizes(client, guildId, userId, code, bundleGiven, { addCoins, revokeRole, removeItem })
            }
            return { ok: false, reason: "soldout", drop: fresh || drop }
        }

        return { ok: true, amount, drop: fresh, claimsLeft: claimsLeft(fresh) }
    })
}

async function deleteDrop(client, guildId, code) {
    code = String(code || "").toUpperCase()
    if (!code) return { ok: false }
    const doc = await fetchDoc(client, guildId, [`drops.${code}`])
    if (!doc?.drops?.[code]) return { ok: false }
    await client.db.update(guildId, { $unset: { [`drops.${code}`]: "" } }).exec()
    return { ok: true, drop: doc.drops[code] }
}

function listDrops(doc, now = Date.now()) {
    return Object.entries(doc?.drops || {}).map(([code, drop]) => ({
        code,
        drop,
        left: claimsLeft(drop),
        expired: Number(drop?.expiresAt) <= now,
        claimed: Array.isArray(drop?.claims) ? drop.claims.length : 0,
    })).sort((a, b) => (a.drop.expiresAt || 0) - (b.drop.expiresAt || 0))
}

module.exports = {
    CODE_LENGTH,
    CODE_ALPHABET,
    AMOUNT_PRESETS,
    CUSTOM_AMOUNT,
    DURATION_PRESETS,
    LIMITS,
    DROP_KINDS,
    kindName,
    kindEmoji,
    balanceHint,
    presetEquiv,
    dropsHostname,
    dropsBaseUrl,
    dropPath,
    boatEnabled,
    addBoatCoins,
    getBoatBalance,
    boatBalanceTotal,
    grantDropRole,
    revokeDropRole,
    COIN_PRESETS,
    canUseDrops,
    fetchBoatStore,
    clearBoatStoreCache,
    suggestBoatItems,
    resolveBoatItem,
    addBoatItem,
    removeBoatItem,
    genCode,
    sanitizeName,
    normalizePrizes,
    prizesCount,
    ROLE_DANGEROUS_PERMS,
    roleIsDangerous,
    creatorCanGiveRole,
    roleClaimReason,
    grantBundlePrizes,
    revertBundlePrizes,
    buildDrop,
    validateDropInput,
    validateClaim,
    claimsLeft,
    withDropLock,
    createDrop,
    claimDrop,
    deleteDrop,
    listDrops,
}
