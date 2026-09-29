import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { KnowledgeProvider, KnowledgeStore } from '../src/index.js';
import { createGitRepository } from './helpers/git-fixture.js';

// 한글: rebuild가 중단돼도 기존 스냅샷을 원자적 교체 전까지 유지한다.
test('rebuild retains existing snapshots until their atomic replacements are written', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-rebuild-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = createGitRepository(root);
  const home = join(root, 'knowledge');
  const filenames = ['current.json', 'changes.json', 'decisions.json'];

  class InterruptedStore extends KnowledgeStore {
    interruptChanges = false;
    snapshotsAtInterruption = null;

    writeProjectJson(projectId, filename, value) {
      if (filename === 'changes.json' && this.interruptChanges) {
        this.interruptChanges = false;
        this.snapshotsAtInterruption = filenames.map((name) =>
          existsSync(join(this.projectDirectory(projectId), name)));
        throw new Error('interrupted before changes replacement');
      }
      return super.writeProjectJson(projectId, filename, value);
    }
  }

  const store = new InterruptedStore({ home });
  const provider = new KnowledgeProvider({ store });
  provider.register(repo, { id: 'sample' });
  provider.sync('sample');
  store.interruptChanges = true;

  assert.throws(() => provider.sync('sample', { rebuild: true }), /interrupted before changes replacement/);
  assert.deepEqual(store.snapshotsAtInterruption, [true, true, true]);
});
