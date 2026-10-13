// Opt-in live Tempo check. Uses the production extractor without MongoDB writes.
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {samplePdf} from './lib/calendar-pdf-fixture.mjs';
import {analyseCalendarPdf} from '../src/lib/calendar/pdf-analysis.ts';
import {OpenAIProviderError, openaiApiKey} from '../src/lib/ai/openai.ts';

const args=process.argv.slice(2);
if(args.includes('--help')) {
 console.log('Usage : npm run test:pdf -- ["/chemin/document.pdf"]\nSans fichier : PDF de test avec un examen le 20 octobre 2026, de 9 h à 11 h.\nEnvoie le PDF au service d’analyse configuré. Ne crée aucun document ni événement dans MongoDB.\nConfigure OPENAI_API_KEY dans backend/.env ou dans l’environnement.');
} else {
 try {
  if(args.length>1)throw new Error('Indique un seul PDF, entre guillemets si son chemin contient des espaces.');
  if(!openaiApiKey())throw new Error('Ajoute OPENAI_API_KEY dans backend/.env (fichier privé ignoré par Git), puis relance npm run test:pdf.');
  const path=args[0],name=path?basename(path):'calendrier-test.pdf';
  const pdf=path?await readFile(path):samplePdf();
  console.log(`Test réel du scan Tempo · ${name} · ${Math.ceil(pdf.length/1024)} Ko`);
  const start=Date.now();
  const result=await analyseCalendarPdf({name,pdf,signal:AbortSignal.timeout(100000)});
  if(!path&&!result.proposals.some(proposal=>proposal.event.date==='2026-10-20'&&proposal.event.startTime==='09:00'&&proposal.event.endTime==='11:00'))throw new Error('L’analyse n’a pas reconnu l’examen attendu dans le PDF de test.');
  console.log(JSON.stringify({result:'ok',elapsedSeconds:Math.round((Date.now()-start)/1000),summary:result.summary,events:result.proposals.map(({event,page,note})=>({event,page,note}))},null,2));
 } catch(error) {
  console.error(error instanceof Error?error.message:'Le test a échoué.');
  if(error instanceof OpenAIProviderError)console.error(JSON.stringify({httpStatus:error.upstreamStatus,providerStatus:error.upstreamCode}));
  process.exitCode=1;
 }
}
