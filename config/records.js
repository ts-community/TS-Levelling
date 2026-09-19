// Definición de récords (logros) del servidor.
//
// Cómo leer este archivo:
// - categories: una página por categoría en /records. Los récords van
//   ordenados de más fácil a más difícil (los de mensajes, juntos).
// - Cada récord tiene: emoji (cabecera de su bloque), UN mechanic.type (los
//   que funcionan parecido comparten tipo para no repetir lógica) y tiers.
// - Cada nivel tiene threshold (lógica), xp + roleId opcional (recompensa),
//   name (título) y desc (frase clara de lo que hay que hacer).
// - La recompensa es xp, rol o ambas: se entrega lo definido. Si un nivel
//   solo da rol, pon xp: 0.
// - La categoría hidden no se muestra hasta desbloquear (solo cuántos hay).
//
// Balance de XP (ganancia media del bot: ~75 XP por mensaje):
// - Recompensas redondas e igualadas entre récords de esfuerzo parecido.
// - El total de TODO son ~266.500 XP (≈ nivel 51; para un top de 20M es ~1,3%).
//   Se nota al conseguirlos, no desbalancea.

const RECORDS_EMOJI = "<:records:1549908515399929959>"
const MESSAGES_EMOJI = "<:messages:1467163578699354235>"

// Catálogo de mecánicas (para la futura lógica de completado):
// messages_total, messages_monthly, streak_days, reactions_sent,
// member_tenure, talk_to_user, distinct_channels, counting_numbers,
// voice_minutes, voice_join_channel, voice_join_all_fixed,
// starboard_featured, message_reactions, night_message, hidden_command,
// web_easter_egg, secret_phrase

const categories = [
    {
        id: "mensajes",
        name: "Mensajes",
        emoji: "💬",
        records: [
            {
                id: "messages",
                label: "Mensajes",
                emoji: MESSAGES_EMOJI,
                mechanic: { type: "messages_total" },
                unit: "mensajes", unitOne: "mensaje", suffix: "",
                tiers: [
                    { threshold: 10, xp: 250, name: "Primeros pasos", desc: "Envía 10 mensajes" },
                    { threshold: 100, xp: 1250, name: "Calentando motores", desc: "Envía 100 mensajes" },
                    { threshold: 1000, xp: 6000, name: "Charlatán", desc: "Envía 1.000 mensajes" },
                    { threshold: 10000, xp: 25000, name: "Tertuliano", desc: "Envía 10.000 mensajes" },
                    { threshold: 50000, xp: 60000, name: "Leyenda del chat", desc: "Envía 50.000 mensajes" },
                ]
            },
            {
                id: "monthly_messages",
                label: "Mensajes en un mes",
                emoji: MESSAGES_EMOJI,
                mechanic: { type: "messages_monthly" },
                unit: "mensajes", unitOne: "mensaje", suffix: "en un mes",
                tiers: [
                    { threshold: 500, xp: 2500, name: "Mes movidito", desc: "Envía 500 mensajes en un mes" },
                    { threshold: 2000, xp: 10000, name: "Sin freno", desc: "Envía 2.000 mensajes en un mes" },
                    { threshold: 5000, xp: 25000, name: "Modo turbo", desc: "Envía 5.000 mensajes en un mes" },
                ]
            },
        ]
    },
    {
        id: "constancia",
        name: "Constancia",
        emoji: "🔥",
        records: [
            {
                id: "streak",
                label: "Racha de actividad",
                emoji: "🔥",
                mechanic: { type: "streak_days" },
                unit: "días", unitOne: "día", suffix: "seguidos",
                tiers: [
                    { threshold: 3, xp: 1250, name: "Constancia", desc: "Actívate 3 días seguidos" },
                    { threshold: 7, xp: 4000, name: "Semana perfecta", desc: "Actívate 7 días seguidos" },
                    { threshold: 14, xp: 10000, name: "Imparable", desc: "Actívate 14 días seguidos" },
                ]
            },
            {
                id: "reactions_sent",
                label: "Reacciones enviadas",
                emoji: "❤️",
                mechanic: { type: "reactions_sent" },
                unit: "reacciones", unitOne: "reacción", suffix: "enviadas",
                tiers: [
                    { threshold: 10, xp: 250, name: "Me gusta esto", desc: "Envía 10 reacciones" },
                    { threshold: 50, xp: 750, name: "Aplausos", desc: "Envía 50 reacciones" },
                    { threshold: 100, xp: 2000, name: "Fan destacado", desc: "Envía 100 reacciones" },
                ]
            },
        ]
    },
    {
        id: "comunidad",
        name: "Comunidad",
        emoji: "🤝",
        records: [
            {
                id: "talk_to",
                label: "Habla con la IA",
                emoji: "🤖",
                mechanic: { type: "talk_to_user", userId: "1250114494081007697" },
                tiers: [
                    { threshold: 1, xp: 1250, name: "Test de Turing", desc: "Habla con <@1250114494081007697>" },
                ]
            },
            {
                id: "tenure",
                label: "Tiempo en el servidor",
                emoji: "🏅",
                mechanic: { type: "member_tenure", unit: "years" },
                unit: "años", unitOne: "año", suffix: "en el servidor",
                tiers: [
                    { threshold: 1, xp: 6000, name: "Veterano", desc: "Lleva 1 año en el servidor" },
                    { threshold: 2, xp: 10000, name: "Histórico", desc: "Lleva 2 años en el servidor" },
                    { threshold: 3, xp: 25000, name: "Institución", desc: "Lleva 3 años en el servidor" },
                ]
            },
        ]
    },
    {
        id: "channels",
        name: "Canales",
        emoji: "📺",
        records: [
            {
                id: "distinct_channels",
                label: "Canales distintos",
                emoji: "🧭",
                mechanic: { type: "distinct_channels" },
                unit: "canales", unitOne: "canal", suffix: "distintos",
                tiers: [
                    { threshold: 5, xp: 1250, name: "Explorador", desc: "Habla en 5 canales distintos" },
                ]
            },
            {
                id: "counting",
                label: "Counting",
                emoji: "🔢",
                mechanic: { type: "counting_numbers", channelId: "1113502565599019108" },
                unit: "números", unitOne: "número", suffix: "en counting",
                tiers: [
                    { threshold: 10, xp: 250, name: "Contable aprendiz", desc: "Envía 10 números en counting" },
                    { threshold: 100, xp: 1250, name: "Contable experto", desc: "Envía 100 números en counting" },
                    { threshold: 500, xp: 5000, name: "Máquina de contar", desc: "Envía 500 números en counting" },
                ]
            },
        ]
    },
    {
        id: "voice",
        name: "Voz",
        emoji: "🎙️",
        records: [
            {
                id: "voice_general",
                label: "General de voz",
                emoji: "🔊",
                mechanic: { type: "voice_join_channel", channelId: "1466156901615272098" },
                tiers: [
                    { threshold: 1, xp: 750, name: "Debut en General", desc: "Entra al canal General de voz" },
                ]
            },
            {
                id: "voice_all_fixed",
                label: "Todos los fijos",
                emoji: "🎧",
                mechanic: {
                    type: "voice_join_all_fixed",
                    fixedChannelIds: [
                        "1466156901615272098", // general
                        "1466156978895323220", // música
                        "1163774017975631892", // crear dúo
                        "1163777101426597948", // crear trío
                        "1163778987122761728", // crear amistoso
                    ],
                    afkChannelId: "1466153711259619596",
                    excludedChannelIds: ["1466156595208650967"], // eventos
                },
                tiers: [
                    { threshold: 1, xp: 4000, name: "Tour completo", desc: "Entra a todos los fijos" },
                ]
            },
            {
                id: "voice_time",
                label: "Tiempo en voz",
                emoji: "🎙️",
                // Sin contar AFK, eventos ni estar solo en el canal.
                mechanic: {
                    type: "voice_minutes",
                    excludeAfk: true,
                    excludeAlone: true,
                    excludedChannelIds: ["1466153711259619596", "1466156595208650967"],
                },
                divisor: 60, unit: "horas", unitOne: "hora", suffix: "en voz",
                tiers: [
                    { threshold: 300, xp: 2500, name: "Calentando la voz", desc: "Pasa 5 horas en un canal de voz" },
                    { threshold: 1800, xp: 10000, name: "Voz habitual", desc: "Pasa 30 horas en un canal de voz" },
                    { threshold: 6000, xp: 30000, name: "Residente de voz", desc: "Pasa 100 horas en un canal de voz" },
                ]
            },
        ]
    },
    {
        id: "hidden",
        name: "Ocultos",
        emoji: "🕵️",
        hidden: true,
        records: [
            {
                id: "starboard",
                label: "Starboard",
                emoji: "⭐",
                mechanic: { type: "starboard_featured" },
                tiers: [
                    { threshold: 1, xp: 5000, name: "Estrella del servidor", desc: "Aparece en el Starboard" },
                ]
            },
            {
                id: "loved_message",
                label: "Mensaje querido",
                emoji: "💘",
                mechanic: { type: "message_reactions", count: 10 },
                unit: "reacciones", unitOne: "reacción", suffix: "en un mensaje",
                tiers: [
                    { threshold: 10, xp: 4000, name: "Aclamado", desc: "Recibe 10 reacciones en un mensaje" },
                ]
            },
            {
                id: "night_owl",
                label: "Nocturnidad",
                emoji: "🦉",
                mechanic: { type: "night_message", startHour: 4, endHour: 5, timezone: "Europe/Madrid" },
                tiers: [
                    { threshold: 1, xp: 2500, name: "Búho nocturno", desc: "Escribe de 4:00 a 5:00" },
                ]
            },
            {
                id: "hidden_command",
                label: "Comando escondido",
                emoji: "⌨️",
                // TODO: picks el nombre del comando escondido cuando exista
                mechanic: { type: "hidden_command", commandName: null },
                tiers: [
                    { threshold: 1, xp: 2500, name: "Curioso", desc: "Usa un comando escondido" },
                ]
            },
            {
                id: "web_easter",
                label: "Easter egg",
                emoji: "🌐",
                mechanic: { type: "web_easter_egg" },
                tiers: [
                    { threshold: 1, xp: 4000, name: "Detective digital", desc: "Encuentra un easter egg" },
                ]
            },
            {
                id: "secret_word",
                label: "Palabra secreta",
                emoji: "🔮",
                // TODO: picks la frase secreta (no picks pistas en el nombre)
                mechanic: { type: "secret_phrase", phrase: null },
                tiers: [
                    { threshold: 1, xp: 2500, name: "Palabra mágica", desc: "Escribe la palabra secreta" },
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
    categories,
    allRecords,
    visibleRecords,
    hiddenRecords,
    countTiers,
    totalXp,
}
