import {test} from 'node:test';
import assert from 'node:assert/strict';
import {create,mutate,view,GameError} from '../lib/game.js';
import handler from '../api/game.js';
const tokens=Array.from({length:16},(_,i)=>(i+1).toString(16).padStart(64,'0'));
function setup(n=3){const g=create('ABC234','Player 0',tokens[0]);for(let i=1;i<n;i++)mutate(g,'join',{name:'Player '+i},tokens[i]);return g;}
const host=(g,a,b={})=>mutate(g,a,{game:g.game,...b},tokens[0]);
const vote=(g,i,target)=>mutate(g,'vote',{game:g.game,round:g.round,target:g.players[target].id},tokens[i]);
test('lobby caps at 15 and rejects duplicate names',()=>{const g=setup(15);assert.throws(()=>mutate(g,'join',{name:'Extra'},tokens[15]),/full/);assert.equal(g.players.length,15);const h=setup();assert.throws(()=>mutate(h,'join',{name:'player 1'},tokens[4]),/taken/);});
test('join retries keep one seat; late joins forbidden',()=>{const g=setup();mutate(g,'join',{name:'Player 1'},tokens[1]);assert.equal(g.players.length,3);host(g,'start',{rounds:2});assert.throws(()=>mutate(g,'join',{name:'Extra'},tokens[4]),/started/);});
test('only host can start, skip, reveal, reset, remove',()=>{for(const action of ['start','skip','reveal','reset','remove']){const g=setup();assert.throws(()=>mutate(g,action,{game:g.game,rounds:2},tokens[1]),/Only the host/);}});
test('round count constrained; solo start disallowed',()=>{assert.throws(()=>host(setup(1),'start',{rounds:1}),/friend/);for(const rounds of [0,4,1.5,'2'])assert.throws(()=>host(setup(),'start',{rounds}),/Rounds/);});
test('votes secret, immutable, single-use across game; self votes allowed',()=>{const g=setup();host(g,'start',{rounds:3});vote(g,0,0);vote(g,0,0);assert.throws(()=>vote(g,0,1),/locked/);const visible=view(g,tokens[1]);assert.equal(visible.results.length,0);assert.equal(visible.votes,undefined);assert.equal(visible.players[0].secret,undefined);assert.deepEqual(visible.used,[]);vote(g,1,1);assert.equal(g.round,0);vote(g,2,2);assert.equal(g.round,1);assert.throws(()=>vote(g,0,0),/already chosen/);});
test('random prompts unique and same for everyone',()=>{const g=setup(15);host(g,'start',{rounds:15});assert.equal(new Set(g.prompts).size,15);assert.equal(view(g,tokens[0]).prompt,view(g,tokens[14]).prompt);});
test('all tied winners revealed, no future results leak',()=>{const g=setup();host(g,'start',{rounds:2});for(let i=0;i<3;i++)vote(g,i,i);for(let i=0;i<3;i++)vote(g,i,(i+1)%3);assert.equal(g.phase,'results');assert.equal(view(g,tokens[0]).results.length,0);host(g,'reveal',{reveal:-1});const v=view(g,tokens[1]);assert.equal(v.results.length,1);assert.equal(v.results[0].winners.length,3);assert.equal(v.results[0].total,3);host(g,'reveal',{reveal:0});assert.equal(view(g,tokens[0]).results.length,2);});
test('majority winner and zero-vote skipped rounds',()=>{const g=setup();host(g,'start',{rounds:2});vote(g,0,1);vote(g,1,1);vote(g,2,0);host(g,'skip',{round:1});host(g,'reveal',{reveal:-1});assert.deepEqual(view(g,tokens[0]).results[0].winners,[g.players[1].id]);host(g,'reveal',{reveal:0});assert.deepEqual(view(g,tokens[0]).results[1].winners,[]);});
test('replay clears picks and invalidates stale actions',()=>{const g=setup();host(g,'start',{rounds:1});const old=g.game;host(g,'skip',{round:0});host(g,'reset');assert.equal(g.phase,'lobby');assert.notEqual(g.game,old);assert.deepEqual(view(g,tokens[0]).used,[]);assert.throws(()=>mutate(g,'start',{game:old,rounds:1},tokens[0]),/changed/);});
test('stale votes and reveal clicks rejected',()=>{const g=setup();host(g,'start',{rounds:2});host(g,'skip',{round:0});assert.throws(()=>mutate(g,'vote',{game:g.game,round:0,target:g.players[0].id},tokens[0]),/changed/);host(g,'skip',{round:1});host(g,'reveal',{reveal:-1});assert.throws(()=>host(g,'reveal',{reveal:-1}),/changed/);});
test('authentication and name validation',()=>{const g=setup();assert.throws(()=>view(g,tokens[8]),GameError);for(const name of ['', ' '.repeat(3),'a'.repeat(25),null])assert.throws(()=>create('ABC234',name,tokens[0]),/name/);});
async function request(body,token=tokens[0]){let status=200,result;const req={method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body};const res={setHeader(){},set statusCode(s){status=s;},end(b){result=JSON.parse(b);}};await handler(req,res);return {status,...result};}
test('API integration: 15 concurrent joins and votes, reconnect, reveal, expiry',async()=>{
 process.env.LOCAL_MEMORY='1';let g=await request({action:'create',name:'Host'});assert.equal(g.status,200);
 const code=g.code;
 const joins=await Promise.all(tokens.slice(1,15).map((t,i)=>request({action:'join',code,name:'Guest '+i},t)));assert.ok(joins.every(r=>r.status===200));
 g=await request({action:'state',code});assert.equal(g.players.length,15);
 const start=await request({action:'start',code,game:g.game,rounds:1});assert.equal(start.phase,'voting');
 const votes=await Promise.all(tokens.slice(0,15).map(t=>request({action:'vote',code,game:g.game,round:0,target:g.players[0].id},t)));assert.ok(votes.every(v=>v.status===200));
 let final=await request({action:'state',code},tokens[14]);assert.equal(final.phase,'results');assert.deepEqual(final.results,[]);
 final=await request({action:'reveal',code,game:g.game,reveal:-1});assert.equal(final.results[0].total,15);assert.deepEqual(final.results[0].winners,[g.players[0].id]);
 assert.equal((await request({action:'state',code},tokens[15])).status,401);
 assert.equal((await request({action:'state',code:'ZZZZZZ'})).status,404);
});
test('expired room is unavailable and production never uses memory',async()=>{
 const {get,save}=await import('../lib/store.js');process.env.LOCAL_MEMORY='1';
 const g=create('EXP234','Host',tokens[0]);g.expires=Date.now()-1;await save(g,null);assert.equal(await get(g.code),null);
 const old=process.env.VERCEL;process.env.VERCEL='1';
 if(!process.env.UPSTASH_REDIS_REST_URL)await assert.rejects(()=>get('ABC234'),/configure Redis/);
 if(old===undefined)delete process.env.VERCEL;else process.env.VERCEL=old;
});
