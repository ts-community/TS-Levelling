const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('guest initialization preserves the account card used by the rank preview',()=>{
 const html=fs.readFileSync(require.resolve('../app/html/leaderboard.html'),'utf8');
 const start=html.indexOf("    if (loggedIn) $('.plsLogIn, .rankDemo').remove()");
 const end=html.indexOf('    if (!data.moderator)',start);
 let mounted=true;
 const node={style:{setProperty(){}}};
 const stub={remove(){return this},first(){return this},prop(){return ''},each(){return this}};
 const $=selector=>selector==='#accountInfo'?{remove(){mounted=false},get 0(){return mounted?node:undefined}}:stub;
 vm.runInNewContext(html.slice(start,end),{loggedIn:false,$});
 assert.equal(mounted,true,'guest cleanup must retain the actual rank card');
 assert.doesNotThrow(()=>$ ('#accountInfo')[0].style.setProperty('--lv','#fff'));
});
