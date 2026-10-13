import test from 'node:test';
import assert from 'node:assert/strict';
import {generateOpenAIObject, OpenAIProviderError, openaiModel} from '../src/lib/ai/openai.ts';

const key = 'openai-test-secret-canary';
async function withKey(work) {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = key;
  try {await work();}
  finally {if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;}
}
const input = {instruction:'Extract a fictional event', input:{text:'Private event'}, schema:{type:'object', properties:{ready:{type:'boolean'}}, required:['ready'], additionalProperties:false}, signal:new AbortController().signal};
const message = text => ({type:'message', role:'assistant', status:'completed', content:[{type:'output_text', text}]});
const success = () => Response.json({status:'completed', output:[{type:'reasoning', summary:[]}, message('{"ready":true}')]});

test('Responses requests use the exact default model, server-side bearer key and strict schema', async () => withKey(async () => {
  const previous = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = '  ';
  try {
    assert.equal(openaiModel(), 'gpt-6.1-sol');
    const result = await generateOpenAIObject({...input, fetcher:async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${key}`);
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'gpt-6.1-sol'); assert.equal(body.instructions, input.instruction);
      assert.deepEqual(body.input, [{role:'user', content:JSON.stringify(input.input)}]);
      assert.deepEqual(body.text.format, {type:'json_schema', name:'calendar_event', strict:true, schema:input.schema});
      assert.deepEqual(body.reasoning, {effort:'low'});
      assert.equal(body.store, false); assert(body.max_output_tokens >= 2000);
      assert.equal(body.temperature, undefined); assert(!init.body.includes(key));
      return success();
    }});
    assert.deepEqual(result, {ready:true});
    process.env.OPENAI_MODEL = ' custom-model ';
    assert.equal(openaiModel(), 'gpt-6.1-sol');
    await generateOpenAIObject({...input, fetcher:async (_url, init) => {assert.equal(JSON.parse(init.body).model, 'gpt-6.1-sol'); return success();}});
  } finally {if (previous === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = previous;}
}));

test('provider failures distinguish request, credentials, model and quota errors without exposing private data', async () => withKey(async () => {
  for (const [status, upstreamCode, code] of [[400,'invalid_request_error','ai_request'], [401,'invalid_api_key','ai_credentials'], [403,'permission_denied','ai_credentials'], [404,'model_not_found','ai_model'], [429,'rate_limit_exceeded','ai_unavailable'], [500,'server_error','ai_unavailable'], [502,key,'ai_unavailable']]) {
    await assert.rejects(generateOpenAIObject({...input, fetcher:async () => Response.json({error:{code:upstreamCode, message:`private-provider-canary ${key}`}}, {status})}), error => {
      assert(error instanceof OpenAIProviderError); assert.equal(error.code, code); assert.equal(error.upstreamStatus, status);
      assert.equal(error.upstreamCode, upstreamCode === key ? 'UNKNOWN' : upstreamCode);
      assert.equal(error.status, status === 429 ? 429 : 502);
      assert(!JSON.stringify(error).includes(key)); assert(!error.message.includes('private-provider-canary'));
      return true;
    });
  }
}));

test('document scans send a base64 PDF and allow a bounded response larger than text event drafts', async () => withKey(async () => {
  const pdf = new Uint8Array(Buffer.from('%PDF-1.7\nfixture'));
  const result = {summary:'x'.repeat(40000)};
  const options = {...input, pdf, filename:'cours.pdf', schemaName:'calendar_document', maxOutputTokens:24000, maxResponseBytes:768 * 1024};
  assert.deepEqual(await generateOpenAIObject({...options, fetcher:async (_url, init) => {
    const body = JSON.parse(init.body), content = body.input[0].content;
    assert.equal(body.model, 'gpt-6.1-sol'); assert.equal(body.max_output_tokens, 24000);
    assert.equal(body.text.format.name, 'calendar_document'); assert.equal(body.store, false);
    assert.deepEqual(content[0], {type:'input_text', text:JSON.stringify(input.input)});
    assert.equal(content[1].filename, 'cours.pdf'); assert.equal(content[1].type, 'input_file');
    assert.deepEqual(Buffer.from(content[1].file_data.split(',')[1], 'base64'), Buffer.from(pdf));
    return Response.json({status:'completed', output:[message(JSON.stringify(result))]});
  }}), result);
  await assert.rejects(generateOpenAIObject({...options, maxResponseBytes:1024, fetcher:async () => Response.json({status:'completed', output:[message(JSON.stringify(result))]})}), error => error.code === 'ai_output');
}));

test('refusals, truncation, invalid JSON and leaked credentials never produce an event draft', async () => withKey(async () => {
  const answers = [
    {status:'incomplete', incomplete_details:{reason:'max_output_tokens'}, output:[message('{"ready":true}')]},
    {status:'failed', error:{message:key}, output:[]},
    {status:'completed', output:[{...message(''), content:[{type:'refusal', refusal:key}]}]},
    {status:'completed', output:[{...message('{"ready":true}'), status:'incomplete'}]},
    {status:'completed', output:[message('invalid JSON')]},
    {status:'completed', output:[message(JSON.stringify({secret:key}))]},
    {status:'completed', output:[]},
  ];
  for (const answer of answers) {
    let calls = 0;
    await assert.rejects(generateOpenAIObject({...input, retries:2, fetcher:async () => {calls++; return Response.json(answer);}}), error => error.code === 'ai_output' && !error.message.includes(key));
    assert.equal(calls, 1);
  }
}));

test('temporary failures retry with the same body and permanent failures and long Retry-After stop immediately', async () => withKey(async () => {
  const calls = [];
  assert.deepEqual(await generateOpenAIObject({...input, retries:2, fetcher:async (_url, init) => {
    calls.push(init);
    return calls.length === 1 ? Response.json({error:{type:'server_error'}}, {status:503}) : success();
  }}), {ready:true});
  assert.equal(calls.length, 2); assert.equal(calls[0].body, calls[1].body); assert.equal(calls[0].signal, calls[1].signal);
  for (const status of [400,401,403,404,429,503]) {
    let attempts = 0;
    await assert.rejects(generateOpenAIObject({...input, retries:2, fetcher:async () => {
      attempts++;
      return Response.json({error:{code:'invalid_request_error'}}, {status, headers:{'Retry-After':'120'}});
    }}), error => error instanceof OpenAIProviderError && error.upstreamStatus === status);
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  await assert.rejects(generateOpenAIObject({...input, retries:2, fetcher:async () => {
    attempts++; return Response.json({error:{code:'insufficient_quota'}}, {status:429});
  }}), error => error.upstreamCode === 'insufficient_quota');
  assert.equal(attempts, 1);
}));

test('cancelling during backoff and the total timeout stop all retries', async () => withKey(async () => {
  const controller = new AbortController(); let calls = 0, timer;
  try {
    await assert.rejects(generateOpenAIObject({...input, retries:2, signal:controller.signal, fetcher:async () => {
      calls++; timer = setTimeout(() => controller.abort(), 20); return new Response('', {status:503});
    }}), error => error.code === 'cancelled' && error.status === 499);
    assert.equal(calls, 1);
  } finally {clearTimeout(timer);}
  await assert.rejects(generateOpenAIObject({...input, timeout:20, fetcher:async (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), {once:true});
  })}), error => error.code === 'timeout' && error.status === 504);
}));
