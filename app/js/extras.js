// Utilidades compartidas por todas las páginas (home, servers, leaderboard, config).
// Cambios respecto a la versión anterior:
//  - Fetch: ya no da por buena una respuesta de error sin `apiError` (p. ej. un 502 de nginx),
//    siempre rechaza con un objeto que tiene `message`.
//  - timeStr: unidades en español.
//  - addUhOh: añade el #errorhelp que las páginas intentaban mostrar y no existía.
//  - loginButton: conserva también la query (?sort=...) al volver del login.

function Fetch(url, settings = {}) {
    return fetch(url, { credentials: "same-origin" }).then(async r => {
        let body
        try {
            body = (settings.text && r.ok) ? await r.text() : await r.json()
        } catch (e) {
            throw new Error(r.ok ? e.message : `Error del servidor (${r.status})`)
        }
        if (body && body.apiError) throw body
        if (!r.ok) throw new Error(`Error del servidor (${r.status})`)
        return body
    })
}


// commafy() lo define cada página (leaderboard.html y config.html).
function timeStr(ms, decimals = 0, noS, shortTime) {
    if (ms > 3e16) return "Para siempre"

    function timeFormat(amount, long, short) {
        amount = +amount
        const useShort = !!(shortTime && short)
        const plural = !(noS || useShort || amount == 1)
        return `${commafy(amount)} ${useShort ? short : long}${plural ? "s" : ""}`
    }

    ms = Math.abs(ms)
    const seconds = (ms / 1000).toFixed(0)
    const minutes = (ms / (1000 * 60)).toFixed(decimals)
    const hours = (ms / (1000 * 60 * 60)).toFixed(decimals)
    const days = (ms / (1000 * 60 * 60 * 24)).toFixed(decimals)
    const years = (ms / (1000 * 60 * 60 * 24 * 365)).toFixed(decimals)

    if (seconds < 1) return timeFormat((ms / 1000).toFixed(2), "segundo", "s")
    if (seconds < 60) return timeFormat(seconds, "segundo", "s")
    if (minutes < 60) return timeFormat(minutes, "minuto", "min")
    if (hours <= 24) return timeFormat(hours, "hora")
    if (days <= 365) return timeFormat(days, "día")
    return timeFormat(years, "año")
}

function addUhOh() {
    $('body').append(`<div id="uhoh" class="centerflex" role="alert" style="display: none; flex-direction: column;">
    <h2 id="errorheader">Error :(</h2>
    <p id="errorfooter"></p>
    <p id="errorhelp">Si el problema continúa, avisa al staff del servidor.</p>
    <button id="loginbutton" onclick="loginButton()">Iniciar sesión</button>
    </div>`)
}

function loginButton() {
    // Respaldo para home.html (vuelve a la ruta guardada tras /?authorized)
    try { localStorage.polaris_url = window.location.pathname } catch (e) {}
    // Camino principal: el servidor devuelve directamente a esta ruta, con su query
    const next = window.location.pathname + window.location.search
    window.location.href = "/discord?next=" + encodeURIComponent(next)
}

let mobile = ( /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent) )