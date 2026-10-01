// Saneado único de la migración del reset físico al reset lógico
// (commit del reset lógico): pone a 0 los contadores de periodo cuyo
// marcador no es el actual y sella el marcador. Sin esto, los usuarios que
// no han hablado desde antes del cambio conservan el bruto viejo en DB
// (p. ej. 6000 mensajes de septiembre) y, aunque las lecturas ya lo muestran
// como 0, el bruto contamina cualquier vía que lea sin periodo (snapshot de
// fin de mes, etc.).
//
// Uso:
//   node scripts/backfill-periods.js                -> vista previa (dry-run, no toca nada)
//   node scripts/backfill-periods.js --apply        -> ejecuta (pide confirmación)
//   node scripts/backfill-periods.js --apply --yes  -> ejecuta sin preguntar
//   node scripts/backfill-periods.js --guild <id>   -> solo ese servidor
//   node scripts/backfill-periods.js --user <id>    -> solo ese usuario (en todos los
//      servidores salvo que se combine con --guild)
//   npm run backfill-periods -- <opciones>  -> atajo (pasa las opciones)
//
// Lo que HACE por usuario (solo si su marcador no es el periodo actual):
//   monthlyMessages=0, monthlyXP=0, monthlyPeriod=<mes actual>
//   dailyMessages=0, dailyXP=0, dailyPeriod=<día actual>
// Lo que NO toca nunca:
//   xp, messages (totales), records, rachas, reacciones, canales, counting,
//   voz, cooldown, hidden, settings
// Los usuarios ya al día (con marcador actual) no se tocan: su actividad de
// este mes se conserva intacta.
//
// Orden recomendado: desplegar el fix de stale primero y correr esto después.
// Lo único que se puede perder son los mensajes de hoy anteriores al script
// de usuarios que hablaron hoy pero aún no tienen marcador (como mucho, la
// actividad de un día).

require('dotenv').config();

const Model = require('../classes/DatabaseModel.js');
const tracker = require('../classes/RecordTracker.js');

const db = new Model("servers", require("../database_schema.js").schema);

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    magenta: '\x1b[35m'
};

// Plan puro en RecordTracker (testeable sin DB).
const { planUserPeriodReset } = tracker;

function parseArgs(argv) {
    const args = { apply: false, yes: false, guild: null, user: null, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply') args.apply = true;
        else if (a === '--yes') args.yes = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else if (a === '--guild' && argv[i + 1]) args.guild = argv[++i];
        else if (a === '--user' && argv[i + 1]) args.user = argv[++i];
        else {
            console.error(`${colors.red}❌ Argumento desconocido: ${a}${colors.reset}`);
            printHelp();
            process.exit(1);
        }
    }
    return args;
}

function printHelp() {
    console.log(`
Uso: node scripts/backfill-periods.js [opciones]

  (sin opciones)      Vista previa de lo que se sanearía, sin tocar la DB
  --apply              Ejecuta los cambios (pide confirmación)
  --yes                No pide confirmación (usar con --apply)
  --guild <id>         Solo ese servidor
  --user <id>          Solo ese usuario (en todos los servidores salvo
                       que se combine con --guild)
  --help, -h           Esta ayuda
`);
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

    const today = tracker.getMadridDay(new Date());
    const month = tracker.getMadridMonth(new Date());

    // Espera a que mongoose conecte (DatabaseModel conecta al hacer require).
    const mongoose = require('mongoose');
    try {
        await mongoose.connection.asPromise();
    } catch (e) {
        console.error(`${colors.red}❌ No se pudo conectar a MongoDB. Revisa tu .env${colors.reset}`);
        console.error(e.message);
        process.exit(1);
    }
    console.log(`${colors.green}✅ Conectado a la DB${colors.reset} (periodo actual: ${month} / ${today})\n`);

    try {
        const docs = args.guild
            ? [await db.fetch(args.guild).exec().catch(() => null)].filter(Boolean)
            : await db.find({}).exec().catch(() => []);
        if (!docs.length) {
            console.log(`${colors.yellow}⚠️  No hay servidores coincidentes.${colors.reset}`);
            return;
        }

        let totalUsers = 0;
        let totalMonthlyMsgs = 0;
        let totalMonthlyXP = 0;
        let totalDailyMsgs = 0;
        const serverPlans = [];

        for (const doc of docs) {
            const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc;
            const set = {};

            // Marcadores globales: si faltan, se sellan al periodo actual
            // (el mantenimiento perezoso lo haría igual al primer mensaje).
            if (String(raw.info?.monthlyMessagesPeriod || "") !== month) {
                set["info.monthlyMessagesPeriod"] = month;
            }
            if (String(raw.info?.dailyMessagesPeriod || "") !== today) {
                set["info.dailyMessagesPeriod"] = today;
            }

            const entries = Object.entries(raw.users || {});
            const scoped = args.user ? entries.filter(([id]) => id === args.user) : entries;
            const plans = [];
            for (const [userId, userData] of scoped) {
                const plan = planUserPeriodReset(userId, userData || {}, today, month);
                if (plan) {
                    plans.push(plan);
                    Object.assign(set, plan.update.$set);
                }
            }
            if (!Object.keys(set).length) continue;

            serverPlans.push({ guildId: raw._id, plans, update: { $set: set } });
            totalUsers += plans.length;
            totalMonthlyMsgs += plans.reduce((n, p) => n + p.zeroedMonthlyMessages, 0);
            totalMonthlyXP += plans.reduce((n, p) => n + p.zeroedMonthlyXP, 0);
            totalDailyMsgs += plans.reduce((n, p) => n + p.zeroedDailyMessages, 0);
        }

        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}`);
        console.log(`${colors.magenta}  SANEADO DE PERIODOS ${args.apply ? '(APLICAR)' : '(VISTA PREVIA)'}${colors.reset}`);
        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}\n`);
        console.log(`Servidores afectados: ${serverPlans.length}`);
        console.log(`Usuarios a sanear: ${totalUsers}`);
        console.log(`Mensajes mensuales a poner a 0 (bruto viejo): ${totalMonthlyMsgs}`);
        console.log(`XP mensual a poner a 0 (bruto viejo): ${totalMonthlyXP}`);
        console.log(`Mensajes diarios a poner a 0 (bruto viejo): ${totalDailyMsgs}`);
        for (const s of serverPlans.slice(0, 10)) {
            console.log(`\n${colors.blue}▸ ${s.guildId}${colors.reset} (${s.plans.length} usuarios)`);
            for (const p of s.plans.slice(0, 5)) {
                const parts = [];
                if (p.monthly && p.zeroedMonthlyMessages) parts.push(`mensual ${p.zeroedMonthlyMessages}→0`);
                if (p.daily && p.zeroedDailyMessages) parts.push(`diario ${p.zeroedDailyMessages}→0`);
                console.log(`   ${p.userId}: ${parts.length ? parts.join(', ') : 'solo sello de marcador'}`);
            }
            if (s.plans.length > 5) console.log(`   ... y ${s.plans.length - 5} más`);
        }
        if (serverPlans.length > 10) console.log(`\n... y ${serverPlans.length - 10} servidores más`);
        console.log(`\n${colors.green}No se toca:${colors.reset} xp, messages totales, records, progreso, settings`);

        if (!serverPlans.length) {
            console.log(`\n${colors.green}✅ Todo al día: nada que sanear.${colors.reset}`);
            return;
        }

        if (!args.apply) {
            console.log(`\n${colors.yellow}Vista previa: no se ha tocado la DB. Usa --apply para ejecutar.${colors.reset}`);
            return;
        }

        if (!args.yes) {
            const ok = await askConfirmation(`\n${colors.yellow}¿Sanear ${totalUsers} usuarios? Escribe SI para confirmar: ${colors.reset}`);
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

        console.log(`\n${colors.green}✅ Saneado completado: ${totalUsers} usuarios en ${serversDone} servidores.${colors.reset}`);
    } finally {
        await mongoose.disconnect().catch(() => {});
        console.log(`${colors.blue}🔌 Conexión cerrada${colors.reset}`);
    }
}

module.exports = { parseArgs };

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
