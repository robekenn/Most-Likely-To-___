import {test} from 'node:test';
import assert from 'node:assert/strict';
import {create,mutate,view,lobbyPreview} from '../lib/game.js';
import {drawPrompts} from '../lib/prompt-deck.js';
import {PROMPT_POOLS} from '../lib/prompt-pools.js';
import {GAME_MODES,getGameMode} from '../public/game-modes.js';
import handler from '../api/game.js';
const host='a'.repeat(64),guest='b'.repeat(64);
const normalize=p=>p.toLowerCase().replace(/[^a-z0-9]/g,'');
test('all three modes have 250 distinct prompts and match their public counts',()=>{
 const all=[];
 for(const [id,pool] of Object.entries(PROMPT_POOLS)){
  assert.equal(pool.length,250);assert.equal(pool.length,GAME_MODES[id].count);
  assert.equal(new Set(pool.map(normalize)).size,pool.length);
  assert.ok(pool.every(p=>p.length>15&&p.trim()===p));all.push(...pool);
 }
 assert.equal(new Set(all.map(normalize)).size,750);
 const explicit=/\b(fuck\w*|shit\w*|damn\w*|bullshit|piss\w*|asshole\w*)\b/i;
 assert.ok(PROMPT_POOLS.family.every(p=>!explicit.test(p)));
 assert.ok(PROMPT_POOLS.judgmental.every(p=>!explicit.test(p)));
 assert.ok(PROMPT_POOLS.adults.some(p=>explicit.test(p)));
});
test('Family Friendly is the default and invalid modes are rejected',()=>{
 assert.equal(create('ABC234','Host',host).gameMode,'family');
 for(const gameMode of ['mixed','__proto__','constructor','',42]){
  assert.throws(()=>create('ABC234','Host',host,{gameMode}),/valid game mode/);
  assert.equal(getGameMode(gameMode),undefined);
 }
});
test('Adults Only requires explicit confirmation on creation and new joins',()=>{
 for(const adultsConfirmed of [undefined,false,'true',1])assert.throws(()=>create('ABC234','Host',host,{gameMode:'adults',adultsConfirmed}),/18 or older/);
 const g=create('ABC234','Host',host,{gameMode:'adults',adultsConfirmed:true});
 assert.throws(()=>mutate(g,'join',{name:'Guest'},guest),/18 or older/);assert.equal(g.players.length,1);
 mutate(g,'join',{name:'Guest',adultsConfirmed:true},guest);assert.equal(g.players.length,2);
 mutate(g,'join',{name:'Guest'},guest);assert.equal(g.players.length,2); // Existing seat can reconnect.
});
test('clean modes accept guests without an adult confirmation',()=>{
 for(const gameMode of ['family','judgmental']){
  const g=create('ABC234','Host',host,{gameMode});mutate(g,'join',{name:'Guest'},guest);
  assert.equal(g.players.length,2);assert.equal(view(g,guest).gameMode,gameMode);
 }
});
test('each mode draws only its own prompts and exhausts its pool before repeating',()=>{
 for(const gameMode of Object.keys(PROMPT_POOLS)){
  let history=[];const seen=new Set();
  for(let game=0;game<25;game++){
   const deck=drawPrompts(10,history,gameMode);
   for(const prompt of deck.picked){assert.ok(PROMPT_POOLS[gameMode].includes(prompt));assert.ok(!seen.has(prompt));seen.add(prompt);}
   history=deck.history;
  }
  assert.equal(seen.size,250);
  const refill=drawPrompts(15,history,gameMode);assert.equal(new Set(refill.picked).size,15);
 }
});
test('mode and history persist through replay and clients cannot choose a different pool at start',()=>{
 for(const gameMode of Object.keys(PROMPT_POOLS)){
  const g=create('ABC234','Host',host,{gameMode,adultsConfirmed:true});
  mutate(g,'join',{name:'Guest',adultsConfirmed:true},guest);
  mutate(g,'start',{game:g.game,gameMode:'other-mode',rounds:2},host);
  assert.ok(g.prompts.every(p=>PROMPT_POOLS[gameMode].includes(p)));
  const previous=[...g.prompts];
  mutate(g,'skip',{game:g.game,round:0},host);mutate(g,'skip',{game:g.game,round:1},host);
  mutate(g,'reset',{game:g.game},host);assert.equal(g.gameMode,gameMode);
  mutate(g,'start',{game:g.game,rounds:2},host);assert.ok(g.prompts.every(p=>!previous.includes(p)));
  assert.equal(view(g,host).seenPrompts,undefined);
 }
});
test('lobby preview discloses the mode without player identities or prompts',()=>{
 const g=create('ABC234','Private Host',host,{gameMode:'adults',adultsConfirmed:true});
 const preview=lobbyPreview(g);
 assert.equal(preview.gameMode,'adults');assert.equal(preview.playerCount,1);assert.equal(preview.promptCount,250);
 for(const field of ['host','players','prompts','seenPrompts','votes','secret'])assert.equal(preview[field],undefined);
 delete g.gameMode;assert.equal(lobbyPreview(g).gameMode,'family');assert.equal(view(g,host).gameMode,'family');
});
async function request(body,token=host){let status=200,data;await handler({method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body},{setHeader(){},set statusCode(v){status=v;},end(v){data=JSON.parse(v);}});return {status,...data};}
test('API enforces mode and consent, and supports pre-join previews',async()=>{
 process.env.LOCAL_MEMORY='1';
 assert.equal((await request({action:'create',name:'Host',gameMode:'adults'})).status,400);
 assert.equal((await request({action:'create',name:'Host',gameMode:'not-a-mode'})).status,400);
 const g=await request({action:'create',name:'Host',gameMode:'adults',adultsConfirmed:true});assert.equal(g.status,200);
 const preview=await request({action:'lobby',code:g.code},guest);assert.equal(preview.status,200);assert.equal(preview.gameMode,'adults');assert.equal(preview.players,undefined);
 assert.equal((await request({action:'join',code:g.code,name:'Guest'},guest)).status,400);
 assert.equal((await request({action:'join',code:g.code,name:'Guest',adultsConfirmed:true},guest)).status,200);
 const started=await request({action:'start',code:g.code,game:g.game,rounds:1});assert.ok(PROMPT_POOLS.adults.includes(started.prompt));
});
