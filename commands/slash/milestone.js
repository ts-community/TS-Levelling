const ranks = require("../../consts/ranks.js")
const config = require("../../config.json")

module.exports = {
  metadata: {
    name: "sync-milestone",
    description: "Syncs the milestone role to members with rank roles",
    args: []
  },

  async run(client, int, tools) {
    // Verificar permisos
    if (!tools.canManageServer(int.member)) {
      return tools.warn("No tienes permiso para usar este comando.")
    }

    const milestoneRoleId = config.roles?.milestones?.id
    if (!milestoneRoleId) {
      return tools.warn("El rol de hito no está configurado.")
    }

    const milestoneRole = int.guild.roles.cache.get(milestoneRoleId)
    if (!milestoneRole) {
      return tools.warn("No se ha encontrado el rol de hito en este servidor.")
    }

    // Verificar que el bot tenga permisos para asignar roles
    const botMember = int.guild.members.me
    if (!botMember.permissions.has("ManageRoles")) {
      return tools.warn("El bot no tiene permiso para gestionar roles.")
    }

    // Verificar jerarquía de roles
    if (milestoneRole.position >= botMember.roles.highest.position) {
      return tools.warn("El rol de hito está por encima del rol más alto del bot. No puede asignarlo.")
    }

    // Extraer todos los IDs de roles de rank
    const rankRoleIds = new Set(
      ranks.flatMap(rank => rank.roles.map(r => r.id))
    )

    console.log(`[SYNC] ========================================`)
    console.log(`[SYNC] Starting milestone sync`)
    console.log(`[SYNC] Guild: ${int.guild.name} (${int.guild.id})`)
    console.log(`[SYNC] Milestone role: ${milestoneRole.name} (${milestoneRoleId})`)
    console.log(`[SYNC] Rank roles to check: ${rankRoleIds.size}`)
    console.log(`[SYNC] ========================================`)

    await int.reply({
      content: "⏳ **Sincronización iniciada.** Puede tardar varios minutos.\nMira la consola para ver el progreso detallado.",
      flags: 64 // ephemeral flag
    })

    // Fetch de miembros por lotes
    console.log(`[SYNC] Fetching members in batches...`)
    const startTime = Date.now()
    
    let allMembers = new Map()
    let after = '0'
    let batchCount = 0
    
    try {
      while (true) {
        batchCount++
        const fetched = await int.guild.members.list({ limit: 1000, after })
        
        console.log(`[SYNC] Batch ${batchCount}: Fetched ${fetched.size} members (total: ${allMembers.size + fetched.size})`)
        
        if (fetched.size === 0) break
        
        // Añadir al map total
        fetched.forEach((member, id) => allMembers.set(id, member))
        
        // Actualizar el cursor
        after = fetched.lastKey()
        
        // Pequeña pausa entre lotes
        await new Promise(r => setTimeout(r, 500))
      }
      
      console.log(`[SYNC] ✓ Fetched ${allMembers.size} members total in ${batchCount} batches`)
    } catch (err) {
      console.error(`[SYNC][ERROR] Failed to fetch members:`, err)
      return int.followUp({
        content: `❌ Error al obtener los miembros.`,
        flags: 64
      })
    }

    const members = Array.from(allMembers.values())
    let processed = 0
    let updated = 0
    let skipped = 0
    let errors = 0

    for (const member of members) {
      processed++

      // Saltar bots
      if (member.user.bot) {
        skipped++
        continue
      }

      // Ya tiene el milestone
      if (member.roles.cache.has(milestoneRoleId)) {
        skipped++
        continue
      }

      // Verificar si tiene algún rol de rank
      const memberRankRoles = member.roles.cache.filter(role => 
        rankRoleIds.has(role.id)
      )

      if (memberRankRoles.size === 0) {
        skipped++
        continue
      }

      // Intentar añadir el rol
      try {
        await member.roles.add(milestoneRole, `Milestone sync - has rank role(s)`)
        updated++
        console.log(
          `[SYNC] ✓ [${updated}] Added milestone → ${member.user.tag} (${member.id}) | Rank roles: ${memberRankRoles.map(r => r.name).join(", ")}`
        )
      } catch (err) {
        errors++
        console.error(
          `[SYNC] ✗ [ERROR ${errors}] Failed for ${member.user.tag} (${member.id}):`,
          err.message
        )
      }

      // Rate limit protection
      await new Promise(r => setTimeout(r, 150))

      // Log de progreso cada 50 miembros
      if (processed % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        const rate = (processed / (Date.now() - startTime) * 1000).toFixed(1)
        const eta = members.length > processed 
          ? ((members.length - processed) / rate).toFixed(0)
          : 0
        console.log(
          `[SYNC] Progress: ${processed}/${members.length} (${((processed/members.length)*100).toFixed(1)}%) | ` +
          `Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors} | ` +
          `Rate: ${rate}/s | Elapsed: ${elapsed}s | ETA: ${eta}s`
        )
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
    
    console.log(`[SYNC] ========================================`)
    console.log(`[SYNC] SYNC COMPLETED`)
    console.log(`[SYNC] Total members: ${processed}`)
    console.log(`[SYNC] Milestone added: ${updated}`)
    console.log(`[SYNC] Skipped: ${skipped}`)
    console.log(`[SYNC] Errors: ${errors}`)
    console.log(`[SYNC] Time elapsed: ${totalTime}s`)
    console.log(`[SYNC] ========================================`)

    return int.followUp({
      content: 
        `✅ **¡Sincronización completada!**\n\n` +
        `📊 **Estadísticas:**\n` +
        `• Miembros totales: **${processed}**\n` +
        `• Hito añadido: **${updated}**\n` +
        `• Omitidos: **${skipped}**\n` +
        `• Errores: **${errors}**\n` +
        `• Tiempo: **${totalTime}s**`,
      flags: 64
    })
  }
}