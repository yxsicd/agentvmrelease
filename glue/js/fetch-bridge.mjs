// Optional browser/managed Host adapter; Core sees only two bounded stream FDs.
// v1 Guest request: one UTF-8 JSON line {method,url,body?,contentType?}; response: JSON
// metadata line {status,bodyBytes}, followed by exact body bytes and stream EOF.
// This is a preopened HTTP service, NOT a Linux socket/curl/TCP compatibility claim.
export class FetchBridge {
  constructor(host, handle, {fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 5000} = {}) {
    if (host.exports.agentvm_wasm_stream_bridge_version?.() !== 1) throw Error('Core lacks stream bridge v1');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('Invalid HTTP timeout');
    this.host = host; this.handle = handle; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs;
    host.require(host.exports.agentvm_wasm_session_stream_attach(handle, 4, 3), 'Stream attach failed');
  }
  take() {
    const pointer = this.host.exports.agentvm_wasm_alloc(8192);
    this.host.require(pointer, 'Stream buffer allocation failed');
    try {
      const len = this.host.exports.agentvm_wasm_session_stream_take(this.handle, pointer, 8192);
      if (len < 0) this.host.require(0, 'Stream take failed');
      return new Uint8Array(this.host.memory.buffer, pointer, len).slice();
    } finally { this.host.release(pointer); }
  }
  push(bytes, eof = false) {
    const uploaded = bytes.length ? this.host.upload(bytes) : {pointer: 0, len: 0};
    try { this.host.require(this.host.exports.agentvm_wasm_session_stream_push(this.handle, uploaded.pointer, uploaded.len, Number(eof)), 'Stream completion failed'); }
    finally { if (uploaded.pointer) this.host.release(uploaded.pointer); }
  }
  async openResponse(bytes, {signal} = {}) {
    if (!bytes.length || bytes.length > 8192) throw Error('HTTP request exceeds bound');
    const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    if (!text.endsWith('\n') || text.slice(0,-1).includes('\n')) throw Error('Expected one HTTP request line');
    const request = JSON.parse(text);
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(k => !['method','url','body','contentType'].includes(k))) throw Error('Invalid HTTP request fields');
    const url = new URL(request.url);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error('Unsupported HTTP URL');
    if (!['GET','HEAD','POST'].includes(request.method) || (request.body !== undefined && (request.method !== 'POST' || typeof request.body !== 'string'))) throw Error('Unsupported HTTP method/body');
    if (request.contentType !== undefined && (request.contentType !== 'application/json' || request.method !== 'POST' || typeof request.body !== 'string')) throw Error('Unsupported HTTP contentType');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    // Use ordinary browser networking and existing browser proxy policy.
    // No proxy config, ambient credentials, unrestricted redirects or socket tunnel.
    const response = await this.fetchImpl(url.href, {method:request.method, body:request.body, ...(request.contentType ? {headers:{'Content-Type':request.contentType}} : {}), credentials:'omit', redirect:'error', signal:combined});
    return {response,combined,requestUrl:url.href};
  }
  // Streaming consumers own framing, chunk admission/draining and final EOF.
  // Awaiting each sink completion supplies backpressure; no whole-body buffer.
  async stream(bytes, {signal,onResponse,onChunk,chunkBytes=16384,maxBodyBytes=Infinity,readerMode='auto'} = {}) {
    if(typeof onChunk!=='function'||!Number.isInteger(chunkBytes)||chunkBytes<1||chunkBytes>65536||!['auto','default','byob'].includes(readerMode)||!(maxBodyBytes===Infinity||Number.isSafeInteger(maxBodyBytes)&&maxBodyBytes>=0))throw Error('Invalid streaming policy');
    const {response,combined,requestUrl}=await this.openResponse(bytes,{signal});
    let reader,byob=false;
    let size=0,peakReaderChunk=0,chunks=0;
    try {
    if(response.body){
      if(readerMode!=='default'){
        try{reader=response.body.getReader({mode:'byob'});byob=true;}
        catch(e){if(readerMode==='byob'||!(e instanceof TypeError)||response.body.locked)throw e;}
      }
      if(!reader)reader=response.body.getReader();
    }
      if(onResponse)await onResponse({status:response.status,requestUrl});
      if(reader)while(true){
        combined.throwIfAborted();const {done,value}=await (byob?reader.read(new Uint8Array(chunkBytes)):reader.read());if(done)break;
        peakReaderChunk=Math.max(peakReaderChunk,value.length);
        for(let offset=0;offset<value.length;offset+=chunkBytes){
          combined.throwIfAborted();const part=value.subarray(offset,offset+chunkBytes);
          if(size+part.length>maxBodyBytes)throw Error('Streaming response exceeds Host quota');
          await onChunk(part);size+=part.length;chunks++;
        }
      }
      combined.throwIfAborted();
      return {status:response.status,bodyBytes:size,chunks,chunkBytes,peakReaderChunk,readerMode:byob?'byob':'default',requestUrl};
    }catch(e){if(reader)await reader.cancel().catch(()=>{});else if(response.body&&!response.body.locked)await response.body.cancel().catch(()=>{});throw e;}
    finally{reader?.releaseLock();}
  }
  async request(bytes, {signal} = {}) {
    const {response,combined,requestUrl}=await this.openResponse(bytes,{signal});
    const chunks = []; let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const {done,value} = await reader.read(); if (done) break;
          size += value.length; if (size > 32768) throw Error('HTTP response exceeds 32768 bytes');
          chunks.push(value);
        }
      } catch (e) { await reader.cancel().catch(()=>{}); throw e; }
      finally { reader.releaseLock(); }
    }
    const header = new TextEncoder().encode(JSON.stringify({status:response.status,bodyBytes:size})+'\n');
    const wire = new Uint8Array(header.length+size); wire.set(header);
    let offset = header.length; for (const chunk of chunks) {wire.set(chunk,offset);offset+=chunk.length;}
    combined.throwIfAborted();
    this.push(wire, true);
    return {status:response.status,bodyBytes:size,wire,requestUrl};
  }
}
