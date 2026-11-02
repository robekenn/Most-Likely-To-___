import http from 'node:http';
import {readFile} from 'node:fs/promises';
import handler from './api/game.js';
if(!process.env.UPSTASH_REDIS_REST_URL&&!process.env.KV_REST_API_URL)process.env.LOCAL_MEMORY='1';
const port=Number(process.env.PORT||(process.argv.includes('--port')?process.argv[process.argv.indexOf('--port')+1]:null)||3000);
const allowed={'/':'index.html','/app.js':'app.js','/client-state.js':'client-state.js','/game-modes.js':'game-modes.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/api/game'){
 let body='';for await(const c of req){body+=c;if(body.length>4096){res.writeHead(413);res.end();return;}}
 try{req.body=JSON.parse(body);}catch{res.writeHead(400);res.end('{"error":"Invalid JSON."}');return;}
 return handler(req,res);
 }
 try{if(!allowed[path])throw Error();const file=allowed[path];const bytes=await readFile(new URL('./public/'+file,import.meta.url));res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(bytes);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'0.0.0.0',()=>console.log('Most Likely ready on port '+(port)));
