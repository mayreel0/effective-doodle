import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { KnowledgeProvider, KnowledgeStore } from '../src/index.js';
import { createGitRepository, git } from './helpers/git-fixture.js';

const cli = resolve('bin/doodle.js');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'doodle-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repo: createGitRepository(root), home: join(root, 'knowledge') };
}

function run(home, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DOODLE_HOME: home },
  });
}

function success(home, ...args) {
  const result = run(home, ...args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}

// 한글: CLI의 모든 명령이 외부 저장소를 사용하며 JSON은 기계가 바로 읽을 수 있다.
test('runs every CLI command with isolated external storage', (t) => {
  const { repo, home } = fixture(t);
  const before = git(repo, ['status', '--porcelain']);
  const registered = JSON.parse(success(home, 'register', repo, '--id', 'sample', '--json'));
  assert.equal(registered.schemaVersion, 1);
  assert.equal(registered.id, 'sample');
  assert.deepEqual(JSON.parse(success(home, 'list', '--json')).projects.map(({ id }) => id), ['sample']);

  mkdirSync(join(repo, 'docs/adr'), { recursive: true });
  writeFileSync(join(repo, 'docs/adr/001-auth.md'), '# Authentication\nStatus: accepted\nConstraint: Tokens must not be logged.\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'add authentication decision']);
  const head = git(repo, ['rev-parse', 'HEAD']);
  const synced = JSON.parse(success(home, 'sync', '--id', 'sample', '--json'));
  assert.equal(synced.schemaVersion, 1);
  assert.equal(synced.current.repository.head, head);
  assert.equal(synced.changes.base, head);
  assert.equal(synced.decisions.decisions[0].title, 'Authentication');
  assert.equal(JSON.parse(success(home, 'current', 'sample', '--json')).repository.head, head);
  assert.equal(JSON.parse(success(home, 'changes', 'sample', '--json')).head, head);
  assert.equal(JSON.parse(success(home, 'changes', 'sample', '--since', 'HEAD~1', '--json')).commits.length, 1);
  assert.equal(JSON.parse(success(home, 'context', 'sample', '--task', 'authentication', '--json')).relevantDecisions.length, 1);

  const humanCurrent = success(home, 'current', 'sample');
  assert.match(humanCurrent, /Committed.*HEAD:/);
  assert.match(humanCurrent, /Working tree:/);
  const humanChanges = success(home, 'changes', 'sample');
  assert.match(humanChanges, /Base:/);
  assert.match(humanChanges, /Head:/);

  writeFileSync(join(repo, 'README.md'), '# Working tree edit\n');
  const sourceStatus = git(repo, ['status', '--porcelain']);
  const rebuilt = JSON.parse(success(home, 'sync', 'sample', '--rebuild', '--json'));
  assert.deepEqual(rebuilt.current.workingTree.modified, ['README.md']);
  assert.equal(rebuilt.changes.base, head);
  assert.equal(git(repo, ['status', '--porcelain']), sourceStatus);
  for (const filename of ['project.json', 'current.json', 'changes.json', 'decisions.json']) {
    assert.equal(JSON.parse(readFileSync(join(home, 'projects/sample', filename), 'utf8')).schemaVersion, 1);
  }
  assert.equal(JSON.parse(success(home, 'unregister', 'sample', '--json')).unregistered, true);
  assert.deepEqual(JSON.parse(success(home, 'list', '--json')).projects, []);
  assert.equal(before, '');
});

// 한글: 잘못된 명령과 인자, Git 참조, 미등록 프로젝트는 stderr와 실패 코드로 구분된다.
test('reports usage and domain errors without JSON stdout contamination', (t) => {
  const { repo, home } = fixture(t);
  for (const args of [[], ['wat'], ['register'], ['context', 'sample'], ['list', '--task', 'x']]) {
    const result = run(home, ...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  }
  const unknown = run(home, 'current', 'missing', '--json');
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /not registered/);
  success(home, 'register', repo, '--id', 'sample');
  const badRef = run(home, 'changes', 'sample', '--since', 'missing-ref', '--json');
  assert.equal(badRef.status, 1);
  assert.equal(badRef.stdout, '');
  assert.match(badRef.stderr, /Invalid Git ref/);
});

// 한글: 모듈 소비자는 CLI를 거치지 않고 핵심 API로 동기화와 컨텍스트 조회를 실행한다.
test('exports a reusable core provider', (t) => {
  const { repo, home } = fixture(t);
  const provider = new KnowledgeProvider({ home });
  provider.register(repo, { id: 'sample' });
  const snapshot = provider.sync('sample');
  assert.equal(snapshot.current.projectId, 'sample');
  assert.equal(provider.getContext('sample', 'README').schemaVersion, 1);
});

// 한글: 변경 스냅샷과 명시 ref 조회는 민감 경로와 커밋 메시지의 비밀값을 노출하지 않는다.
test('filters sensitive change paths and redacts commit messages', (t) => {
  const { repo, home } = fixture(t);
  const provider = new KnowledgeProvider({ home });
  provider.register(repo, { id: 'sample' });
  const base = provider.sync('sample').changes.head;
  writeFileSync(join(repo, '.env'), 'TOKEN=private-value\n');
  writeFileSync(join(repo, 'README.md'), '# Updated\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'update docs TOKEN=private-value']);
  const snapshot = provider.sync('sample');
  assert.equal(snapshot.changes.base, base);
  assert.deepEqual(snapshot.changes.files.map(({ path }) => path), ['README.md']);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-value|\.env/);
  const explicit = provider.getChanges('sample', { since: base });
  assert.doesNotMatch(JSON.stringify(explicit), /private-value|\.env/);
  assert.throws(() => provider.sync('sample', { rebuild: true, since: 'missing-ref' }), /Invalid Git ref/);
  assert.equal(provider.getChanges('sample').head, snapshot.changes.head);
  const rebuilt = provider.sync('sample', { rebuild: true });
  assert.equal(rebuilt.changes.base, rebuilt.changes.head);
  assert.equal(rebuilt.changes.files.length, 0);
});

// 한글: 동기화 후반 단계가 실패하면 기존 기준 revision과 파생 스냅샷을 모두 복원한다.
test('restores all persisted snapshots when current-state creation fails', (t) => {
  const { repo, home } = fixture(t);
  const provider = new KnowledgeProvider({ home });
  provider.register(repo, { id: 'sample' });
  provider.sync('sample');
  const files = ['project.json', 'current.json', 'changes.json', 'decisions.json'];
  const paths = files.map((filename) => join(home, 'projects/sample', filename));
  const before = paths.map((path) => readFileSync(path, 'utf8'));
  writeFileSync(join(repo, 'README.md'), '# New commit\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'advance head']);
  git(repo, ['checkout', '-q', '--detach', 'HEAD']);

  assert.throws(() => provider.sync('sample'), /detached HEAD/);
  assert.deepEqual(paths.map((path) => readFileSync(path, 'utf8')), before);
  assert.throws(() => provider.sync('sample', { rebuild: true }), /detached HEAD/);
  assert.deepEqual(paths.map((path) => readFileSync(path, 'utf8')), before);
});

// 한글: decision 저장 실패도 current와 변경 기준을 포함한 모든 스냅샷을 되돌린다.
test('restores all snapshots when decision indexing fails after current persistence', (t) => {
  class FailingDecisionStore extends KnowledgeStore {
    failDecisions = false;

    writeProjectJson(projectId, filename, value) {
      if (filename === 'decisions.json' && this.failDecisions) {
        this.failDecisions = false;
        throw new Error('forced decision write failure');
      }
      return super.writeProjectJson(projectId, filename, value);
    }
  }

  const { repo, home } = fixture(t);
  const store = new FailingDecisionStore({ home });
  const provider = new KnowledgeProvider({ store });
  provider.register(repo, { id: 'sample' });
  provider.sync('sample');
  const paths = ['project.json', 'current.json', 'changes.json', 'decisions.json']
    .map((filename) => join(home, 'projects/sample', filename));
  const before = paths.map((path) => readFileSync(path, 'utf8'));
  for (const rebuild of [false, true]) {
    store.failDecisions = true;
    assert.throws(() => provider.sync('sample', { rebuild }), /forced decision write failure/);
    assert.deepEqual(paths.map((path) => readFileSync(path, 'utf8')), before);
  }
});

// 한글: branch와 decision 메타데이터의 비밀값도 저장 전과 CLI JSON 출력 전에 가린다.
test('redacts secret-like values in branch and decision metadata', (t) => {
  const { repo, home } = fixture(t);
  git(repo, ['checkout', '-q', '-b', 'feature/TOKEN=private-value']);
  mkdirSync(join(repo, 'docs/adr'), { recursive: true });
  writeFileSync(join(repo, 'docs/adr/TOKEN=private-value.md'), '# TOKEN=private-value\nStatus: PASSWORD=private-value\n');
  git(repo, ['add', 'docs/adr/TOKEN=private-value.md']);
  git(repo, ['commit', '-q', '-m', 'add note']);
  success(home, 'register', repo, '--id', 'sample');
  const synced = JSON.parse(success(home, 'sync', 'sample', '--json'));
  const current = JSON.parse(success(home, 'current', 'sample', '--json'));
  assert.doesNotMatch(JSON.stringify({ synced, current }), /private-value/);
  assert.equal(current.repository.branch, 'feature/TOKEN=[REDACTED]');
  assert.equal(synced.decisions.decisions[0].title, 'TOKEN=[REDACTED]');
  assert.equal(synced.decisions.decisions[0].status, 'password=[REDACTED]');
});
