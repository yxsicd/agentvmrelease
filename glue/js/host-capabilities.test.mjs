import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentVmWasmHost} from './host.mjs';

function mock(create) {
  const host = Object.create(AgentVmWasmHost.prototype);
  const uploads = [], released = [];
  host.exports = {agentvm_wasm_agent_session_create_with_capabilities:create};
  host.upload = bytes => { uploads.push(bytes); return {pointer:uploads.length,len:bytes.length}; };
  host.release = pointer => released.push(pointer);
  host.require = value => { if(!value)throw Error('Core rejected capabilities');return value; };
  return {host,uploads,released};
}
test('missing optional export fails before allocations, never falls back', () => {
  const {host,uploads}=mock(undefined);
  assert.throws(()=>host.createAgentSessionWithCapabilities(new Uint8Array(),['probe'],'process,workspace'),/not compiled/);
  assert.equal(uploads.length,0);
});
test('type and UTF-8 byte limit reject before allocation', () => {
  const {host,uploads}=mock(()=>1);
  assert.throws(()=>host.createAgentSessionWithCapabilities(new Uint8Array(),['probe'],{}),/must be a string/);
  assert.throws(()=>host.createAgentSessionWithCapabilities(new Uint8Array(),['probe'],'界'.repeat(342)),/1024 bytes/);
  assert.equal(uploads.length,0);
});
test('Core rejection releases every transfer buffer', () => {
  const {host,released}=mock(()=>0);
  assert.throws(()=>host.createAgentSessionWithCapabilities(new Uint8Array([1]),['probe'],'unknown'),/Core rejected/);
  assert.deepEqual(released,[3,2,1]);
});
test('explicit success passes exact capability bytes and releases buffers', () => {
  let args;
  const {host,uploads,released}=mock((...values)=>{args=values;return 41;});
  assert.equal(host.createAgentSessionWithCapabilities(new Uint8Array([1]),['probe'],'process,workspace',100),41);
  assert.equal(new TextDecoder().decode(uploads[2]),'process,workspace');
  assert.deepEqual(args,[1,1,2,uploads[1].length,3,17,100]);
  assert.deepEqual(released,[3,2,1]);
});
