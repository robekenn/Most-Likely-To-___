import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prompts} from '../lib/prompts.js';
import {drawPrompts} from '../lib/prompt-deck.js';
import {create,mutate,view} from '../lib/game.js';

test('the family prompt pool has 250 unique, nonempty questions',()=>{
 assert.equal(prompts.length,250);
 assert.equal(new Set(prompts.map(p=>p.toLowerCase().replace(/[^a-z0-9]/g,''))).size,prompts.length);
 assert.ok(prompts.every(p=>typeof p==='string'&&p.trim()===p&&p.length>15));
});
test('every question appears once before the pool refills',()=>{
 let history=[];const played=new Set();
 for(let game=0;game<25;game++){
  const deck=drawPrompts(10,history);
  for(const prompt of deck.picked){assert.ok(!played.has(prompt));played.add(prompt);}
  history=deck.history;
 }
 assert.equal(played.size,250);
 const refilled=drawPrompts(15,history);
 assert.equal(refilled.picked.length,15);
 assert.equal(new Set(refilled.picked).size,15);
 assert.equal(refilled.history.length,15);
});
test('refilling in the middle of a game uses unseen questions first without duplicates',()=>{
 const history=prompts.slice(0,-2);
 const deck=drawPrompts(15,history);
 assert.equal(deck.picked.length,15);
 assert.deepEqual(new Set(deck.picked.slice(0,2)),new Set(prompts.slice(-2)));
 assert.equal(new Set(deck.picked).size,15);
 const next=drawPrompts(15,deck.history);
 assert.ok(next.picked.every(p=>!deck.picked.includes(p)));
});
test('unknown and duplicated history entries do not block new questions',()=>{
 const deck=drawPrompts(15,['removed question',prompts[0],prompts[0]]);
 assert.ok(!deck.picked.includes(prompts[0]));
 assert.equal(deck.history.length,16);
 assert.ok(!deck.history.includes('removed question'));
});
test('replay preserves history privately and old lobbies migrate safely',()=>{
 const host='1'.repeat(64),guest='2'.repeat(64);
 const g=create('ABC234','Host',host);
 mutate(g,'join',{name:'Guest'},guest);
 mutate(g,'start',{game:g.game,rounds:2},host);
 const first=[...g.prompts];
 mutate(g,'skip',{game:g.game,round:0},host);
 mutate(g,'skip',{game:g.game,round:1},host);
 // Simulate an in-progress lobby created before prompt history existed.
 delete g.seenPrompts;
 mutate(g,'reset',{game:g.game},host);
 assert.deepEqual(g.seenPrompts,first);
 mutate(g,'start',{game:g.game,rounds:2},host);
 assert.ok(g.prompts.every(p=>!first.includes(p)));
 assert.equal(g.seenPrompts.length,4);
 assert.equal(view(g,guest).seenPrompts,undefined);
});
