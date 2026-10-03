import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';

test('CRLF-default checkout preserves manifest-bound public bytes', async () => {
  const root = resolve('.');
  await mkdir(join(root, 'release-input'), {recursive:true});
  const dir = await mkdtemp(join(root, 'release-input', 'checkout-identity-'));
  try {
    const prefix = dir.replaceAll('\\', '/') + '/';
    const r = spawnSync('git', ['-c','core.autocrlf=true','-c','core.eol=crlf',
      'checkout-index','-a','--prefix='+prefix], {cwd:root, encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    for (const channel of ['dev','main','prod']) {
      const m = JSON.parse(await readFile(join(dir,'channels',channel+'.json'),'utf8'));
      for (const id of [{...m.core,path:m.core.repository_path},m.distribution.host,m.distribution.fixture]) {
        const bytes = await readFile(join(dir,id.path));
        assert.equal(bytes.length,id.bytes,id.path);
        assert.equal(createHash('sha256').update(bytes).digest('hex'),id.sha256,id.path);
      }
    }
    const verify = spawnSync(process.execPath, ['scripts/verify-repository-distribution.mjs','--candidate-dev'],
      {cwd:dir,encoding:'utf8'});
    assert.equal(verify.status,0,verify.stderr);
    assert.equal(JSON.parse(verify.stdout).receipts.length,3);
  } finally {
    // Only the unique directory created by this test is removed.
    await rm(dir,{recursive:true});
  }
});
