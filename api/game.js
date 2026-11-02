import {randomInt} from 'node:crypto';
import {create,mutate,view,GameError,hash} from '../lib/game.js';
import {get,save,rateLimit} from '../lib/store.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 try{
 if(req.method!=='POST')throw new GameError('Use POST.',405);
 if(!req.headers['content-type']?.startsWith('application/json'))throw new GameError('Use JSON.',415);
 let b=req.body;if(typeof b==='string')b=JSON.parse(b);
 if(!b||typeof b!=='object'||Array.isArray(b)||JSON.stringify(b).length>4096)throw new GameError('Invalid request.');
 const token=req.headers.authorization?.replace(/^Bearer /,'');
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new GameError('Invalid player session.',401);
 await rateLimit(hash(String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0]));
 if(b.action==='create'){
 for(let i=0;i<8;i++){const code=Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');const g=create(code,b.name,token);if(await save(g,null))return res.end(JSON.stringify(view(g,token)));}
 throw new GameError('Could not create a room. Try again.',503);
 }
 const code=String(b.code||'').toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))throw new GameError('Enter the six-character lobby code.');
 for(let i=0;i<30;i++){
 const g=await get(code);if(!g)throw new GameError('Lobby not found or expired. Ask your host for a new code.',404);
 if(b.action==='state')return res.end(JSON.stringify(view(g,token)));
 const previous=g.revision;mutate(g,b.action,b,token);g.revision++;
 if(await save(g,previous))return res.end(JSON.stringify(view(g,token)));
 }
 throw new GameError('The lobby is busy. Please try again.',409);
 }catch(e){res.statusCode=e instanceof GameError?e.status:500;res.end(JSON.stringify({error:e instanceof GameError?e.message:'Something went wrong. Please retry.'}));}
}
