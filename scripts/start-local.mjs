import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,copyFile,mkdir,stat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ports=[['HomeLab',3000],['API',3001],['Tempo',4173],['Mémo',8000]];
const log=message=>process.stdout.write(`${message}\n`);
const exists=path=>access(path).then(()=>true,()=>false);

// Separate process groups let Ctrl+C also stop npm, reloaders and their children.
export class LocalProcesses {
  constructor(output=log,graceMs=4000) {
    this.output=output;this.graceMs=graceMs;this.records=[];this.stopping=false;
    this.failure=new Promise(resolve=>{this.failed=resolve;});
  }
  start(name,command,args,{cwd,env,persistent=false}={}) {
    const child=spawn(command,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
    const record={name,child};this.records.push(record);
    for(const stream of [child.stdout,child.stderr])if(stream)createInterface({input:stream}).on('line',line=>this.output(`[${name}] ${line}`));
    child.once('error',()=>{record.error=new Error(`Impossible de lancer ${name}. Vérifie que ses dépendances sont installées.`);if(persistent&&!this.stopping)this.failed(record.error);});
    record.closed=new Promise(resolve=>child.once('close',(code,signal)=>{
      if(persistent&&!this.stopping)this.failed(record.error||new Error(`${name} s’est arrêté (${signal||`code ${code}`}).`));
      if(!persistent) {
        // Retire finished preparation jobs immediately: their old process IDs
        // must never be targeted again after a long-running development session.
        if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{/* Group already exited. */}
        this.records=this.records.filter(previous=>previous!==record);
      }
      resolve({code,signal});
    }));
    return record;
  }
  async run(name,command,args,options,signal) {
    signal.throwIfAborted();
    const record=this.start(name,command,args,options);
    let abort;
    const cancelled=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
    try {
      const result=await Promise.race([record.closed,cancelled]);
      if(record.error)throw record.error;
      if(result.code!==0)throw new Error(`La préparation de ${name} a échoué (${result.signal||`code ${result.code}`}).`);
    }finally{signal.removeEventListener('abort',abort);}
  }
  stop() {
    this.stopPromise??=this.stopAll();return this.stopPromise;
  }
  async stopAll() {
    this.stopping=true;
    const records=[...this.records];
    const kill=(record,signal)=>{if(record.child.pid)try{process.kill(-record.child.pid,signal);}catch(error){if(error.code!=='ESRCH')this.output(`Impossible d’arrêter ${record.name}.`);}};
    const alive=record=>{if(!record.child.pid)return false;try{process.kill(-record.child.pid,0);return true;}catch{return false;}};
    for(const record of records)kill(record,'SIGTERM');
    const deadline=Date.now()+this.graceMs;
    while(records.some(alive)&&Date.now()<deadline)await delay(50);
    // A reloader can leave grandchildren alive after its own process exits.
    for(const record of records)if(alive(record))kill(record,'SIGKILL');
    await Promise.all(records.map(record=>record.closed));
  }
}

export function assertPortFree(name,port) {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once('error',error=>reject(new Error(error.code==='EADDRINUSE'?`Le port ${port} (${name}) est occupé. Arrête le service qui l’utilise, puis relance ./start-local.sh.`:`Impossible d’utiliser le port ${port} (${name}).`)));
    server.listen(port,'127.0.0.1',()=>server.close(resolve));
  });
}
async function envFile(path) {
  try{return parseEnv(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw new Error(`Impossible de lire ${path}.`);}
}
async function ensureNpm(manager,directory,name,signal) {
  const installed=resolve(directory,'node_modules/.package-lock.json');
  const lock=resolve(directory,'package-lock.json');
  const ready=await exists(installed)&& (await stat(installed)).mtimeMs>=(await stat(lock)).mtimeMs;
  if(!ready)await manager.run(`Installation ${name}`,'npm',['ci','--no-audit','--no-fund'],{cwd:directory},signal);
}
async function waitForServices(signal) {
  const checks=[['Mémo','http://127.0.0.1:8000/api/health'],['API','http://127.0.0.1:3001/api/health'],['Tempo','http://127.0.0.1:4173/healthz'],['HomeLab','http://127.0.0.1:3000/']];
  const pending=new Map(checks),deadline=Date.now()+120000;
  while(pending.size) {
    signal.throwIfAborted();
    await Promise.all([...pending].map(async([name,url])=>{
      try{const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(2000)]),redirect:'error'});await response.body?.cancel();if(response.ok)pending.delete(name);}catch{/* Server still starting. */}
    }));
    if(!pending.size)return;
    if(Date.now()>deadline)throw new Error(`Démarrage incomplet : ${[...pending.keys()].join(', ')}. Consulte les messages ci-dessus.`);
    await delay(400,null,{signal});
  }
}
async function main() {
  const args=process.argv.slice(2);
  if(args.includes('--help')){log('Usage : ./start-local.sh\nDémarre HomeLab, son API, Tempo et Mémo sur localhost.\nPrépare les dépendances et un compte dev au premier lancement. Ctrl+C arrête tout.\nConfiguration OpenAI/Gemini/MongoDB : backend/.env. Guide : docs/calendar-local.md.');return;}
  if(args.length)throw new Error('Option inconnue. Utilise ./start-local.sh --help.');
  if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Ce dépôt utilise Node.js 24. Active cette version, puis relance ./start-local.sh.');
  if(process.platform==='win32')throw new Error('Lance ce script dans WSL avec Node.js 24 et Python 3.');
  for(const[name,port]of ports)await assertPortFree(name,port);

  const manager=new LocalProcesses(),controller=new AbortController();
  const interrupted=()=>controller.abort(new Error('Arrêt demandé.'));
  process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
  let abort;
  const stopped=new Promise(resolve=>{abort=()=>resolve();controller.signal.addEventListener('abort',abort,{once:true});});
  const signal=controller.signal,memo=resolve(root,'apps/memo/web-app');
  try {
    log('Préparation de HomeLab local…');
    await manager.run('Prérequis Python','python3',['-c','import sys; assert sys.version_info >= (3, 10), "Python 3.10+ nécessaire"'],{cwd:root},signal);
    const settingsPath=resolve(root,'backend/.env');
    if(!await exists(settingsPath)){await copyFile(resolve(root,'backend/.env.example'),settingsPath,constants.COPYFILE_EXCL);log('Configuration créée : backend/.env.');}
    const settings={...await envFile(settingsPath),...process.env};
    const localDatabase=process.env.HOMELAB_LOCAL_MONGODB_DATABASE||'homelab_calendar_dev';
    const data=resolve(root,'.local-data/memo-calendar');await mkdir(data,{recursive:true,mode:0o700});
    const memoEnv={...settings,...await envFile(resolve(memo,'.env.memo-local')),...process.env,MEMO_ENV:'development',FLASHCARD_WEB_AUTH:'1',FLASHCARD_WEB_REQUIRE_HTTPS:'0',MEMO_COOKIE_PATH:'/',FLASHCARD_WEB_IMPORT_DESKTOP:'0',FLASHCARD_WEB_DATA:data,MEMO_MONGODB_DATABASE:process.env.HOMELAB_LOCAL_MEMO_DATABASE||'homelab_memo_dev',HOMELAB_LIBRARY_URL:'http://127.0.0.1:3001'};
    const backendEnv={...settings,NODE_ENV:'development',MEMO_AUTH_URL:'http://127.0.0.1:8000',MONGODB_DATABASE:localDatabase,MEDIA_ALLOWED_ORIGINS:'http://localhost:3000,http://127.0.0.1:3000'};
    if(!settings.MONGODB_URI?.trim())log('À configurer dans backend/.env : MONGODB_URI pour enregistrer les événements Tempo et les ensembles Mémo.');
    if(!settings.OPENAI_API_KEY?.trim())log('À configurer dans backend/.env : OPENAI_API_KEY pour créer les événements Tempo et scanner les documents.');
    log(`Base Tempo de développement : ${localDatabase}`);

    await manager.run('Prérequis npm','npm',['--version'],{cwd:root},signal);
    for(const[directory,name]of [[resolve(root,'frontend'),'HomeLab'],[resolve(root,'backend'),'API'],[resolve(root,'apps/calendar'),'Tempo'],[resolve(memo,'frontend'),'Mémo']])await ensureNpm(manager,directory,name,signal);
    const python=resolve(memo,'.venv/bin/python');
    if(!await exists(python))await manager.run('Environnement Python','python3',['-m','venv','.venv'],{cwd:memo},signal);
    const probe=manager.start('Dépendances Python',python,['-c','import fastapi, uvicorn, httpx, pwdlib, pymongo, curl_cffi, pypdf, defusedxml'],{cwd:memo});
    const result=await Promise.race([probe.closed,stopped]);signal.throwIfAborted();
    if(probe.error)throw probe.error;
    if(result.code!==0)await manager.run('Installation Python',python,['-m','pip','install','-r','backend/requirements.lock.txt'],{cwd:memo},signal);
    await manager.run('Aperçus PDF','npm',['run','prepare:pdf'],{cwd:resolve(root,'apps/calendar')},signal);
    await manager.run('Lecteur Bibliothèque','npm',['run','prepare:library'],{cwd:resolve(root,'frontend')},signal);
    await manager.run('Interface Mémo','npm',['run','build','--','--logLevel','warn'],{cwd:resolve(memo,'frontend')},signal);

    // Bootstrap only this local account directory. Keep its password out of logs.
    const accountCode=`import os\nfrom backend.auth import Accounts\na=Accounts(os.environ['FLASHCARD_WEB_DATA'])\nusers=a.list_public()\nif not users:\n import secrets\n password=secrets.token_urlsafe(18)\n user=a.create('dev','Développement',password)\n directory=a.directory/'bootstrap'\n directory.mkdir(mode=0o700,exist_ok=True)\n path=directory/(user['id']+'.txt')\n with open(path,'w',opener=lambda name,flags:os.open(name,flags,0o600)) as file:file.write(password+'\\n')\n print('Compte local dev créé. Mot de passe temporaire dans : '+str(path))\nelse:\n print('Comptes locaux disponibles : '+', '.join(user['username'] for user in users))\n for user in users:\n  saved=a.directory/'bootstrap'/(a.user(user['username'])['id']+'.txt')\n  if saved.exists():print('Mot de passe temporaire de '+user['username']+' dans : '+str(saved))`;
    await manager.run('Compte local',python,['-c',accountCode],{cwd:memo,env:memoEnv},signal);
    signal.throwIfAborted();

    manager.start('Mémo',python,['-m','uvicorn','backend.main:app','--reload','--host','127.0.0.1','--port','8000'],{cwd:memo,env:memoEnv,persistent:true});
    manager.start('API',process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3001'],{cwd:resolve(root,'backend'),env:backendEnv,persistent:true});
    manager.start('Tempo',process.execPath,['scripts/serve.mjs'],{cwd:resolve(root,'apps/calendar'),env:{...process.env,PORT:'4173',CALENDAR_HOST:'127.0.0.1'},persistent:true});
    manager.start('HomeLab',process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3000','--strictPort'],{cwd:resolve(root,'frontend'),env:{...process.env,NODE_ENV:'development'},persistent:true});
    const failure=manager.failure.then(error=>{throw error;});
    await Promise.race([waitForServices(signal),failure]);
    log('\nHomeLab est prêt : http://localhost:3000\nConnecte-toi avec ton compte local, puis ouvre Bibliothèque ou Tempo.\nCtrl+C pour arrêter les quatre services.\n');
    await Promise.race([stopped,failure]);
  } catch(error) {
    if(!signal.aborted)throw error;
  } finally {
    controller.abort();
    log('\nArrêt des services locaux…');await manager.stop();
    process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);controller.signal.removeEventListener('abort',abort);
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
