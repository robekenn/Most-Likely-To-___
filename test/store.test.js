import {test} from 'node:test';
import assert from 'node:assert/strict';
import {get} from '../lib/store.js';
const envKeys=['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN','KV_REST_API_READ_ONLY_TOKEN','LOCAL_MEMORY','VERCEL'];
function configure(t,values){
 const previous=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 for(const k of envKeys)delete process.env[k];
 Object.assign(process.env,{VERCEL:'1'},values);
 t.after(()=>{for(const k of envKeys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}});
}
function response(t,url,token){
 let calls=0;
 t.mock.method(globalThis,'fetch',async(actual,options)=>{
  calls++;assert.equal(actual,url);assert.equal(options.headers.Authorization,`Bearer ${token}`);
  assert.deepEqual(JSON.parse(options.body),['GET','ml:room:ABC234']);
  return {ok:true,json:async()=>({result:JSON.stringify({code:'ABC234',expires:Date.now()+60000})})};
 });
 return ()=>calls;
}
test('production uses the read/write Marketplace pair',async t=>{
 configure(t,{KV_REST_API_URL:'https://marketplace.example',KV_REST_API_TOKEN:'test-write',KV_REST_API_READ_ONLY_TOKEN:'test-read'});
 const calls=response(t,'https://marketplace.example','test-write');
 assert.equal((await get('ABC234')).code,'ABC234');assert.equal(calls(),1);
});
test('complete direct Upstash credentials take precedence',async t=>{
 configure(t,{UPSTASH_REDIS_REST_URL:'https://direct.example',UPSTASH_REDIS_REST_TOKEN:'direct-test',KV_REST_API_URL:'https://marketplace.example',KV_REST_API_TOKEN:'marketplace-test'});
 response(t,'https://direct.example','direct-test');await get('ABC234');
});
test('partial direct configuration does not mix database credentials',async t=>{
 configure(t,{UPSTASH_REDIS_REST_URL:'https://direct.example',KV_REST_API_URL:'https://marketplace.example',KV_REST_API_TOKEN:'marketplace-test'});
 response(t,'https://marketplace.example','marketplace-test');await get('ABC234');
});
test('a read-only token cannot enable the game',async t=>{
 configure(t,{KV_REST_API_URL:'https://marketplace.example',KV_REST_API_READ_ONLY_TOKEN:'read-test'});
 const mocked=t.mock.method(globalThis,'fetch',()=>{throw Error('Must not call Redis without write credentials');});
 await assert.rejects(()=>get('ABC234'),/configure Redis/);assert.equal(mocked.mock.callCount(),0);
});
