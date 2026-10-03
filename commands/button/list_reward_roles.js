const PageEmbed = require("../../classes/PageEmbed.js")

module.exports = {
metadata: {
    name: "button:list_reward_roles",
},

async run(client, int, tools) {
    let db = await tools.fetchSettings()
    if (!db) return tools.warn("*noData")

    if (!tools.canManageServer(int.member, db.settings.manualPerms)) return tools.warn("*notMod")

    if (!db.settings.rewards.length) return tools.warn("¡Este servidor no tiene ningún rol de recompensa!")

    let embed = tools.createEmbed({
        title: `Roles de recompensa (${db.settings.rewards.length})`,
        color: tools.COLOR,
        footer: "Añade o quita roles con /rewardrole"
    })

    let rewards = db.settings.rewards.sort((a, b) => a.level - b.level);

    let rewardEmbed = new PageEmbed(embed, rewards, {
        size: 20, owner: int.user.id,
        mapFunction: (x) => `**Level ${x.level}** - <@&${x.id}>${x.keep ? " (keep)" : ""}${x.noSync ? " (no sync)" : ""}`
    })

    rewardEmbed.post(int)

}}