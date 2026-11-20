import {spawn} from 'node:child_process';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const backend=spawn(process.execPath,['--import','tsx',path.join(root,'src/server/node-entry.ts')],{cwd:root,stdio:'inherit',env:process.env});
const vite=await createServer({configFile:path.join(root,'vite.config.ts'),server:{host:'0.0.0.0',port:5173,strictPort:true}});
await vite.listen();vite.printUrls();
function stop(){void vite.close();backend.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
backend.on('exit',(code)=>{if(code!==0){console.error(`API process exited with ${code}`);void vite.close();process.exitCode=code||1;}});
