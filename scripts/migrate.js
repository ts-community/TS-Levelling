const { MongoClient } = require('mongodb');
require('dotenv').config();

// Colores para la consola
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    magenta: '\x1b[35m'
};

// Estructura esperada según database_schema.js
const expectedStructure = {
    users: 'object', // Debe ser objeto, no array
    settings: {
        enabled: 'boolean',
        gain: 'object',
        curve: 'object',
        rounding: 'number',
        maxLevel: 'number',
        levelUp: 'object',
        multipliers: {
            roles: 'array',
            rolePriority: 'string',
            channels: 'array',
            channelStacking: 'string'
        },
        rewards: 'array',
        rewardSyncing: 'object',
        leaderboard: 'object',
        rankCard: 'object',
        hideMultipliers: 'boolean',
        manualPerms: 'boolean'
    },
    info: 'object'
};

function getType(value) {
    if (value === null || value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function validateStructure(doc, expected, path = '') {
    const issues = [];
    
    for (const [key, expectedType] of Object.entries(expected)) {
        const fullPath = path ? `${path}.${key}` : key;
        const actualValue = doc[key];
        const actualType = getType(actualValue);
        
        if (actualValue === undefined) {
            issues.push({ path: fullPath, issue: 'missing', expected: expectedType, actual: 'undefined' });
            continue;
        }
        
        if (typeof expectedType === 'string') {
            if (actualType !== expectedType) {
                issues.push({ path: fullPath, issue: 'type_mismatch', expected: expectedType, actual: actualType });
            }
        } else if (typeof expectedType === 'object') {
            if (actualType === 'object' && !Array.isArray(actualValue)) {
                issues.push(...validateStructure(actualValue, expectedType, fullPath));
            } else {
                issues.push({ path: fullPath, issue: 'type_mismatch', expected: 'object', actual: actualType });
            }
        }
    }
    
    return issues;
}

async function migrate() {
    const uri = process.env.MONGO_DB_URI;
    const dbName = process.env.MONGO_DB_NAME;

    if (!uri || !dbName) {
        console.error(`${colors.red}❌ Error: MONGO_DB_URI o MONGO_DB_NAME no están configurados en .env${colors.reset}`);
        process.exit(1);
    }

    const client = new MongoClient(uri);
    
    try {
        console.log(`${colors.blue}🔄 Conectando a MongoDB...${colors.reset}`);
        await client.connect();
        console.log(`${colors.green}✅ Conectado exitosamente${colors.reset}\n`);

        const db = client.db(dbName);
        const collection = db.collection('servers');

        // 1. Analizar todos los documentos
        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}`);
        console.log(`${colors.magenta}  FASE 1: ANÁLISIS DE ESTRUCTURA${colors.reset}`);
        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}\n`);
        
        const totalDocs = await collection.countDocuments({});
        console.log(`📊 Total de servidores en la base de datos: ${totalDocs}\n`);

        // Verificar types de users
        const usersAsArray = await collection.countDocuments({ "users": { $type: "array" } });
        const usersAsObject = await collection.countDocuments({ "users": { $type: "object", $not: { $type: "array" } } });
        const usersUndefined = totalDocs - usersAsArray - usersAsObject;

        console.log(`${colors.blue}📋 Estado del campo 'users':${colors.reset}`);
        console.log(`   ✅ Como objeto (correcto): ${colors.green}${usersAsObject}${colors.reset}`);
        console.log(`   ⚠️  Como array (necesita migración): ${colors.yellow}${usersAsArray}${colors.reset}`);
        if (usersUndefined > 0) {
            console.log(`   ❌ Undefined/null: ${colors.red}${usersUndefined}${colors.reset}`);
        }
        console.log();

        // Verificar estructura de settings
        const docs = await collection.find({}).limit(100).toArray();
        const structureIssues = new Map();

        for (const doc of docs) {
            const issues = validateStructure(doc, expectedStructure);
            if (issues.length > 0) {
                structureIssues.set(doc._id, issues);
            }
        }

        if (structureIssues.size > 0) {
            console.log(`${colors.yellow}⚠️  Encontrados ${structureIssues.size} documento(s) con problemas de estructura${colors.reset}`);
            
            const issueTypes = {};
            structureIssues.forEach((issues) => {
                issues.forEach(issue => {
                    const key = `${issue.path} (${issue.issue})`;
                    issueTypes[key] = (issueTypes[key] || 0) + 1;
                });
            });

            console.log(`\n${colors.blue}📊 Resumen de problemas encontrados:${colors.reset}`);
            Object.entries(issueTypes).forEach(([issue, count]) => {
                console.log(`   ${count}x ${issue}`);
            });
            console.log();
        } else {
            console.log(`${colors.green}✅ Estructura de settings correcta en todos los documentos revisados${colors.reset}\n`);
        }

        // 2. Migración
        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}`);
        console.log(`${colors.magenta}  FASE 2: MIGRACIÓN${colors.reset}`);
        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}\n`);

        let totalMigrated = 0;

        // Migrar users de array a objeto
        if (usersAsArray > 0) {
            console.log(`${colors.blue}🔄 Migrando campo 'users' de array a objeto...${colors.reset}`);
            
            const result = await collection.updateMany(
                { "users": { $type: "array" } },
                [
                    {
                        $set: {
                            users: {
                                $cond: {
                                    if: { $eq: [{ $type: "$users" }, "array"] },
                                    then: {
                                        $arrayToObject: {
                                            $map: {
                                                input: "$users",
                                                as: "user",
                                                in: {
                                                    k: "$$user.id",
                                                    v: { 
                                                        xp: { $ifNull: ["$$user.xp", 0] },
                                                        cooldown: { $ifNull: ["$$user.cooldown", null] },
                                                        hidden: { $ifNull: ["$$user.hidden", false] }
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    else: "$users"
                                }
                            }
                        }
                    }
                ]
            );

            console.log(`   ✅ Migrados: ${result.modifiedCount} documento(s)`);
            totalMigrated += result.modifiedCount;
        } else {
            console.log(`${colors.green}✅ Campo 'users' ya está en formato correcto${colors.reset}`);
        }

        // Asegurar que settings.multipliers.roles y channels sean arrays
        console.log(`\n${colors.blue}🔄 Verificando arrays en multipliers...${colors.reset}`);
        const rolesNotArray = await collection.countDocuments({ 
            "settings.multipliers.roles": { $exists: true, $not: { $type: "array" } }
        });
        const channelsNotArray = await collection.countDocuments({ 
            "settings.multipliers.channels": { $exists: true, $not: { $type: "array" } }
        });

        if (rolesNotArray > 0 || channelsNotArray > 0) {
            const fixMultipliers = await collection.updateMany(
                { 
                    $or: [
                        { "settings.multipliers.roles": { $exists: true, $not: { $type: "array" } } },
                        { "settings.multipliers.channels": { $exists: true, $not: { $type: "array" } } }
                    ]
                },
                [
                    {
                        $set: {
                            "settings.multipliers.roles": {
                                $cond: {
                                    if: { $eq: [{ $type: "$settings.multipliers.roles" }, "array"] },
                                    then: "$settings.multipliers.roles",
                                    else: []
                                }
                            },
                            "settings.multipliers.channels": {
                                $cond: {
                                    if: { $eq: [{ $type: "$settings.multipliers.channels" }, "array"] },
                                    then: "$settings.multipliers.channels",
                                    else: []
                                }
                            }
                        }
                    }
                ]
            );
            console.log(`   ✅ Corregidos: ${fixMultipliers.modifiedCount} documento(s)`);
            totalMigrated += fixMultipliers.modifiedCount;
        } else {
            console.log(`${colors.green}✅ Multipliers correctos${colors.reset}`);
        }

        // Asegurar que rewards sea un array
        console.log(`\n${colors.blue}🔄 Verificando array de rewards...${colors.reset}`);
        const rewardsNotArray = await collection.countDocuments({ 
            "settings.rewards": { $exists: true, $not: { $type: "array" } }
        });

        if (rewardsNotArray > 0) {
            const fixRewards = await collection.updateMany(
                { "settings.rewards": { $exists: true, $not: { $type: "array" } } },
                [
                    {
                        $set: {
                            "settings.rewards": {
                                $cond: {
                                    if: { $eq: [{ $type: "$settings.rewards" }, "array"] },
                                    then: "$settings.rewards",
                                    else: []
                                }
                            }
                        }
                    }
                ]
            );
            console.log(`   ✅ Corregidos: ${fixRewards.modifiedCount} documento(s)`);
            totalMigrated += fixRewards.modifiedCount;
        } else {
            console.log(`${colors.green}✅ Rewards correctos${colors.reset}`);
        }

        // 3. Verificación final
        console.log(`\n${colors.magenta}═══════════════════════════════════════${colors.reset}`);
        console.log(`${colors.magenta}  FASE 3: VERIFICACIÓN FINAL${colors.reset}`);
        console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}\n`);

        const finalUsersArray = await collection.countDocuments({ "users": { $type: "array" } });
        const finalUsersObject = await collection.countDocuments({ "users": { $type: "object", $not: { $type: "array" } } });

        console.log(`${colors.blue}📊 Estado final:${colors.reset}`);
        console.log(`   Users como objeto: ${colors.green}${finalUsersObject}${colors.reset}`);
        console.log(`   Users como array: ${finalUsersArray > 0 ? colors.red : colors.green}${finalUsersArray}${colors.reset}`);
        console.log();

        if (finalUsersArray === 0 && totalMigrated > 0) {
            console.log(`${colors.green}✨ ¡MIGRACIÓN COMPLETADA CON ÉXITO!${colors.reset}`);
            console.log(`   Total de documentos migrados: ${totalMigrated}`);
        } else if (totalMigrated === 0) {
            console.log(`${colors.green}✅ No se requirió ninguna migración${colors.reset}`);
            console.log(`   Todos los documentos ya tienen la estructura correcta`);
        } else {
            console.log(`${colors.yellow}⚠️  Migración parcial${colors.reset}`);
            console.log(`   Documentos migrados: ${totalMigrated}`);
            console.log(`   Considera ejecutar el script nuevamente`);
        }

        // Mostrar ejemplo
        console.log(`\n${colors.blue}📄 Ejemplo de documento migrado:${colors.reset}`);
        const sample = await collection.findOne({ "users": { $type: "object", $not: { $type: "array" } } });
        if (sample) {
            console.log(`   Servidor: ${sample._id}`);
            console.log(`   Users (total): ${Object.keys(sample.users || {}).length}`);
            console.log(`   Rewards: ${(sample.settings?.rewards || []).length}`);
            console.log(`   Multipliers roles: ${(sample.settings?.multipliers?.roles || []).length}`);
            console.log(`   Multipliers channels: ${(sample.settings?.multipliers?.channels || []).length}`);
            
            const userIds = Object.keys(sample.users || {}).slice(0, 1);
            if (userIds.length > 0) {
                console.log(`\n   Ejemplo de usuario:`);
                console.log(`   ${JSON.stringify({ [userIds[0]]: sample.users[userIds[0]] }, null, 2).split('\n').join('\n   ')}`);
            }
        }
        console.log();

    } catch (error) {
        console.error(`${colors.red}❌ Error durante la migración:${colors.reset}`);
        console.error(error);
        process.exit(1);
    } finally {
        await client.close();
        console.log(`${colors.blue}🔌 Conexión cerrada${colors.reset}`);
    }
}

// Ejecutar migración
console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}`);
console.log(`${colors.green}     Polaris Complete DB Migration${colors.reset}`);
console.log(`${colors.magenta}═══════════════════════════════════════${colors.reset}\n`);

migrate().catch(console.error);