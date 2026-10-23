import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGeminiObject, GeminiProviderError} from '../src/lib/ai/gemini.ts';

test('provider failures distinguish invalid requests, credentials, models and quotas without exposing upstream data',async()=>{
 const previous=process.env.GEMINI_API_KEY;const key='gemini-diagnostics-secret-canary';process.env.GEMINI_API_KEY=key;
 try{
  for(const[status,providerStatus,code]of [[400,'INVALID_ARGUMENT','ai_request'],[401,'UNAUTHENTICATED','ai_credentials'],[403,'PERMISSION_DENIED','ai_credentials'],[404,'NOT_FOUND','ai_model'],[429,'RESOURCE_EXHAUSTED','ai_unavailable'],[500,'INTERNAL','ai_unavailable']]){
   await assert.rejects(generateGeminiObject({instruction:'Extract',input:{text:'private-prompt-canary'},schema:{type:'object'},signal:new AbortController().signal,
    fetcher:async()=>Response.json({error:{status:providerStatus,message:`private-provider-canary ${key}`}}, {status})}),error=>{
     assert(error instanceof GeminiProviderError);assert.equal(error.code,code);assert.equal(error.upstreamStatus,status);assert.equal(error.upstreamCode,providerStatus);assert.equal(error.status,status===429?429:502);
     assert(!JSON.stringify(error).includes(key));assert(!error.message.includes('private-provider-canary'));assert(!error.message.includes('private-prompt-canary'));return true;
    });
  }
 }finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});

async function withKey(work) {
 const previous=process.env.GEMINI_API_KEY;
 process.env.GEMINI_API_KEY='retry-test-secret-canary';
 try {await work();}
 finally {if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
}
const input={instruction:'Extract a fictional event',input:{text:'Fictional test'},schema:{type:'object'}};
const success=()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"ready":true}'}]}}]});

test('opt-in retries recover from temporary provider failures using the same request and deadline',async()=>withKey(async()=>{
 const calls=[];
 const result=await generateGeminiObject({...input,retries:2,signal:new AbortController().signal,
  fetcher:async(url,init)=>{
   calls.push({url,body:init.body,signal:init.signal});
   return calls.length<3?Response.json({error:{status:calls.length===1?'INTERNAL':'UNAVAILABLE'}},{status:calls.length===1?500:503}):success();
  }});
 assert.deepEqual(result,{ready:true});assert.equal(calls.length,3);
 for(const call of calls){assert.equal(call.body,calls[0].body);assert.equal(call.url,calls[0].url);assert.equal(call.signal,calls[0].signal);}
}));

test('exhausted retries preserve safe provider diagnostics and stop after three attempts',async()=>withKey(async()=>{
 let calls=0;
 await assert.rejects(generateGeminiObject({...input,retries:2,signal:new AbortController().signal,
  fetcher:async()=>{calls++;return Response.json({error:{status:'UNAVAILABLE',message:'private-provider-canary retry-test-secret-canary'}},{status:503});}}),error=>{
   assert(error instanceof GeminiProviderError);assert.equal(error.upstreamStatus,503);assert.equal(error.upstreamCode,'UNAVAILABLE');
   assert.match(error.message,/temporairement indisponible/);assert(!JSON.stringify(error).includes('secret-canary'));assert(!error.message.includes('private-provider-canary'));return true;
  });
 assert.equal(calls,3);
}));

test('retries skip permanent errors, invalid outputs and Retry-After beyond the deadline',async()=>withKey(async()=>{
 for(const status of [400,401,403,404,429,503]){
  let calls=0;
  const headers=[429,503].includes(status)?{'Retry-After':'120'}:{};
  await assert.rejects(generateGeminiObject({...input,retries:2,signal:new AbortController().signal,
   fetcher:async()=>{calls++;return Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status,headers});}}),error=>error instanceof GeminiProviderError&&error.upstreamStatus===status);
  assert.equal(calls,1);
 }
 for(const response of [Response.json({candidates:[{finishReason:'MAX_TOKENS'}]}),Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'invalid JSON'}]}}]})]){
  let calls=0;
  await assert.rejects(generateGeminiObject({...input,retries:2,signal:new AbortController().signal,fetcher:async()=>{calls++;return response;}}),error=>error.code==='ai_output');
  assert.equal(calls,1);
 }
}));

test('a temporary network failure can recover without exposing fetch errors',async()=>withKey(async()=>{
 let calls=0;
 const result=await generateGeminiObject({...input,retries:2,signal:new AbortController().signal,
  fetcher:async()=>{if(++calls===1)throw new TypeError('private-network-error');return success();}});
 assert.deepEqual(result,{ready:true});assert.equal(calls,2);
}));

test('cancelling during backoff stops the request before another provider attempt',async()=>withKey(async()=>{
 const controller=new AbortController();let calls=0;
 let timer;
 try {
  await assert.rejects(generateGeminiObject({...input,retries:2,signal:controller.signal,
   fetcher:async()=>{calls++;timer=setTimeout(()=>controller.abort(),20);return new Response('',{status:503});}}),error=>error.code==='cancelled'&&error.status===499);
  assert.equal(calls,1);
 } finally {clearTimeout(timer);}
}));

test('the total timeout includes backoff and all provider attempts',async()=>withKey(async()=>{
 let calls=0;
 await assert.rejects(generateGeminiObject({...input,retries:2,timeout:1500,signal:new AbortController().signal,
  fetcher:async(url,init)=>{
   if(++calls===1)return new Response('',{status:503});
   return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  }}),error=>error.code==='timeout'&&error.status===504);
 assert.equal(calls,2);
}));
