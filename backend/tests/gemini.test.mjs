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
