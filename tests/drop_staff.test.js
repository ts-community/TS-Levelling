const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web_app.js'),'utf8');
const start=source.indexOf('async (cl, ctx) => {',source.indexOf("if (req.query.view === 'staff')"));
const end=source.indexOf('}, { context:',start)+1;
const check=vm.runInNewContext('('+source.slice(start,end)+')');
async function access({present=true,perm='',roles=[],owner=false,fail=false}={}) {
 let request;
 const member={id:'user',permissions:{has:p=>p===perm},roles:{cache:new Set(roles)}};
 const guild={ownerId:owner?'user':'owner',members:{fetch:async options=>{request=options;if(fail)throw Error('offline');return present?member:null},cache:new Map([['claimant',{displayName:'Player'}]])}};
 const result=await check({guilds:{cache:new Map([['guild',guild]])},users:{cache:new Map()}},{guildId:'guild',userId:'user',roles:['dropStaff'],ids:['claimant','unknown']});
 assert.equal(request.force,true);
 return result;
}
test('staff panel allows owners, administrators, managers and configured drop roles',async()=>{
 for(const options of [{owner:true},{perm:'Administrator'},{perm:'ManageGuild'},{roles:['dropStaff']}])assert.equal((await access(options)).allowed,true);
});
test('staff panel denies ordinary members, removed roles, missing members and lookup failures',async()=>{
 for(const options of [{},{roles:['other']},{present:false},{fail:true}])assert.equal(await access(options),null);
});
test('staff panel resolves cached names without individual claimant API requests',async()=>{
 const result=await access({perm:'ManageGuild'});assert.equal(result.names.claimant,'Player');assert.equal(result.names.unknown,'unknown');
});

test('the TS management link opens the panel while other guilds retain their private view', () => {
    const drops = require('../classes/Drops')
    const code = 'EXAMPLE2'
    assert.equal(drops.managementUrl(drops.MAIN_GUILD_ID, code), 'https://panel.tscomunity.es/drops?code=EXAMPLE2')
    const guild = '100000000000000000'
    assert.equal(drops.managementUrl(guild, code), drops.dropUrl(guild, code) + '?view=staff')
})
