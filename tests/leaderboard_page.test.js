const test=require('node:test'),assert=require('node:assert/strict');
const paginate=require('../classes/LeaderboardPage');
test('first 100 then batches of ten cover everyone exactly once',()=>{
 const ids=Array.from({length:127},(_,i)=>i+1),shown=[];
 for(let page=1;page<=4;page++){
  const p=paginate(ids.length,{page,pageSize:10,initialSize:100});
  assert.equal(p.pageCount,4);
  const batch=ids.slice(p.start,p.end);
  assert.equal(batch.length,[100,10,10,7][page-1]);
  shown.push(...batch);
 }
 assert.deepEqual(shown,ids);
});
test('ordinary pagination stays compatible and invalid input is bounded',()=>{
 assert.deepEqual(paginate(250,{page:2}),{page:2,pageSize:100,pageCount:3,start:100,end:200});
 assert.equal(paginate(100,{pageSize:10,initialSize:100}).pageCount,1);
 assert.equal(paginate(0,{}).pageCount,0);
 assert.equal(paginate(10,{pageSize:'oops',initialSize:999,page:-2}).end,100);
});
