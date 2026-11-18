// Shared secret: first touch reveals it; a second touch follows the link.
function mountSecretEgg() {
 if (location.pathname === '/' || /^\/(?:drops?|easteregg)(?:\/|$)/i.test(location.pathname) || document.querySelector('.badgeWrap') || document.getElementById('siteSecretEgg')) return
 const stylesheet = document.createElement('link')
 stylesheet.rel = 'stylesheet'; stylesheet.href = '/css/secret-egg.css?v=4'
 document.head.append(stylesheet)
 const link = document.createElement('a')
 link.id = 'siteSecretEgg'
 link.style.cssText = 'display:none;position:fixed;width:48px;height:56px;right:18px;bottom:18px'
 stylesheet.addEventListener('load', () => { link.style.display = '' })
 link.href = '/easteregg'
 link.setAttribute('aria-label', 'Descubrir el huevo de pascua')
 link.innerHTML = "<svg viewBox=\"0 0 60 80\" aria-hidden=\"true\">\r\n            <defs>\r\n                <linearGradient id=\"eggShell\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\r\n                    <stop offset=\"0\" stop-color=\"#87f3ff\"/>\r\n                    <stop offset=\".5\" stop-color=\"#a78bfa\"/>\r\n                    <stop offset=\"1\" stop-color=\"#f5d76e\"/>\r\n                </linearGradient>\r\n                <radialGradient id=\"eggShine\" cx=\".35\" cy=\".28\" r=\".55\">\r\n                    <stop offset=\"0\" stop-color=\"#fff\" stop-opacity=\".7\"/>\r\n                    <stop offset=\"1\" stop-color=\"#fff\" stop-opacity=\"0\"/>\r\n                </radialGradient>\r\n                <clipPath id=\"eggClip\"><path d=\"M30 2C15 2 3 26 3 47c0 18 12 31 27 31s27-13 27-31C57 26 45 2 30 2z\"/></clipPath>\r\n            </defs>\r\n            <path d=\"M30 2C15 2 3 26 3 47c0 18 12 31 27 31s27-13 27-31C57 26 45 2 30 2z\" fill=\"url(#eggShell)\"/>\r\n            <g clip-path=\"url(#eggClip)\">\r\n                <rect x=\"0\" y=\"34\" width=\"60\" height=\"9\" fill=\"#00e6a0\" opacity=\".85\"/>\r\n                <path d=\"M0 52l6-6 6 6 6-6 6 6 6-6 6 6 6-6 6 6 6-6 6 6\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3\" stroke-linejoin=\"round\" opacity=\".9\"/>\r\n                <g fill=\"#fff\" opacity=\".85\"><circle cx=\"15\" cy=\"22\" r=\"2.5\"/><circle cx=\"30\" cy=\"17\" r=\"2.5\"/><circle cx=\"45\" cy=\"22\" r=\"2.5\"/><circle cx=\"18\" cy=\"64\" r=\"2.5\"/><circle cx=\"30\" cy=\"68\" r=\"2.5\"/><circle cx=\"42\" cy=\"64\" r=\"2.5\"/></g>\r\n                <ellipse cx=\"30\" cy=\"40\" rx=\"30\" ry=\"40\" fill=\"url(#eggShine)\"/>\r\n            </g>\r\n            <path d=\"M30 2C15 2 3 26 3 47c0 18 12 31 27 31s27-13 27-31C57 26 45 2 30 2z\" fill=\"none\" stroke=\"rgba(255,255,255,.5)\" stroke-width=\"1.5\"/>\r\n        </svg>"
 let opening = false
 link.addEventListener('click', event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  if (opening) return
  opening = true
  link.classList.add('revealed', 'opening')
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  setTimeout(() => location.assign(link.href), reduce ? 0 : 850)
 })
 document.body.append(link)
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountSecretEgg)
else mountSecretEgg()
