import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ChangeAnalyzer,
  GitAnalysisError,
  InvalidGitRefError,
} from '../src/changes/ChangeAnalyzer.js';
import { ProjectSync } from '../src/changes/ProjectSync.js';
import { ProjectRegistry } from '../src/projects/ProjectRegistry.js';
import { KnowledgeStore } from '../src/storage/KnowledgeStore.js';
import { createGitRepository, git } from './helpers/git-fixture.js';

function fixture(t, { Store = KnowledgeStore } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doodle-changes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = createGitRepository(root);
  const store = new Store({ home: join(root, 'doodle-home') });
  const registry = new ProjectRegistry({ store });
  registry.register(repo, { id: 'sample' });
  return {
    root,
    repo,
    store,
    registry,
    analyzer: new ChangeAnalyzer(),
    sync: new ProjectSync({ registry, store }),
  };
}

function commitAll(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

// 한글: 명시한 Git ref부터 HEAD까지 커밋과 파일 변경 통계를 분석한다.
test('analyzes commits and file statistics from an explicit Git ref', (t) => {
  const { repo, analyzer } = fixture(t);
  writeFileSync(join(repo, 'deleted.md'), 'remove me\n');
  commitAll(repo, 'add file for deletion');
  const base = git(repo, ['rev-parse', 'HEAD']);
  appendFileSync(join(repo, 'README.md'), 'second line\n');
  writeFileSync(join(repo, 'added.md'), 'one\ntwo\n');
  unlinkSync(join(repo, 'deleted.md'));
  const head = commitAll(repo, 'document the change');
  const sourceStatus = git(repo, ['status', '--porcelain']);

  const result = analyzer.analyze(repo, { since: base });

  assert.equal(result.base, base);
  assert.equal(result.head, head);
  assert.deepEqual(result.commits, [{ sha: head, message: 'document the change' }]);
  assert.deepEqual(result.files, [
    { path: 'README.md', status: 'modified', additions: 1, deletions: 0, binary: false },
    { path: 'added.md', status: 'added', additions: 2, deletions: 0, binary: false },
    { path: 'deleted.md', status: 'deleted', additions: 0, deletions: 1, binary: false },
  ]);
  assert.equal(git(repo, ['status', '--porcelain']), sourceStatus);
});

// 한글: Git의 상대 ref를 그대로 해석해 올바른 base와 HEAD를 반환한다.
test('resolves valid relative refs consistently with Git', (t) => {
  const { repo, analyzer } = fixture(t);
  writeFileSync(join(repo, 'one.md'), 'one\n');
  commitAll(repo, 'first follow-up');
  writeFileSync(join(repo, 'two.md'), 'two\n');
  commitAll(repo, 'second follow-up');

  const result = analyzer.analyze(repo, { since: 'HEAD~1' });

  assert.equal(result.base, git(repo, ['rev-parse', 'HEAD~1']));
  assert.equal(result.head, git(repo, ['rev-parse', 'HEAD']));
});

// 한글: 특수 문자가 있는 rename 경로와 binary 파일 통계를 안전하게 파싱한다.
test('safely parses renamed paths and binary files', (t) => {
  const { repo, analyzer } = fixture(t);
  const oldPath = 'old\tname.txt';
  const newPath = 'new\nname.txt';
  const binaryPath = 'asset\tdata.bin';
  writeFileSync(join(repo, oldPath), 'same content\n');
  writeFileSync(join(repo, binaryPath), Buffer.from([0, 1, 2, 3]));
  const base = commitAll(repo, 'add unusual files');
  renameSync(join(repo, oldPath), join(repo, newPath));
  writeFileSync(join(repo, binaryPath), Buffer.from([0, 4, 5, 6]));
  commitAll(repo, 'rename and update binary');

  const result = analyzer.analyze(repo, { since: base });

  assert.deepEqual(result.files, [
    { path: binaryPath, status: 'modified', additions: null, deletions: null, binary: true },
    {
      path: newPath,
      previousPath: oldPath,
      status: 'renamed',
      additions: 0,
      deletions: 0,
      binary: false,
    },
  ]);
});

// 한글: 잘못된 ref를 ref 값이 포함된 전용 도메인 오류로 보고한다.
test('reports an invalid ref with a distinguishable domain error', (t) => {
  const { repo, analyzer } = fixture(t);

  assert.throws(
    () => analyzer.analyze(repo, { since: 'missing/ref' }),
    (error) =>
      error instanceof InvalidGitRefError &&
      error.ref === 'missing/ref' &&
      error.message.includes('missing/ref'),
  );
});

// 한글: 저장소 접근 실패를 잘못된 ref 오류로 오인하지 않는다.
test('distinguishes repository failures from invalid refs', (t) => {
  const { root, analyzer } = fixture(t);

  assert.throws(
    () => analyzer.analyze(join(root, 'not-a-repository'), { since: 'HEAD' }),
    (error) => error instanceof GitAnalysisError && !(error instanceof InvalidGitRefError),
  );
});

// 한글: 첫 sync는 현재 HEAD의 빈 스냅샷을 저장하고 그 revision을 기록한다.
test('first sync snapshots HEAD to itself and records the current revision', (t) => {
  const { repo, store, registry, sync } = fixture(t);
  const head = git(repo, ['rev-parse', 'HEAD']);
  const sourceStatus = git(repo, ['status', '--porcelain']);

  const result = sync.run('sample');

  assert.deepEqual(result, {
    schemaVersion: 1,
    projectId: 'sample',
    base: head,
    head,
    commits: [],
    files: [],
  });
  assert.equal(registry.get('sample').lastSyncRevision, head);
  assert.deepEqual(store.readProjectJson('sample', 'changes.json'), result);
  assert.equal(git(repo, ['status', '--porcelain']), sourceStatus);
});

// 한글: 다음 sync는 저장된 revision부터 변경을 저장하고 lastSyncRevision을 전진시킨다.
test('subsequent sync uses the saved revision and advances it after success', (t) => {
  const { repo, store, registry, sync } = fixture(t);
  const base = sync.run('sample').head;
  writeFileSync(join(repo, 'later.md'), 'later\n');
  const head = commitAll(repo, 'add later note');

  const result = sync.run('sample');

  assert.equal(result.base, base);
  assert.equal(result.head, head);
  assert.deepEqual(result.commits, [{ sha: head, message: 'add later note' }]);
  assert.equal(registry.get('sample').lastSyncRevision, head);
  assert.deepEqual(store.readProjectJson('sample', 'changes.json'), result);
});

// 한글: 명시한 since ref는 저장된 lastSyncRevision보다 우선한다.
test('explicit since overrides the saved last sync revision', (t) => {
  const { repo, sync } = fixture(t);
  const initial = git(repo, ['rev-parse', 'HEAD']);
  sync.run('sample');
  writeFileSync(join(repo, 'one.md'), 'one\n');
  commitAll(repo, 'one');
  sync.run('sample');
  writeFileSync(join(repo, 'two.md'), 'two\n');
  const head = commitAll(repo, 'two');

  const result = sync.run('sample', { since: initial });

  assert.equal(result.base, initial);
  assert.equal(result.head, head);
  assert.deepEqual(result.commits.map((commit) => commit.message), ['two', 'one']);
});

// 한글: 분석 실패 시 changes와 lastSyncRevision을 갱신하지 않는다.
test('failed analysis leaves persisted sync state unchanged', (t) => {
  const { store, registry, sync } = fixture(t);
  const before = sync.run('sample');

  assert.throws(() => sync.run('sample', { since: 'bad/ref' }), InvalidGitRefError);
  assert.deepEqual(store.readProjectJson('sample', 'changes.json'), before);
  assert.equal(registry.get('sample').lastSyncRevision, before.head);
});

class FailingMetadataStore extends KnowledgeStore {
  failMetadataWrites = false;

  writeProjectJson(projectId, filename, value) {
    if (this.failMetadataWrites && filename === 'project.json') {
      throw new Error('forced metadata failure');
    }
    return super.writeProjectJson(projectId, filename, value);
  }
}

// 한글: metadata 저장 실패 시 이전 changes snapshot을 복원한다.
test('metadata write failure restores the previous changes snapshot', (t) => {
  const { repo, store, registry, sync } = fixture(t, { Store: FailingMetadataStore });
  const beforeChanges = sync.run('sample');
  const beforeMetadata = registry.get('sample');
  writeFileSync(join(repo, 'later.md'), 'later\n');
  commitAll(repo, 'later change');
  store.failMetadataWrites = true;

  assert.throws(() => sync.run('sample'), /forced metadata failure/);
  assert.deepEqual(store.readProjectJson('sample', 'changes.json'), beforeChanges);
  assert.deepEqual(registry.get('sample'), beforeMetadata);
});

// 한글: 첫 sync의 metadata 저장 실패 시 새 changes 파일을 남기지 않는다.
test('metadata write failure on first sync restores absent changes state', (t) => {
  const { store, registry, sync } = fixture(t, { Store: FailingMetadataStore });
  const beforeMetadata = registry.get('sample');
  store.failMetadataWrites = true;

  assert.throws(() => sync.run('sample'), /forced metadata failure/);
  assert.equal(store.readProjectJson('sample', 'changes.json'), null);
  assert.deepEqual(registry.get('sample'), beforeMetadata);
});
