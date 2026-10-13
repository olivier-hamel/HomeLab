import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalProcesses,assertPortFree} from './start-local.mjs';

async function line(record) {
 let text='';
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Child startup timed out')),4000);
  record.child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timeout);resolve(text.split('\n')[0]);}});
 });
}
async function running(pid) {
 try{process.kill(pid,0);const stat=await readFile(`/proc/${pid}/stat`,'utf8').catch(()=>null);return !stat||stat.split(') ')[1][0]!=='Z';}catch{return false;}
}
test('occupied ports produce an actionable error without disturbing their existing server',async()=>{
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 try{await assert.rejects(assertPortFree('HomeLab',server.address().port),/occupé/);assert(server.listening);}finally{await new Promise(resolve=>server.close(resolve));}
});
test('a failed service is reported and all sibling processes are stopped',async()=>{
 const manager=new LocalProcesses(()=>{},250);
 try{
  const sibling=manager.start('sibling',process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{persistent:true});await line(sibling);
  manager.start('failed',process.execPath,['-e','process.exit(7)'],{persistent:true});
  const error=await manager.failure;assert.match(error.message,/failed.*code 7/);
  await manager.stop();assert.equal(await running(sibling.child.pid),false);
 }finally{await manager.stop();}
});
test('completed preparation jobs are retired before the long-running service session',async()=>{
 const manager=new LocalProcesses(()=>{},250);
 try{
  await manager.run('prepare',process.execPath,['-e','process.exit(0)'],{},new AbortController().signal);
  assert.equal(manager.records.length,0);
 }finally{await manager.stop();}
});
test('cleanup also kills a stubborn grandchild after its parent has already exited',async()=>{
 const manager=new LocalProcesses(()=>{},250);let grandchild;
 try{
  const source=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>console.log(child.pid));setInterval(()=>{},1000);`;
  const parent=manager.start('reloader',process.execPath,['-e',source],{persistent:true});grandchild=Number(await line(parent));assert(await running(grandchild));
  await manager.stop();
  for(let i=0;i<20&&await running(grandchild);i++)await delay(25);
  assert.equal(await running(parent.child.pid),false);assert.equal(await running(grandchild),false);
 }finally{await manager.stop();}
});
