import {GameError} from './game.js';
const memory=new Map();
async function redis(command){
 // Keep each URL/token pair together: never mix credentials from two databases.
 const direct=[process.env.UPSTASH_REDIS_REST_URL,process.env.UPSTASH_REDIS_REST_TOKEN];
 const marketplace=[process.env.KV_REST_API_URL,process.env.KV_REST_API_TOKEN];
 const [url,token]=direct.every(Boolean)?direct:marketplace;
 if(!url||!token)throw new GameError('The host needs to configure Redis before online play.',503);
 const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new GameError('Game storage is temporarily unavailable. Try again.',503);
 const data=await r.json();if(data.error)throw new GameError('Game storage is temporarily unavailable. Try again.',503);return data.result;
}
const local=()=>process.env.LOCAL_MEMORY==='1'&&!process.env.VERCEL;
export async function get(code){const raw=local()?memory.get(code):await redis(['GET','ml:room:'+code]);const g=raw?JSON.parse(raw):null;return g&&g.expires>Date.now()?g:null;}
export async function save(g,previous){
 const value=JSON.stringify(g);
 if(local()){const old=memory.get(g.code);if((previous===null&&old)||(previous!==null&&(!old||JSON.parse(old).revision!==previous)))return false;memory.set(g.code,value);return true;}
 if(previous===null)return (await redis(['SET','ml:room:'+g.code,value,'NX','EX',86400]))==='OK';
 return (await redis(['EVAL',"local s=redis.call('GET',KEYS[1]); if not s then return 0 end; if cjson.decode(s).revision ~= tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL'); return 1",1,'ml:room:'+g.code,previous,value]))===1;
}
export async function rateLimit(ip){
 if(local())return;
 const count=await redis(['EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,'ml:rate:'+ip]);
 if(count>1200)throw new GameError('Too many requests. Please wait a minute.',429);
}
