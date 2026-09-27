// Definición de récords (logros) del servidor.
//
// Cómo leer este archivo:
// - categories: una página por categoría en /records. Los récords van
//   ordenados de más fácil a más difícil dentro de cada categoría.
// - Cada categoría tiene: emoji (cabecera y desplegable) y desc (texto del desplegable).
// - Cada récord tiene: emoji (cabecera de su bloque), UN mechanic.type (los
//   que funcionan parecido comparten tipo para no repetir lógica) y tiers.
// - Cada nivel tiene threshold (lógica), xp + roleId opcional (recompensa),
//   name (título) y desc (frase clara de lo que hay que hacer, con punto).
// - La recompensa es xp, rol o ambas: se entrega lo definido. Si un nivel
//   solo da rol, pon xp: 0.
// - Los ocultos añaden mystery (pista en /records y en el mensaje público,
//   siempre). La condición real solo la ve el autor: por DM al desbloquear
//   y en la web cuando ya lo tiene.
//
// Balance de XP (ganancia media del bot: ~75 XP por mensaje):
// - Recompensas redondas y visibles: 1.000, 3.000, 5.000, 10.000, 15.000,
//   30.000, 50.000, 75.000 y 100.000 XP. La dificultad equivalente conserva
//   una recompensa parecida.
// - Los ocultos pagan mejor porque requieren descubrir una condición que no
//   se puede seguir desde la interfaz.
// - Con la curva por defecto, todo el catálogo ronda la experiencia de los
//   niveles 60-70: es un bonus importante, no una segunda progresión.

const RECORDS_EMOJI = "<:records:1549908515399929959>"
const MESSAGES_EMOJI = "<:messages:1467163578699354235>"
const MENU_HYPER = "<:hypercharge_drop:1467236546317914349>"

// IDs del servidor para los récords (única fuente de verdad: las
// descripciones de abajo los usan con <#id> / <@id>, sin duplicar).
const CHANNELS = {
    channelId: "1551570600135229440", // anuncio de récords
    countingChannelId: "1113502565599019108",
    economyChannelId: "1553080048855289858",
    iaChannelId: "1544029379284443146",
    iaBotId: "1250114494081007697", // Nova
    starboardChannelId: "1317531432909930639",
    starboardBotId: "1292238307656470621", // también counting
    
    // Canales de voz fijos
    voiceGeneralId: "1466156901615272098",
    voiceMusicaId: "1466156978895323220",
    voiceDuoId: "1163774017975631892",
    voiceTrioId: "1163777101426597948",
    voiceAmistosoId: "1163778987122761728",
    voiceAfkId: "1466153711259619596",
    voiceEventosId: "1466156595208650967",
}

// Catálogo de mecánicas (para la futura lógica de completado) y QUÉ estadística
// de DB necesita cada una para saber si se alcanza. La clave <recordId>:<threshold>
// en userData.records solo es el flag "completado"; el progreso vive en users.<id>:
//
//   messages_total        -> messages            (ya se guarda en message.js)
//   messages_monthly      -> monthlyMessages     (ya se guarda)
//   member_tenure         -> member.joinedAt     (sin DB)
//   streak_days           -> streak = { current, lastDay }  (día en TZ del servidor)
//   reactions_sent        -> reactionsSent       (contador total de reacciones enviadas)
//   reactions_received    -> reactionsReceived   (contador total recibido en mensajes propios)
//   talk_to_user          -> flag en records     (evento: la IA responde)
//   distinct_channels     -> channels            (set de channelIds donde ha escrito)
//   counting_numbers      -> countingSent        (o contador por canal en channels)
//   voice_minutes         -> voiceMinutes        (minutos acumulados, sin AFK; solo también cuenta)
//   voice_join_channel    -> voiceJoined         (set de fijos a los que ha entrado)
//   voice_join_all_fixed  -> voiceJoined         (mismo set: al completar los 5)
//   starboard_featured    -> flag en records     (evento: entra al starboard)
//   reactions_received    -> reactionsReceived   (contador total en mensajes propios)
//   night_message         -> flag en records     (evento: mensaje en franja)
//   hidden_command        -> flag en records     (evento: usa el comando)
//   web_easter_egg        -> flag en records     (evento: encuentra el easter egg)
//   secret_phrase         -> flag en records     (evento: escribe la frase)
//   economy_participation -> flag en records     (evento: participa en economía)

const categories = [
    {
        id: "actividad",
        name: "Actividad",
        emoji: "💬",
        desc: "Mensajes, ritmo y presencia en el chat.",
        records: [
            {
                id: "messages",
                label: "Mensajes",
                emoji: MESSAGES_EMOJI,
                mechanic: { type: "messages_total" },
                unit: "mensajes", unitOne: "mensaje", suffix: "",
                tiers: [
                    { threshold: 10, xp: 1000, name: "Primeros pasos", desc: "Envía 10 mensajes en el servidor." },
                    { threshold: 100, xp: 3000, name: "Habitual", desc: "Envía 100 mensajes en el servidor." },
                    { threshold: 1000, xp: 10000, name: "Conversador", desc: "Envía 1.000 mensajes en el servidor." },
                    { threshold: 10000, xp: 30000, name: "Pilar", desc: "Envía 10.000 mensajes en el servidor." },
                    { threshold: 50000, xp: 100000, name: "Leyenda", desc: "Envía 50.000 mensajes en el servidor." },
                ]
            },
            {
                id: "monthly_messages",
                label: "Mensual",
                emoji: "📅",
                mechanic: { type: "messages_monthly" },
                unit: "mensajes", unitOne: "mensaje", suffix: "en un mes",
                tiers: [
                    { threshold: 1000, xp: 3000, name: "Mes activo", desc: "Envía 1.000 mensajes en un mismo mes." },
                    { threshold: 2000, xp: 10000, name: "Imparable", desc: "Envía 2.000 mensajes en un mismo mes." },
                    { threshold: 5000, xp: 30000, name: "Legendario", desc: "Envía 5.000 mensajes en un mismo mes." },
                ]
            },
            {
                id: "daily_messages",
                label: "Diario",
                emoji: "☀️",
                mechanic: { type: "messages_daily" },
                unit: "mensajes", unitOne: "mensaje", suffix: "en un día",
                tiers: [
                    { threshold: 500, xp: 1000, name: "Día activo", desc: "Envía 500 mensajes en un mismo día." },
                    { threshold: 1000, xp: 3000, name: "Constante", desc: "Envía 1.000 mensajes en un mismo día." },
                    { threshold: 2000, xp: 5000, name: "Jornada", desc: "Envía 2.000 mensajes en un mismo día." },
                ]
            },
            {
                id: "talk_to",
                label: "Habla con Nova",
                emoji: "🤖",
                mechanic: { type: "talk_to_user", userId: CHANNELS.iaBotId, channelId: CHANNELS.iaChannelId },
                tiers: [
                    { threshold: 1, xp: 3000, name: "Primer contacto", desc: `Menciona o responde a un mensaje de <@${CHANNELS.iaBotId}>.` },
                ]
            },
        ]
    },
    {
        id: "comunidad",
        name: "Comunidad",
        emoji: "🤝",
        desc: "Reacciones, rachas y antigüedad.",
        records: [
            {
                id: "reactions_sent",
                label: "Reacciones",
                emoji: "❤️",
                mechanic: { type: "reactions_sent" },
                unit: "reacciones", unitOne: "reacción", suffix: "",
                tiers: [
                    { threshold: 10, xp: 1000, name: "Primer gesto", desc: "Envía 10 reacciones a mensajes." },
                    { threshold: 50, xp: 3000, name: "Fiel apoyo", desc: "Envía 50 reacciones a mensajes." },
                    { threshold: 100, xp: 10000, name: "Oleada de apoyo", desc: "Envía 100 reacciones a mensajes." },
                ]
            },
            {
                id: "reactions_received",
                label: "Reacciones recibidas",
                emoji: "💘",
                mechanic: { type: "reactions_received" },
                unit: "reacciones", unitOne: "reacción", suffix: "recibidas",
                tiers: [
                    { threshold: 10, xp: 3000, name: "Apreciado", desc: "Recibe 10 reacciones en tus mensajes." },
                    { threshold: 50, xp: 10000, name: "Muy valorado", desc: "Recibe 50 reacciones en tus mensajes." },
                    { threshold: 100, xp: 30000, name: "Favorito", desc: "Recibe 100 reacciones en tus mensajes." },
                ]
            },
            {
                id: "streak",
                label: "Racha",
                emoji: "🔥",
                mechanic: { type: "streak_days" },
                unit: "días", unitOne: "día", suffix: "seguidos",
                tiers: [
                    { threshold: 3, xp: 3000, name: "Racha iniciada", desc: "Envía mensajes durante 3 días seguidos." },
                    { threshold: 7, xp: 10000, name: "Una semana", desc: "Envía mensajes durante 7 días seguidos." },
                    { threshold: 14, xp: 30000, name: "Dos semanas", desc: "Envía mensajes durante 14 días seguidos." },
                ]
            },
            {
                id: "tenure",
                label: "Antigüedad",
                emoji: "🏅",
                mechanic: { type: "member_tenure", unit: "years" },
                unit: "años", unitOne: "año", suffix: "en el servidor",
                tiers: [
                    { threshold: 1, xp: 10000, name: "Veterano", desc: "Lleva 1 año en la comunidad." },
                    { threshold: 2, xp: 30000, name: "Histórico", desc: "Lleva 2 años en la comunidad." },
                    { threshold: 3, xp: 75000, name: "Institución", desc: "Lleva 3 años en la comunidad." },
                ]
            },
        ]
    },
    {
        id: "canales",
        name: "Canales",
        emoji: "🧭",
        desc: "Explora el servidor y participa en sus sistemas.",
        records: [
            {
                id: "distinct_channels",
                label: "Canales distintos",
                emoji: "🧭",
                mechanic: { type: "distinct_channels" },
                unit: "canales", unitOne: "canal", suffix: "distintos",
                tiers: [
                    { threshold: 5, xp: 3000, name: "Explorador", desc: "Envía mensajes en 5 canales distintos." },
                ]
            },
            {
                id: "economy_participation",
                label: "Economía",
                emoji: "💰",
                mechanic: { type: "economy_participation", channelId: CHANNELS.economyChannelId },
                tiers: [
                    { threshold: 1, xp: 3000, name: "Primer movimiento", desc: `Envía un mensaje en <#${CHANNELS.economyChannelId}>.` },
                ]
            },
            {
                id: "counting",
                label: "Counting",
                emoji: "🔢",
                mechanic: { type: "counting_numbers", channelId: CHANNELS.countingChannelId },
                unit: "números", unitOne: "número", suffix: "en counting",
                tiers: [
                    { threshold: 10, xp: 1000, name: "El 10", desc: `Completa el 10 en <#${CHANNELS.countingChannelId}>.` },
                    { threshold: 100, xp: 5000, name: "El 100", desc: `Completa el 100 en <#${CHANNELS.countingChannelId}>.` },
                    { threshold: 500, xp: 15000, name: "El 500", desc: `Completa el 500 en <#${CHANNELS.countingChannelId}>.` },
                ]
            },
        ]
    },
    {
        id: "voz",
        name: "Voz",
        emoji: "🎙️",
        desc: "Tiempo en voz y presencia en los canales de audio.",
        records: [
            {
                id: "voice_general",
                label: "General de voz",
                emoji: "🔊",
                mechanic: { type: "voice_join_channel", channelId: CHANNELS.voiceGeneralId },
                tiers: [
                    { threshold: 1, xp: 1000, name: "Primera llamada", desc: `Entra al <#${CHANNELS.voiceGeneralId}>.` },
                ]
            },
            {
                id: "voice_all_fixed",
                label: "Tour de voz",
                emoji: "🎧",
                mechanic: {
                    type: "voice_join_all_fixed",
                    fixedChannelIds: [
                        CHANNELS.voiceGeneralId,
                        CHANNELS.voiceMusicaId,
                        CHANNELS.voiceDuoId,
                        CHANNELS.voiceTrioId,
                        CHANNELS.voiceAmistosoId,
                    ],
                    afkChannelId: CHANNELS.voiceAfkId,
                    excludedChannelIds: [CHANNELS.voiceEventosId],
                },
                unit: "canales", unitOne: "canal", suffix: "distintos",
                tiers: [
                    { threshold: 1, xp: 5000, name: "Ruta completa", desc: "Entra en los 5 canales fijos de voz." },
                ]
            },
            {
                id: "voice_time",
                label: "Tiempo en voz",
                emoji: "🎙️",
                mechanic: {
                    type: "voice_minutes",
                    excludeAfk: true,
                    excludeAlone: false,
                    excludedChannelIds: [CHANNELS.voiceAfkId],
                },
                divisor: 60, unit: "horas", unitOne: "hora", suffix: "en voz",
                tiers: [
                    { threshold: 300, xp: 5000, name: "5 horas", desc: "Pasa 5 horas en voz válida." },
                    { threshold: 1800, xp: 15000, name: "30 horas", desc: "Pasa 30 horas en voz válida." },
                    { threshold: 6000, xp: 50000, name: "100 horas", desc: "Pasa 100 horas en voz válida." },
                ]
            },
        ]
    },
    {
        id: "hidden",
        name: "Ocultos",
        emoji: "🕵️",
        desc: "Logros secretos que se revelan al descubrirlos.",
        hidden: true,
        records: [
            {
                id: "starboard",
                label: "Estrella",
                emoji: "⭐",
                mechanic: { type: "starboard_featured", channelId: CHANNELS.starboardChannelId, botId: CHANNELS.starboardBotId },
                mystery: "Lo mejor acaba a la vista…",
                tiers: [
                    { threshold: 1, xp: 30000, name: "Bajo los focos", desc: `Consigue que uno de tus mensajes aparezca en <#${CHANNELS.starboardChannelId}>.` },
                ]
            },
            {
                id: "night_owl",
                label: "Ritmo nocturno",
                emoji: "🦉",
                mechanic: { type: "night_message", startHour: 4, endHour: 5, timezone: "Europe/Madrid" },
                mystery: "Hay horas que casi nadie ve…",
                tiers: [
                    { threshold: 1, xp: 5000, name: "Insomnio", desc: "Envía un mensaje entre las 04:00 y las 05:00, hora española." },
                ]
            },
            {
                id: "hidden_command",
                label: "Comando oculto",
                emoji: "⌨️",
                mechanic: { type: "hidden_command", commandName: "roger" },
                mystery: "Hay gestos que el bot entiende…",
                tiers: [
                    { threshold: 1, xp: 15000, name: "Señas", desc: "Descubre y utiliza el comando oculto /roger." },
                ]
            },
            {
                id: "web_easter",
                label: "Easter egg",
                emoji: "🌐",
                mechanic: { type: "web_easter_egg" },
                mystery: "Hay más mundo fuera de aquí…",
                tiers: [
                    { threshold: 1, xp: 20000, name: "Al otro lado", desc: "Encuentra el secreto escondido en la web." },
                ]
            },
            {
                id: "secret_word",
                label: "Palabra secreta",
                emoji: "🔮",
                mechanic: { type: "secret_phrase", phrase: "lentejas" },
                mystery: "Dicen que una palabra basta…",
                tiers: [
                    { threshold: 1, xp: 5000, name: "De pasada", desc: "Escribe la palabra secreta, \"lentejas\",  en un mensaje." },
                ]
            },
        ]
    },
]

function allRecords() {
    return categories.flatMap(category => category.records.map(record => ({ category, record })))
}

function visibleRecords() {
    return allRecords().filter(({ category }) => !category.hidden)
}

function hiddenRecords() {
    return allRecords().filter(({ category }) => category.hidden)
}

function countTiers(entries) {
    return entries.reduce((sum, { record }) => sum + record.tiers.length, 0)
}

function totalXp(entries) {
    return entries.reduce((sum, { record }) => sum + record.tiers.reduce((s, tier) => s + tier.xp, 0), 0)
}

module.exports = {
    RECORDS_EMOJI,
    CHANNELS,
    categories,
    allRecords,
    visibleRecords,
    hiddenRecords,
    countTiers,
    totalXp,
}