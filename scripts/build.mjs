import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['--check','public/app.js'],{stdio:'inherit'});
import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true}); await cp('public','dist',{recursive:true});
