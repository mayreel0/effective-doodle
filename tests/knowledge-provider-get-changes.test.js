import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { KnowledgeProvider, KnowledgeStore } from '../src/index.js';
import { createGitRepository } from './helpers/git-fixture.js';

class GuardedStore extends KnowledgeStore {
  rejectReads = false;

  assertExternalToRepository(repositoryPath, projectId) {
    if (this.rejectReads) throw new Error('storage boundary rejected');
    return super.assertExternalToRepository(repositoryPath, projectId);
  }
}

// 한글: 저장 위치가 등록 후 부적절해지면 저장된 변경 내역과 명시 ref 조회를 모두 차단한다.
test('getChanges checks the storage boundary for cached and explicit-ref reads', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-get-changes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = createGitRepository(root);
  const store = new GuardedStore({ home: join(root, 'knowledge') });
  const provider = new KnowledgeProvider({ store });
  provider.register(repo, { id: 'sample' });
  provider.sync('sample');

  store.rejectReads = true;
  assert.throws(() => provider.getChanges('sample'), /storage boundary rejected/);
  assert.throws(() => provider.getChanges('sample', { since: 'HEAD' }), /storage boundary rejected/);
});
