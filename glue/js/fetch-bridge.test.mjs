import test from 'node:test';
import assert from 'node:assert/strict';
import {FetchBridge} from './fetch-bridge.mjs';
const encode = request => new TextEncoder().encode(JSON.stringify(request)+'\n');
function adapter(fetchImpl) {
  const bridge=Object.create(FetchBridge.prototype); let completion;
  Object.assign(bridge,{fetchImpl,timeoutMs:100,push:(wire,eof)=>{completion={wire,eof};}});
  return {bridge,completion:()=>completion};
}
test('invalid protocol, credentials, method and fields never invoke fetch', async()=>{
  let calls=0;const {bridge}=adapter(()=>{calls++;throw Error('unexpected fetch');});
  for(const r of [{method:'GET',url:'file:///secret'},{method:'GET',url:'https://user:pass@example.com/'},{method:'CONNECT',url:'https://example.com/'},{method:'GET',url:'https://example.com/',proxy:'ignored'}]) await assert.rejects(bridge.request(encode(r)));
  await assert.rejects(bridge.request(new Uint8Array(8193)));
  assert.equal(calls,0);
});
test('exact binary body and HTTP error status, no credential or redirect expansion',async()=>{
  const {bridge,completion}=adapter(async(url,options)=>{
    assert.equal(url,'https://example.com/');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    return new Response(new Uint8Array([0,255,10]),{status:503});
  });
  const r=await bridge.request(encode({method:'GET',url:'https://example.com/'}));
  assert.equal(r.status,503);assert.equal(r.bodyBytes,3);
  assert.deepEqual(r.wire,new Uint8Array([...new TextEncoder().encode('{"status":503,"bodyBytes":3}\n'),0,255,10]));
  assert.equal(completion().eof,true);
});
test('oversize streamed response cancels reader and publishes no completion',async()=>{
  let canceled=false;
  const {bridge,completion}=adapter(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(32769));},cancel(){canceled=true;}})));
  await assert.rejects(bridge.request(encode({method:'GET',url:'https://example.com/'})),/exceeds/);
  assert.equal(canceled,true);assert.equal(completion(),undefined);
});
test('cancellation publishes no completion',async()=>{
  const controller=new AbortController();controller.abort();
  const {bridge,completion}=adapter(async(_,options)=>{options.signal.throwIfAborted();});
  await assert.rejects(bridge.request(encode({method:'GET',url:'https://example.com/'}),{signal:controller.signal}));
  assert.equal(completion(),undefined);
});
test('JSON contentType admission rejects invalid types and methods before fetch',async()=>{
  let calls=0;const {bridge}=adapter(()=>{calls++;throw Error('unexpected fetch');});
  for(const r of [
    {method:'GET',contentType:'application/json'},
    {method:'POST',contentType:'application/json'},
    {method:'POST',body:'{}',contentType:'application/json\r\nAuthorization: secret'},
    {method:'POST',body:'{}',contentType:{}},
    {method:'POST',body:'{}',headers:{Authorization:'secret'}},
  ])await assert.rejects(bridge.request(encode({url:'https://example.com/',...r})));
  assert.equal(calls,0);
});
test('explicit JSON POST preserves UTF-8 body and fixed credential/redirect policy',async()=>{
  const body=JSON.stringify({prompt:'测试 π',value:97});
  const {bridge}=adapter(async(_,options)=>{
    assert.equal(options.method,'POST');assert.equal(options.body,body);
    assert.deepEqual(options.headers,{'Content-Type':'application/json'});
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    return new Response('JSON:97\n');
  });
  assert.equal((await bridge.request(encode({method:'POST',url:'https://example.com/',body,contentType:'application/json'}))).bodyBytes,8);
});
test('stream awaits each bounded sink without aggregating body or automatic EOF',async()=>{
  const {bridge,completion}=adapter(async()=>new Response(new Uint8Array(100000)));
  let count=0,pending=false;
  const r=await bridge.stream(encode({method:'GET',url:'https://example.com/'}),{chunkBytes:16384,onChunk:async chunk=>{
    assert.equal(pending,false);pending=true;assert(chunk.length<=16384);
    await Promise.resolve();count+=chunk.length;pending=false;
  }});
  assert.equal(count,100000);assert.equal(r.bodyBytes,100000);assert.equal(completion(),undefined);
});
test('stream quota and sink failure cancel reader, no success/EOF publication',async()=>{
  for(const quota of [true,false]){
    let canceled=false;
    const {bridge,completion}=adapter(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(20000));},cancel(){canceled=true;}})));
    await assert.rejects(bridge.stream(encode({method:'GET',url:'https://example.com/'}),{maxBodyBytes:quota?100:Infinity,onChunk:()=>{throw Error('sink refused');}}),quota?/quota/:/sink refused/);
    assert(canceled);assert.equal(completion(),undefined);
  }
});
test('byte-reader caps actual read result, non-byte streams fall back explicitly',async()=>{
  for(const byteStream of [true,false]){
    const body=new ReadableStream({...byteStream?{type:'bytes'}:{},start(c){c.enqueue(new Uint8Array(100000));c.close();}});
    const {bridge}=adapter(async()=>new Response(body));let total=0;
    const r=await bridge.stream(encode({method:'GET',url:'https://example.com/'}),{onChunk:c=>{total+=c.length;}});
    assert.equal(total,100000);assert.equal(r.readerMode,byteStream?'byob':'default');
    if(byteStream)assert(r.peakReaderChunk<=16384);else assert.equal(r.peakReaderChunk,100000);
  }
});
test('strict unsupported BYOB cancels body instead of leaking response',async()=>{
  let canceled=false;
  const {bridge}=adapter(async()=>new Response(new ReadableStream({cancel(){canceled=true;}})));
  await assert.rejects(bridge.stream(encode({method:'GET',url:'https://example.com/'}),{readerMode:'byob',onChunk:()=>{}}),TypeError);
  assert(canceled);
});
