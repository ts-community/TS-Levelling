// Resetea TODO lo de récords para empezar de 0: nadie conserva ningún logro
// y se revierte el XP que dieron esos logros. También borra los mensajes
// que el bot haya enviado en el canal de récords.
//
// Uso:
//   node reset-records.js                  -> vista previa (dry-run, no toca nada)
//   node reset-records.js --apply          -> ejecuta (pide confirmación)
//   node reset-records.js --apply --yes    -> ejecuta sin preguntar
//   node reset-records.js --guild <id>     -> solo ese servidor
//   node reset-records.js --user <id>      -> solo ese usuario (requiere --guild)
//   node reset-records.js --keep-progress  -> conserva el progreso (racha,
//      reacciones, canales, counting, voz) y solo quita flags + XP de récords
//   node reset-records.js --no-delete-msgs -> no borra mensajes del canal
//   npm run reset-records -- <opciones>    -> atajo (pasa las opciones)
//
// Lo que QUITA por usuario (solo existe por los récords):
//   records, streak, reactionsSent, channels, countingSent,
//   voiceMinutes, voiceJoined
// Lo que AJUSTA (resta el XP dado por los logros, con mínimo 0):
//   xp, monthlyXP
// Lo que NO toca nunca:
//   messages, monthlyMessages, cooldown, hidden, settings, info
//   (el XP de mensajes y los contadores de mensajes se conservan intactos)

require('dotenv').config();

const Model = require('./classes/DatabaseModel.js');
const tracker = require('./classes/RecordTracker.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const db = new Model("servers", require("./database_schema.js").schema);

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    magenta: '\x1b[35m'
};

// Campos que solo existen por los récords (progreso). messages y
// monthlyMessages NO están aquí a propósito: hay que mantenerlos.
const PROGRESS_FIELDS = tracker.PROGRESS_FIELDS;

function parseArgs(argv) {
    const args = { apply: false, yes: false, keepProgress: false, guild: null, user: null, help: false, deleteMsgs: true };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply') args.apply = true;
        else if (a === '--yes') args.yes = true;
        else if (a === '--keep-progress') args.keepProgress = true;
        else if (a === '--no-delete-msgs') args.deleteMsgs = false;
        else if (a === '--help' || a === '-h') args.help = true;
        else if (a === '--guild' && argv[i + 1]) args.guild = argv[++i];
        else if (a === '--user' && argv[i + 1]) args.user = argv[++i];
        else {
            console.error(`${colors.red}❌ Argumento desconocido: ${a}${colors.reset}`);
            printHelp();
            process.exit(1);
        }
    }
    if (args.user && !args.guild) {
        console.error(`${colors.red}❌ --user requiere --guild${colors.reset}`);
        process.exit(1);
    }
    return args;
}

function printHelp() {
    console.log(`
Uso: node reset-records.js [opciones]

  (sin opciones)         Vista previa de lo que se revertiría, sin tocar la DB
  --apply                 Ejecuta los cambios (pide confirmación)
  --yes                   No pide confirmación (usar con --apply)
  --guild <id>            Solo ese servidor
  --user <id>             Solo ese usuario (requiere --guild)
  --keep-progress         Conserva racha/reacciones/canales/counting/voz
  --no-delete-msgs        No borra los mensajes del bot en el canal de récords
  --help, -h              Esta ayuda
`);
}

// Lógica pura en RecordTracker (testeable sin DB): planUserReset.
const { planUserReset } = tracker;

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function deleteBotMessagesFromRecordsChannel(guildId) {
    try {
        const channelId = tracker.getRecordIds().channelId;
        if (!channelId) {
            console.log(`${colors.yellow}⚠️  No hay canal de récords configurado${colors.reset}`);
            return 0;
        }

        // Obtener el ID del bot desde el token
        let botUser = null;
        try {
            botUser = await rest.get(Routes.user());
        } catch (e) {
            console.log(`${colors.yellow}⚠️  No se pudo obtener el ID del bot: ${e.message}${colors.reset}`);
            return 0;
        }
        
        if (!botUser?.id) {
            console.log(`${colors.yellow}⚠️  No se pudo obtener el ID del bot (respuesta vacía)${colors.reset}`);
            return 0;
        }

        let deleted = 0;
        let before = null;
        let totalFetched = 0;
        const maxMessages = 1000; // Límite de seguridad
        
        while (totalFetched < maxMessages) {
            let messages = [];
            try {
                messages = await rest.get(Routes.channelMessages(channelId), {
                    query: { limit: 100, ...(before ? { before } : {}) }
                });
            } catch (e) {
                console.log(`${colors.yellow}⚠️  Error obteniendo mensajes: ${e.message}${colors.reset}`);
                break;
            }
            
            if (!messages?.length) break;
            
            totalFetched += messages.length;
            const botMessages = messages.filter(m => m.author?.id === botUser.id);
            for (const msg of botMessages) {
                try {
                    await rest.delete(Routes.channelMessage(channelId, msg.id));
                    deleted++;
                } catch (e) {
                    // Ignorar errores de borrado individual
                }
            }
            
            if (messages.length < 100) break;
            before = messages[messages.length - 1].id;
            
            // Pequeña pausa para evitar rate limits
            await new Promise(r => setTimeout(r, 200));
        }
        
        if (totalFetched >= maxMessages) {
            console.log(`${colors.yellow}⚠️  Límite de ${maxMessages} mensajes alcanzado${colors.reset}`);
        }
        
        return deleted;
    } catch (e) {
        console.log(`${colors.red}❌ Error borrando mensajes: ${e.message}${colors.reset}`);
        return 0;
    }
}

function askConfirmation(question) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(/^s[ií]?$/i.test(answer.trim()));
        });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    // Espera a que mongoose conecte (DatabaseModel conecta al hacer require).
    const mongoose = require('mongoose');
    try {
        await mongoose.connection.asPromise();
    } catch (e) {
        console.error(`${colors.red}❌ No se pudo conectar a MongoDB. Revisa tu .env${colors.reset}`);
        console.error(e.message);
        process.exit(1);
    }
    console.log(`${colors.green}✅ Conectado a la DB${colors.reset}\n`);

    try {
        const docs = args.guild
            ? [await db.fetch(args.guild).exec().catch(() => null)].filter(Boolean)
            : await db.find({}).exec().catch(() => []);
        if (!docs.length) {
            console.log(`${colors.yellow}⚠️  No hay servidores coincidentes.${colors.reset}`);
            return;
        }

        let totalUsers = 0;
        let totalLevels = 0;
        let totalXp = 0;
        const serverPlans = [];

        for (const doc of docs) {
            const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc;
            const entries = Object.entries(raw.users || {});
            const scoped = args.user ? entries.filter(([id]) => id === args.user) : entries;
            const plans = [];
            for (const [userId, userData] of scoped) {
                const plan = planUserReset(userId, userData || {}, args.keepProgress);
                if (plan) plans.push(plan);
            }
            if (!plans.length) continue;

            const unset = {};
            const set = {};
            for (const p of plans) {
                Object.assign(unset, p.unset);
                Object.assign(set, p.set);
            }
            serverPlans.push({ guildId: raw._id, plans, update: { $unset: unset, $set: set } });
            totalUsers += plans.length;
            totalLevels += plans.reduce((n, p) => n + p.levels, 0);
            totalXp += plans.reduce((n, p) => n + p.removedXp, 0);
        }

        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}`);
        console.log(`${colors.magenta}  RESET DE RÉCORDS ${args.apply ? '(APLICAR)' : '(VISTA PREVIA)'}${colors.reset}`);
        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}\n`);
        console.log(`Servidores afectados: ${serverPlans.length}`);
        console.log(`Usuarios afectados: ${totalUsers}`);
        console.log(`Niveles a quitar: ${totalLevels}`);
        console.log(`XP de récords a revertir: ${totalXp}`);
        for (const s of serverPlans.slice(0, 10)) {
            console.log(`\n${colors.blue}▸ ${s.guildId}${colors.reset} (${s.plans.length} usuarios)`);
            for (const p of s.plans.slice(0, 5)) {
                console.log(`   ${p.userId}: ${p.levels} niveles, -${p.removedXp} XP`);
            }
            if (s.plans.length > 5) console.log(`   ... y ${s.plans.length - 5} más`);
        }
        if (serverPlans.length > 10) console.log(`\n... y ${serverPlans.length - 10} servidores más`);
        console.log(`\n${colors.green}Se conserva:${colors.reset} messages, monthlyMessages, cooldown, hidden, settings, info${args.keepProgress ? ' + progreso' : ''}`);

        if (!totalUsers) {
            console.log(`\n${colors.green}✅ Nadie tiene récords: nada que revertir.${colors.reset}`);
            return;
        }

        if (!args.apply) {
            console.log(`\n${colors.yellow}Vista previa: no se ha tocado la DB. Usa --apply para ejecutar.${colors.reset}`);
            return;
        }

        if (!args.yes) {
            const ok = await askConfirmation(`\n${colors.yellow}¿Revertir ${totalLevels} niveles y ${totalXp} XP de récords? Escribe SI para confirmar: ${colors.reset}`);
            if (!ok) {
                console.log(`${colors.yellow}Cancelado, no se tocó nada.${colors.reset}`);
                return;
            }
        }

        let serversDone = 0;
        for (const s of serverPlans) {
            await db.update(s.guildId, s.update).exec();
            serversDone++;
        }

        // Borrar mensajes del bot en el canal de récords
        let totalDeleted = 0;
        if (args.deleteMsgs) {
            console.log(`\n${colors.blue}🧹 Borrando mensajes del bot en el canal de récords...${colors.reset}`);
            for (const s of serverPlans) {
                const deleted = await deleteBotMessagesFromRecordsChannel(s.guildId);
                if (deleted > 0) {
                    console.log(`   ${colors.green}✓${colors.reset} ${s.guildId}: ${deleted} mensajes borrados`);
                    totalDeleted += deleted;
                }
            }
        }

        console.log(`\n${colors.green}✅ Reset completado: ${totalUsers} usuarios en ${serversDone} servidores. Quitado todo lo de récords, XP revertido${totalDeleted ? `, ${totalDeleted} mensajes del bot borrados` : ''}.${colors.reset}`);
    } finally {
        await mongoose.disconnect().catch(() => {});
        console.log(`${colors.blue}🔌 Conexión cerrada${colors.reset}`);
    }
}

module.exports = { planUserReset, PROGRESS_FIELDS };

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1) });
}
