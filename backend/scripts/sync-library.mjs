import { moodleSync } from '../src/lib/library/sync.ts';
import { libraryStore } from '../src/lib/library/store.ts';
import { moodleUsers } from '../src/lib/library/model.ts';

const username=process.argv[2] || moodleUsers()[0];
if(!username){console.error('Configure MOODLE_MCP_URL et MOODLE_ALLOWED_USERS dans backend/.env.');process.exitCode=1;}
else{
  await moodleSync.start(username,true);
  const timer=setInterval(async()=>{const {sync}=await libraryStore.snapshot(username);console.log(`${sync.saved} / ${sync.total} fichiers enregistrés (${sync.status})`);},15000);
  try{await moodleSync.wait(username);const {sync}=await libraryStore.snapshot(username);console.log(sync.message);if(sync.status==='error'||sync.status==='warning')process.exitCode=1;}
  finally{clearInterval(timer);}
  // The MCP SDK/HTTP pool can leave transport housekeeping handles alive after
  // all sessions close. This one-shot command has completed every storage write.
  process.exit(process.exitCode || 0);
}
