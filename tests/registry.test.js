import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { ProjectRegistry } from '../src/projects/ProjectRegistry.js';
import { KnowledgeStore } from '../src/storage/KnowledgeStore.js';
import { createGitRepository, git } from './helpers/git-fixture.js';

function temporaryRoot(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture(t) {
  const root = temporaryRoot(t, 'doodle-registry-');
  const home = join(root, 'doodle-home');
  const repo = createGitRepository(root);
  const store = new KnowledgeStore({ home });
  const registry = new ProjectRegistry({ store });
  return { root, home, repo, store, registry };
}

// 한글: 기본값으로 디렉터리 이름을 사용해 Git 저장소를 등록한다.
test('registers a Git repository with its directory name by default', (t) => {
  const { home, repo, registry } = fixture(t);

  const project = registry.register(repo);
  const canonicalRepo = realpathSync(repo);

  assert.equal(project.id, basename(repo));
  assert.equal(project.path, canonicalRepo);
  assert.equal(project.schemaVersion, 1);
  const persisted = JSON.parse(readFileSync(join(home, 'registry.json'), 'utf8'));
  assert.equal(persisted.schemaVersion, 1);
  assert.deepEqual(persisted.projects, [{ id: basename(repo), path: canonicalRepo }]);
});

// 한글: 명시적인 프로젝트 ID로 등록할 수 있다.
test('register accepts an explicit project id', (t) => {
  const { repo, registry } = fixture(t);
  assert.equal(registry.register(repo, { id: 'congenial-pancake' }).id, 'congenial-pancake');
});

// 한글: 등록 시 버전이 포함된 프로젝트 식별 메타데이터만 저장한다.
test('register persists only versioned project identity metadata', (t) => {
  const { home, repo, registry } = fixture(t);
  const canonicalRepo = realpathSync(repo);

  registry.register(repo, { id: 'sample' });

  const metadata = JSON.parse(readFileSync(join(home, 'projects', 'sample', 'project.json'), 'utf8'));
  assert.deepEqual(metadata, {
    schemaVersion: 1,
    id: 'sample',
    path: canonicalRepo,
  });
});

// 한글: 존재하지 않는 경로와 Git 저장소가 아닌 디렉터리의 등록을 거부한다.
test('register rejects nonexistent and non-Git directories', (t) => {
  const { root, registry } = fixture(t);
  const plain = join(root, 'plain');
  mkdirSync(plain);

  assert.throws(() => registry.register(join(root, 'missing')), /does not exist/i);
  assert.throws(() => registry.register(plain), /not a Git repository/i);
});

// 한글: 중복 프로젝트 ID와 중복 canonical 경로의 등록을 거부한다.
test('register rejects duplicate ids and duplicate canonical paths', (t) => {
  const { root, repo, registry } = fixture(t);
  registry.register(repo, { id: 'one' });
  const other = createGitRepository(root, 'other');

  assert.throws(() => registry.register(other, { id: 'one' }), /already registered/i);
  assert.throws(() => registry.register(repo, { id: 'two' }), /path is already registered/i);
});

// 한글: 외부 저장소를 벗어날 수 있는 프로젝트 ID를 거부한다.
test('register rejects project ids that could escape external storage', (t) => {
  const { repo, registry } = fixture(t);
  assert.throws(() => registry.register(repo, { id: '../escape' }), /Invalid project ID/);
  assert.throws(() => registry.register(repo, { id: 'nested/id' }), /Invalid project ID/);
  assert.throws(() => registry.register(repo, { id: '' }), /Invalid project ID/);
  assert.throws(() => registry.register(repo, { id: 'x'.repeat(256) }), /Invalid project ID/);
});

// 한글: 공백과 유니코드가 포함된 안전한 디렉터리 이름 ID를 허용한다.
test('register accepts safe directory-name ids with spaces and Unicode', (t) => {
  const root = temporaryRoot(t, 'doodle-id-');
  const repo = createGitRepository(root, '프로젝트 alpha');
  const registry = new ProjectRegistry({ store: new KnowledgeStore({ home: join(root, 'home') }) });

  assert.equal(registry.register(repo).id, '프로젝트 alpha');
});

// 한글: 프로젝트 목록을 프로젝트 ID 순서로 결정적으로 정렬한다.
test('list is deterministically sorted by project id', (t) => {
  const { root, repo, registry } = fixture(t);
  const second = createGitRepository(root, 'second');
  registry.register(repo, { id: 'zeta' });
  registry.register(second, { id: 'alpha' });

  assert.deepEqual(registry.list().map((project) => project.id), ['alpha', 'zeta']);
});

// 한글: 대소문자 및 유니코드 정규화 후 충돌하는 ID를 거부한다.
test('register rejects ids that collide after case and Unicode normalization', (t) => {
  const { root, repo, registry } = fixture(t);
  const second = createGitRepository(root, 'second');
  registry.register(repo, { id: 'Caf\u00e9' });

  assert.throws(() => registry.register(second, { id: 'CAFE\u0301' }), /collides/i);
});

// 한글: source repository 내부에 있는 derived storage를 거부한다.
test('register rejects derived storage inside the source repository', (t) => {
  const root = temporaryRoot(t, 'doodle-external-');
  const repo = createGitRepository(root, 'source');
  const store = new KnowledgeStore({ home: join(repo, '.doodle') });
  const registry = new ProjectRegistry({ store });

  assert.throws(() => registry.register(repo, { id: 'sample' }), /outside the source repository/i);
  assert.equal(git(repo, ['status', '--porcelain']), '');
});

// 한글: 등록 시 source repository를 수정하지 않는다.
test('register does not modify the source repository', (t) => {
  const { repo, registry } = fixture(t);
  const sourceHead = git(repo, ['rev-parse', 'HEAD']);
  const sourceStatus = git(repo, ['status', '--porcelain']);

  registry.register(repo, { id: 'sample' });

  assert.equal(git(repo, ['rev-parse', 'HEAD']), sourceHead);
  assert.equal(git(repo, ['status', '--porcelain']), sourceStatus);
});

// 한글: 등록 해제 시 source repository를 건드리지 않고 registry와 derived data를 제거한다.
test('unregister removes registry and derived data without touching the source repository', (t) => {
  const { home, repo, registry, store } = fixture(t);
  registry.register(repo, { id: 'sample' });
  store.writeProjectJson('sample', 'current.json', { schemaVersion: 1, projectId: 'sample' });
  const sourceHead = git(repo, ['rev-parse', 'HEAD']);
  const sourceStatus = git(repo, ['status', '--porcelain']);

  registry.unregister('sample');

  assert.deepEqual(registry.list(), []);
  assert.equal(existsSync(join(home, 'projects', 'sample')), false);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), sourceHead);
  assert.equal(git(repo, ['status', '--porcelain']), sourceStatus);
});

// 한글: 알 수 없는 프로젝트의 등록 해제를 거부하고 registry를 변경하지 않는다.
test('unregister rejects an unknown project without changing the registry', (t) => {
  const { home, repo, registry } = fixture(t);
  registry.register(repo, { id: 'sample' });
  const before = readFileSync(join(home, 'registry.json'), 'utf8');

  assert.throws(() => registry.unregister('missing'), /not registered/i);
  assert.equal(readFileSync(join(home, 'registry.json'), 'utf8'), before);
});

// 한글: derived data 제거에 실패하면 registry를 복원한다.
test('unregister restores the registry when derived-data removal fails', (t) => {
  const root = temporaryRoot(t, 'doodle-unregister-');
  const repo = createGitRepository(root, 'source');
  const home = join(root, 'home');
  class FailingRemovalStore extends KnowledgeStore {
    removeProject() {
      throw new Error('forced removal failure');
    }
  }
  const store = new FailingRemovalStore({ home });
  const registry = new ProjectRegistry({ store });
  registry.register(repo, { id: 'sample' });

  assert.throws(() => registry.unregister('sample'), /forced removal failure/);
  assert.deepEqual(registry.list(), [{ id: 'sample', path: realpathSync(repo) }]);
  assert.equal(existsSync(join(home, 'projects', 'sample', 'project.json')), true);
});

// 한글: 저장에 성공하면 임시 JSON 파일을 남기지 않는다.
test('successful writes leave no temporary JSON files behind', (t) => {
  const { home, repo, registry } = fixture(t);
  registry.register(repo, { id: 'sample' });

  assert.deepEqual(readdirSync(home).sort(), ['projects', 'registry.json']);
  assert.deepEqual(readdirSync(join(home, 'projects', 'sample')), ['project.json']);
});

// 한글: storage는 schema version을 추가하고 충돌하는 version을 거부한다.
test('storage stamps the schema version and rejects a conflicting version', (t) => {
  const root = temporaryRoot(t, 'doodle-storage-');
  const store = new KnowledgeStore({ home: join(root, 'home') });

  store.writeRegistry({ projects: [] });
  store.writeProjectJson('sample', 'current.json', { projectId: 'sample' });

  assert.equal(store.readRegistry().schemaVersion, 1);
  assert.equal(store.readProjectJson('sample', 'current.json').schemaVersion, 1);
  assert.throws(
    () => store.writeProjectJson('sample', 'current.json', { schemaVersion: 2, projectId: 'sample' }),
    /schemaVersion 1/,
  );
});

// 한글: home 옵션을 전달하지 않으면 DOODLE_HOME을 사용한다.
test('DOODLE_HOME is used when no home option is passed', (t) => {
  const root = temporaryRoot(t, 'doodle-home-');
  const previous = process.env.DOODLE_HOME;
  process.env.DOODLE_HOME = join(root, 'custom-home');
  try {
    const store = new KnowledgeStore();
    store.writeRegistry({ schemaVersion: 1, projects: [] });
    assert.equal(existsSync(join(root, 'custom-home', 'registry.json')), true);
  } finally {
    if (previous === undefined) delete process.env.DOODLE_HOME;
    else process.env.DOODLE_HOME = previous;
  }
});

// 한글: storage는 빈 home을 거부하고 상대 경로 home을 정규화한다.
test('storage rejects an empty home and normalizes relative homes', () => {
  assert.throws(() => new KnowledgeStore({ home: '' }), /must not be empty/i);
  assert.equal(new KnowledgeStore({ home: 'relative-home' }).home, join(process.cwd(), 'relative-home'));
});
