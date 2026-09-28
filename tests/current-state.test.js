import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CurrentStateBuilder } from '../src/current-state/CurrentStateBuilder.js';
import { GitRepository } from '../src/git/GitRepository.js';
import { SensitivePathFilter } from '../src/security/SensitivePathFilter.js';
import { KnowledgeStore } from '../src/storage/KnowledgeStore.js';
import { createGitRepository, git } from './helpers/git-fixture.js';

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'doodle-current-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(repository, path, contents = '') {
  const absolutePath = join(repository, path);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, contents);
}

// 한글: 커밋된 파일과 staged, modified, untracked, deleted 작업 트리 상태를 분리한다.
test('reports committed files separately from each working tree state', (t) => {
  const root = temporaryRoot(t);
  const path = createGitRepository(root);
  write(path, 'src/staged.js', 'export const staged = false;\n');
  write(path, 'src/modified.js', 'export const modified = false;\n');
  write(path, 'src/deleted.js', 'export const deleted = false;\n');
  git(path, ['add', 'src']);
  git(path, ['commit', '-q', '-m', 'add sources']);

  write(path, 'src/staged.js', 'export const staged = true;\n');
  git(path, ['add', 'src/staged.js']);
  write(path, 'src/modified.js', 'export const modified = true;\n');
  unlinkSync(join(path, 'src/deleted.js'));
  write(path, 'src/untracked.js', 'export const untracked = true;\n');

  const revision = new GitRepository(path).revision();

  assert.equal(revision.branch, 'main');
  assert.match(revision.head, /^[0-9a-f]{40}$/);
  assert.deepEqual(revision.committed, [
    'README.md',
    'src/deleted.js',
    'src/modified.js',
    'src/staged.js',
  ]);
  assert.deepEqual(revision.workingTree, {
    staged: ['src/staged.js'],
    modified: ['src/modified.js'],
    untracked: ['src/untracked.js'],
    deleted: ['src/deleted.js'],
  });
});

// 한글: detached HEAD에서는 현재 커밋을 포함한 명확한 오류를 반환한다.
test('rejects detached HEAD with commit context', (t) => {
  const root = temporaryRoot(t);
  const path = createGitRepository(root);
  const head = git(path, ['rev-parse', 'HEAD']);
  git(path, ['checkout', '-q', '--detach', head]);

  assert.throws(() => new GitRepository(path).branch(), new RegExp(`detached HEAD.*${head}`, 'i'));
});

// 한글: Git 참조 조회 실패에는 실행한 명령과 참조 이름을 포함한다.
test('reports Git command and ref context when revision lookup fails', (t) => {
  const root = temporaryRoot(t);
  const path = createGitRepository(root);

  assert.throws(
    () => new GitRepository(path).head('refs/heads/missing'),
    /git rev-parse --verify refs\/heads\/missing\^\{commit\}.*refs\/heads\/missing/i,
  );
});

// 한글: 안전하고 Git에서 무시되지 않은 경로만으로 결정적인 저장소 사실을 만든다.
test('builds deterministic repository facts while excluding ignored and sensitive paths', (t) => {
  const root = temporaryRoot(t);
  const path = createGitRepository(root);
  write(path, '.gitignore', 'ignored/\n');
  write(path, 'package.json', '{"name":"sample"}\n');
  write(path, 'package-lock.json', '{}\n');
  write(path, 'src/index.js', 'export {};\n');
  write(path, 'scripts/tool.py', 'print("ok")\n');
  write(path, 'docs/README.md', '# Docs\n');
  write(path, 'docs/adr/0001-choice.md', '# Choice\n');
  write(path, 'config/eslint.config.js', 'export default [];\n');
  write(path, 'ignored/visible.js', 'export {};\n');
  write(path, 'credentials.json', '{"token":"plain"}\n');
  write(path, 'dist/generated.js', 'export {};\n');
  git(path, ['add', '.gitignore', 'package.json', 'package-lock.json', 'src', 'scripts', 'docs', 'config']);
  git(path, ['commit', '-q', '-m', 'add project layout']);
  const repository = new GitRepository(path);
  const builder = new CurrentStateBuilder({
    repository,
    sensitivePathFilter: new SensitivePathFilter(),
    clock: () => new Date('2026-09-28T01:02:03.000Z'),
  });

  const first = builder.build('sample');
  const second = builder.build('sample');

  assert.deepEqual(second, first);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.projectId, 'sample');
  assert.equal(first.generatedAt, '2026-09-28T01:02:03.000Z');
  assert.match(first.revision, /^[0-9a-f]{40}$/);
  assert.equal(first.revision, first.repository.head);
  assert.equal(first.repository.branch, 'main');
  assert.deepEqual(first.repository.committed, [
    '.gitignore',
    'README.md',
    'config/eslint.config.js',
    'docs/README.md',
    'docs/adr/0001-choice.md',
    'package-lock.json',
    'package.json',
    'scripts/tool.py',
    'src/index.js',
  ]);
  assert.deepEqual(first.workingTree, {
    staged: [],
    modified: [],
    untracked: [],
    deleted: [],
  });
  assert.equal('workingTree' in first.repository, false);
  assert.deepEqual(first.facts.directories, ['config', 'docs', 'scripts', 'src']);
  assert.deepEqual(first.facts.languages, ['JavaScript', 'Markdown', 'Python']);
  assert.deepEqual(first.facts.runtimes, ['Node.js', 'Python']);
  assert.deepEqual(first.facts.packageManagers, ['npm']);
  assert.deepEqual(first.facts.manifests, ['package.json']);
  assert.deepEqual(first.facts.config, ['.gitignore', 'config/eslint.config.js']);
  assert.deepEqual(first.facts.documentation, {
    readmes: ['README.md', 'docs/README.md'],
    docs: ['docs'],
    adrs: ['docs/adr'],
    decisions: [],
  });
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /ignored\/visible|credentials\.json|dist\/generated/);
});

// 한글: staged 삭제도 HEAD 사실과 작업 상태에 유지하되 Git 무시 및 민감 경로는 제외한다.
test('preserves safe staged deletions while filtering ignored and sensitive revision paths', (t) => {
  const root = temporaryRoot(t);
  const path = createGitRepository(root);
  write(path, 'src/remove.js', 'export const remove = true;\n');
  write(path, 'ignored/tracked.js', 'export const ignored = true;\n');
  write(path, 'credentials.json', '{"token":"plain"}\n');
  git(path, ['add', 'src/remove.js', 'ignored/tracked.js', 'credentials.json']);
  git(path, ['commit', '-q', '-m', 'add removable paths']);
  write(path, '.gitignore', 'ignored/\n');
  git(path, ['add', '.gitignore']);
  git(path, ['commit', '-q', '-m', 'ignore generated paths']);
  git(path, ['rm', '-q', 'src/remove.js', 'ignored/tracked.js', 'credentials.json']);
  const builder = new CurrentStateBuilder({
    repository: new GitRepository(path),
    clock: () => new Date('2026-09-28T01:02:03.000Z'),
  });

  const current = builder.build('sample');

  assert.ok(current.repository.committed.includes('src/remove.js'));
  assert.ok(current.workingTree.staged.includes('src/remove.js'));
  assert.ok(current.workingTree.deleted.includes('src/remove.js'));
  assert.doesNotMatch(JSON.stringify(current), /ignored\/tracked\.js|credentials\.json/);
});

// 한글: current.json을 외부 KnowledgeStore에 저장하고 원본 저장소를 변경하지 않는다.
test('persists current.json through KnowledgeStore without modifying the source repository', (t) => {
  const root = temporaryRoot(t);
  const path = createGitRepository(root);
  const store = new KnowledgeStore({ home: join(root, 'home') });
  store.writeNewProjectJson('sample', 'project.json', { id: 'sample', path });
  const repository = new GitRepository(path);
  const builder = new CurrentStateBuilder({
    repository,
    store,
    clock: () => new Date('2026-09-28T01:02:03.000Z'),
  });
  const before = git(path, ['status', '--porcelain=v1']);

  const current = builder.persist('sample');

  assert.deepEqual(JSON.parse(readFileSync(join(root, 'home', 'projects', 'sample', 'current.json'), 'utf8')), current);
  assert.deepEqual(store.readProjectJson('sample', 'current.json'), current);
  assert.equal(git(path, ['status', '--porcelain=v1']), before);
});

// 한글: 저장소 내부 파생 저장소를 쓰기 전에 거부하고 원본 상태를 보존한다.
test('rejects in-repository persistence before writing current.json', (t) => {
  const root = temporaryRoot(t);
  const path = createGitRepository(root);
  const home = join(path, '.doodle');
  const builder = new CurrentStateBuilder({
    repository: new GitRepository(path),
    store: new KnowledgeStore({ home }),
    clock: () => new Date('2026-09-28T01:02:03.000Z'),
  });
  const before = git(path, ['status', '--porcelain=v1']);

  assert.throws(() => builder.persist('sample'), /outside the source repository/i);
  assert.equal(existsSync(join(home, 'projects', 'sample', 'current.json')), false);
  assert.equal(git(path, ['status', '--porcelain=v1']), before);
});
