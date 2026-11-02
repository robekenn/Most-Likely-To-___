import {randomUUID,createHash} from 'node:crypto';
import {drawPrompts} from './prompt-deck.js';
export class GameError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const requireThat=(condition,message,status)=>{if(!condition)throw new GameError(message,status);};
export const hash=t=>createHash('sha256').update(t).digest('hex');
export function player(name,token){
 requireThat(typeof name==='string' && name.trim().length>=1 && name.trim().length<=24,'Use a name with 1–24 characters.');
 requireThat(typeof token==='string' && /^[a-f0-9]{64}$/.test(token),'Invalid player session.',401);
 return {id:randomUUID(),name:name.trim(),secret:hash(token)};
}
export function create(code,name,token){const p=player(name,token);return {code,host:p.id,players:[p],phase:'lobby',round:0,rounds:1,game:randomUUID(),prompts:[],seenPrompts:[],votes:[],reveal:-1,revision:0,expires:Date.now()+86400000};}
export function member(g,token){const p=g.players.find(p=>p.secret===hash(token||''));requireThat(p,'Your session is not in this lobby.',401);return p;}
function advance(g){if(g.round+1===g.rounds)g.phase='results';else g.round++;}
export function mutate(g,action,b,token){
 if(action==='join'){
 const existing=g.players.find(p=>p.secret===hash(token||'')); if(existing)return;
 requireThat(g.phase==='lobby','This game has already started.');requireThat(g.players.length<15,'This lobby is full.');
 const p=player(b.name,token);requireThat(!g.players.some(x=>x.name.toLowerCase()===p.name.toLowerCase()),'That name is already taken.');g.players.push(p);return;
 }
 const p=member(g,token);
 if(action==='vote'){
 requireThat(g.phase==='voting' && b.game===g.game && b.round===g.round,'The round has changed. Please try again.',409);
 const votes=g.votes[g.round];
 if(votes[p.id]===b.target)return;
 requireThat(!votes[p.id],'Your vote is already locked in.');
 requireThat(g.players.some(x=>x.id===b.target),'Choose a player in this lobby.');
 requireThat(!g.votes.some(v=>v[p.id]===b.target),'You have already chosen this person.');
 votes[p.id]=b.target;if(Object.keys(votes).length===g.players.length)advance(g);return;
 }
 requireThat(p.id===g.host,'Only the host can do that.',403);
 requireThat(b.game===g.game,'The game has changed. Refresh and try again.',409);
 if(action==='start'){
 requireThat(g.phase==='lobby','The game has already started.');
 requireThat(g.players.length>=2,'Invite at least one friend first.');
 requireThat(Number.isInteger(b.rounds)&&b.rounds>=1&&b.rounds<=g.players.length,'Rounds must be between 1 and the number of players.');
 g.rounds=b.rounds;const deck=drawPrompts(g.rounds,g.seenPrompts||[]);
 g.prompts=deck.picked;g.seenPrompts=deck.history;g.votes=Array.from({length:g.rounds},()=>({}));g.phase='voting';return;
 }
 if(action==='skip'){requireThat(g.phase==='voting'&&b.round===g.round,'The round has changed.',409);advance(g);return;}
 if(action==='reveal'){requireThat(g.phase==='results'&&b.reveal===g.reveal,'The reveal has changed.',409);requireThat(g.reveal<g.rounds-1,'All results have been revealed.');g.reveal++;return;}
 if(action==='remove'){requireThat(g.phase==='lobby','Players can only be removed before starting.');requireThat(b.target!==g.host,'The host cannot be removed.');g.players=g.players.filter(x=>x.id!==b.target);return;}
 if(action==='reset'){requireThat(g.phase==='results','Finish this game first.');if(!g.seenPrompts)g.seenPrompts=[...g.prompts];Object.assign(g,{phase:'lobby',game:randomUUID(),round:0,rounds:1,prompts:[],votes:[],reveal:-1});return;}
 throw new GameError('Unknown action.');
}
export function view(g,token){const me=member(g,token);return {code:g.code,game:g.game,revision:g.revision,phase:g.phase,round:g.round,rounds:g.rounds,reveal:g.reveal,expires:g.expires,host:g.host,me:me.id,players:g.players.map(({id,name})=>({id,name})),prompt:g.phase==='voting'?g.prompts[g.round]:null,used:g.votes.map(v=>v[me.id]).filter(Boolean),voted:!!g.votes[g.round]?.[me.id],ready:g.phase==='voting'?Object.keys(g.votes[g.round]):[],results:g.phase==='results'?g.prompts.slice(0,g.reveal+1).map((prompt,i)=>{const counts=Object.values(g.votes[i]).reduce((a,id)=>(a[id]=(a[id]||0)+1,a),{});const max=Math.max(0,...Object.values(counts));return {prompt,counts,total:Object.values(counts).reduce((a,b)=>a+b,0),winners:g.players.filter(p=>counts[p.id]===max).map(p=>p.id)};}):[]};}
