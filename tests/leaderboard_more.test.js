const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('load more appends, retries a failed page and replaces on sort',async()=>{
 const html=fs.readFileSync('app/html/leaderboard.html','utf8');
 const source=html.slice(html.indexOf('    let loadingPage = false'),html.indexOf('    /* teclado:'));
 let fail=false;const renders=[],urls=[];
 const chain={is:()=>true,scrollTop:()=>0,val(){return this},prop(){return this},text(){return this},toggle(){return this}};
 const context={page:1,totalPages:3,statSort:'xp',pageCache:{},$:()=>chain,document:{activeElement:{blur(){}}},console:{error(){}},alert(){},setSortPending(){},updateRankedCount(){},appendLeaderboard:(rows,append)=>renders.push({rows,append}),Fetch:async url=>{urls.push(url);if(fail)throw Error('network');return {leaderboard:[{id:'user'}],pageInfo:{page:Number(new URL(url,'https://local').searchParams.get('page')),pageCount:3}}}};
 vm.createContext(context);vm.runInContext(source,context);
 await context.setPage(2);assert.equal(renders[0].append,true);assert.match(urls[0],/pageSize=10/);
 fail=true;await context.setPage(3);assert.equal(context.page,2);
 fail=false;await context.setPage(3);assert.equal(context.page,3);
 context.statSort='monthlyXP';await context.setPage(1,true);assert.equal(renders.at(-1).append,false);assert.equal(context.page,1);
});
