import {randomInt} from 'node:crypto';
import {PROMPT_POOLS} from './prompt-pools.js';

function shuffle(items) {
 for(let i=items.length-1;i>0;i--){const j=randomInt(i+1);[items[i],items[j]]=[items[j],items[i]];}
 return items;
}

// History lives with the lobby, so every phone and replay shares the same deck.
// Store prompt text rather than array indexes to survive additions/reordering.
export function drawPrompts(count, history=[], gameMode='family') {
 const prompts=Object.hasOwn(PROMPT_POOLS,gameMode)?PROMPT_POOLS[gameMode]:null;
 if(!prompts)throw new Error('Unknown game mode.');
 const known=new Set(prompts);
 const seen=new Set(history.filter(prompt=>known.has(prompt)));
 const fresh=shuffle(prompts.filter(prompt=>!seen.has(prompt)));
 const picked=fresh.slice(0,count);
 if(picked.length<count){
  // Finish the old deck before refilling. Exclude this game's fresh picks so
  // even the game spanning the refill boundary never repeats a question.
  picked.push(...shuffle(prompts.filter(prompt=>!picked.includes(prompt))).slice(0,count-picked.length));
  return {picked,history:[...picked]};
 }
 return {picked,history:[...seen,...picked]};
}
