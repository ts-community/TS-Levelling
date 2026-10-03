const Discord = require("discord.js")

module.exports = {
metadata: {
    permission: "ManageGuild",
    name: "rewardrole",
    description: "Add or remove a reward role. (requires manage server permission)",
    args: [
        { type: "role", name: "role_name", description: "The role to add or remove", required: true },
        { type: "integer", name: "level", description: "The level to grant the role at, or 0 to remove", min: 0, max: 1000, required: true },
        { type: "bool", name: "keep", description: "Keep this role even when a higher one is reached" },
        { type: "bool", name: "dont_sync", description: "Advanced: Ignores this role when syncing roles" }
    ]
},

async run(client, int, tools) {

    let db = await tools.fetchSettings()
    if (!tools.canManageServer(int.member, db.settings.manualPerms)) return tools.warn("*notMod")

    let role = int.options.getRole("role_name")
    let level = tools.clamp(Math.round(int.options.get("level")?.value), 0, 1000)

    let isKeep = !!int.options.get("keep")?.value
    let isDontSync = !!int.options.get("dont_sync")?.value    

    let existingIndex = db.settings.rewards.findIndex(x => x.id == role.id)
    let foundExisting = (existingIndex >= 0) ? db.settings.rewards[existingIndex] : null

    let newRoles = db.settings.rewards
    if (foundExisting) newRoles.splice(existingIndex, 1)    // remove by default

    function finish(msg) {
        let viewRewardRoles = tools.row(tools.button({style: "Primary", label: `Ver todas las recompensas (${newRoles.length})`, customId: "list_reward_roles"}))

        client.db.update(int.guild.id, { $set: { 'settings.rewards': newRoles, 'info.lastUpdate': Date.now() }}).then(() => {
            return int.reply({ content: msg, components: viewRewardRoles })        
        })
    }
    
    // deleting a reward role
    if (level == 0) {
        if (!foundExisting) return tools.warn("¡Los roles de recompensa no se pueden dar en el nivel 0! Úsalo para eliminar roles existentes.")
        return finish(`❌ **Rol de recompensa <@&${role.id}> del nivel ${foundExisting.level} eliminado.**`, newRoles)
    }

    // no manage roles perm
    if (!int.guild.members.me.permissions.has(Discord.PermissionFlagsBits.ManageRoles)) return tools.warn("*cantManageRoles")

    // can't grant role
    if (!role.editable) return tools.warn(`¡No tengo permiso para dar <@&${role.id}>!`)

    // set up new role data
    let roleData = { id: role.id, level }
    let extraStrings = []
    if (isKeep) { roleData.keep = true; extraStrings.push("se conserva siempre") }
    if (isDontSync) { roleData.noSync = true; extraStrings.push("ignora el sync") }

    newRoles.push(roleData)
    let extraStr = (extraStrings.length < 1) ? "" : ` (${extraStrings.join(", ")})`

    // if reward already exists, replace existing role
    if (foundExisting) {
        if (foundExisting.level == level) return tools.warn(`¡Este rol ya se da en el nivel ${level}!`)
        return finish(`📝 **¡<@&${role.id}> ahora se dará en el nivel ${level}!** (antes ${foundExisting.level})${extraStr}`)
    }

    // otherwise, just add the role
    return finish(`✅ **¡<@&${role.id}> ahora se dará en el nivel ${level}!**${extraStr}`)

}}