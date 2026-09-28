import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { DecisionIndex } from '../src/decisions/DecisionIndex.js';
import { KnowledgeStore } from '../src/storage/KnowledgeStore.js';
import { createGitRepository, git } from './helpers/git-fixture.js';

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doodle-decisions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = createGitRepository(root);
  const home = join(root, 'doodle-home');
  const store = new KnowledgeStore({ home });
  const index = new DecisionIndex({ store, ...options });
  return { home, index, repo };
}

function writeDecision(repo, relativePath, content) {
  const path = join(repo, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// 한글: 모든 관례적 결정 디렉터리를 재귀 탐색하고 정규화한 메타데이터를 결정적으로 정렬한다.
test('recursively scans conventional decision directories into deterministic metadata', (t) => {
  const { index, repo } = fixture(t);
  writeDecision(repo, 'docs/adr/nested/002-cache.md', '# Cache Strategy\n\n## Status\n**Accepted**\n');
  writeDecision(repo, 'docs/decisions/001-api.md', '---\nstatus: _PROPOSED_\n---\n# API Shape\n');
  writeDecision(repo, 'adr/003-jobs.md', '# Job Queue\n\n**Status:** `Rejected`\n');
  writeDecision(repo, 'decisions/004-auth.md', '# Authentication\n');
  writeDecision(repo, 'notes/not-a-decision.md', '# Ignore Me\n');
  writeDecision(repo, 'adr/README.txt', 'not Markdown\n');

  const result = index.rebuild({ id: 'sample', path: repo });

  assert.deepEqual(
    result.decisions.map(({ id, filename, path, title, status }) => ({ id, filename, path, title, status })),
    [
      {
        id: '003-jobs',
        filename: '003-jobs.md',
        path: 'adr/003-jobs.md',
        title: 'Job Queue',
        status: 'rejected',
      },
      {
        id: '004-auth',
        filename: '004-auth.md',
        path: 'decisions/004-auth.md',
        title: 'Authentication',
        status: 'unknown',
      },
      {
        id: '002-cache',
        filename: '002-cache.md',
        path: 'docs/adr/nested/002-cache.md',
        title: 'Cache Strategy',
        status: 'accepted',
      },
      {
        id: '001-api',
        filename: '001-api.md',
        path: 'docs/decisions/001-api.md',
        title: 'API Shape',
        status: 'proposed',
      },
    ],
  );
});

// 한글: 버전 및 프로젝트 ID가 포함된 결정 인덱스를 외부 저장소에만 기록한다.
test('persists a versioned project decision index without modifying the source repository', (t) => {
  const { home, index, repo } = fixture(t);
  writeDecision(repo, 'adr/001-storage.md', '# Storage\n');
  git(repo, ['add', 'adr/001-storage.md']);
  git(repo, ['commit', '-q', '-m', 'add decision']);
  const headBefore = git(repo, ['rev-parse', 'HEAD']);
  const statusBefore = git(repo, ['status', '--porcelain']);

  index.rebuild({ id: 'sample', path: repo });

  const persisted = JSON.parse(readFileSync(join(home, 'projects', 'sample', 'decisions.json'), 'utf8'));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.projectId, 'sample');
  assert.equal(persisted.decisions.length, 1);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(git(repo, ['status', '--porcelain']), statusBefore);
});

// 한글: 외부 저장소가 소스 저장소 내부로 잘못 설정되면 어떤 파일도 쓰기 전에 거부한다.
test('rejects derived decision storage inside the source repository before writing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-decisions-external-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = createGitRepository(root);
  writeDecision(repo, 'adr/001-storage.md', '# Storage\n');
  git(repo, ['add', 'adr/001-storage.md']);
  git(repo, ['commit', '-q', '-m', 'add decision']);
  const before = git(repo, ['status', '--porcelain']);
  const index = new DecisionIndex({ store: new KnowledgeStore({ home: join(repo, '.doodle') }) });

  assert.throws(() => index.rebuild({ id: 'sample', path: repo }), /outside the source repository/i);
  assert.equal(git(repo, ['status', '--porcelain']), before);
});

// 한글: 민감하거나 생성된 경로를 제외하고 향후 검색용 본문은 마스킹 및 길이 제한한다.
test('filters excluded paths and stores only safe bounded decision content', (t) => {
  const { index, repo } = fixture(t, { maxContentLength: 80 });
  writeDecision(
    repo,
    'adr/001-visible.md',
    '# Visible\n\nAPI_KEY=plain-secret\n' + 'searchable context '.repeat(20),
  );
  writeDecision(repo, 'adr/dist/002-generated.md', '# Generated\n');
  writeDecision(repo, 'adr/team-secrets/003-private.md', '# Private\n');

  const result = index.rebuild({ id: 'sample', path: repo });

  assert.deepEqual(result.decisions.map((decision) => decision.path), ['adr/001-visible.md']);
  assert.ok(result.decisions[0].content.length <= 80);
  assert.match(result.decisions[0].content, /\[REDACTED\]/);
  assert.doesNotMatch(result.decisions[0].content, /plain-secret/);
});

// 한글: 제외 대상이나 저장소 외부 문서를 가리키는 Markdown 심볼릭 링크를 경고와 함께 건너뛴다.
test('warns and skips Markdown symlinks without following their targets', (t) => {
  const { index, repo } = fixture(t);
  writeDecision(repo, 'adr/001-visible.md', '# Visible\n');
  writeDecision(repo, 'adr/team-secrets/hidden.md', '# Hidden\n');
  const outside = join(dirname(repo), 'outside.md');
  writeFileSync(outside, '# Outside\n');
  symlinkSync(join(repo, 'adr/team-secrets/hidden.md'), join(repo, 'adr/002-sensitive-alias.md'));
  symlinkSync(outside, join(repo, 'adr/003-outside-alias.md'));

  const result = index.rebuild({ id: 'sample', path: repo });

  assert.deepEqual(result.decisions.map((decision) => decision.path), ['adr/001-visible.md']);
  assert.deepEqual(result.warnings.map((warning) => warning.path), [
    'adr/002-sensitive-alias.md',
    'adr/003-outside-alias.md',
  ]);
  for (const warning of result.warnings) assert.match(warning.message, /symbolic link/i);
});

// 한글: 관례적 결정 루트 자체가 제외 대상 디렉터리의 심볼릭 링크이면 경고 후 탐색하지 않는다.
test('warns and skips a conventional decision root that is a symbolic link', (t) => {
  const { index, repo } = fixture(t);
  writeDecision(repo, 'team-secrets/hidden.md', '# Hidden\n');
  symlinkSync(join(repo, 'team-secrets'), join(repo, 'adr'));

  const result = index.rebuild({ id: 'sample', path: repo });

  assert.deepEqual(result.decisions, []);
  assert.deepEqual(result.warnings.map((warning) => warning.path), ['adr']);
  assert.match(result.warnings[0].message, /symbolic link.*directory/i);
});

// 한글: 대용량 결정 문서는 제한된 접두사만 읽어 저장하고 명시적인 절단 경고를 남긴다.
test('bounds large decision reads and reports deterministic truncation', (t) => {
  const { index, repo } = fixture(t, { maxContentLength: 80 });
  writeDecision(
    repo,
    'adr/001-large.md',
    '# Large Decision\n\nStatus: Accepted\n\n' + '문맥'.repeat(100_000),
  );

  const result = index.rebuild({ id: 'sample', path: repo });

  assert.equal(result.decisions[0].title, 'Large Decision');
  assert.equal(result.decisions[0].status, 'accepted');
  assert.ok(result.decisions[0].content.length <= 80);
  assert.deepEqual(result.warnings.map((warning) => warning.path), ['adr/001-large.md']);
  assert.match(result.warnings[0].message, /truncated|bounded prefix/i);
});

// 한글: 읽을 수 없거나 제목이 없는 문서를 경고로 보고하면서 정상 문서는 계속 인덱싱한다.
test('reports malformed documents as warnings and continues scanning valid decisions', (t) => {
  const { index, repo } = fixture(t);
  writeDecision(repo, 'adr/001-valid.md', '# Valid Decision\n');
  writeDecision(repo, 'adr/002-no-title.md', 'Status: proposed\n');
  const invalidPath = join(repo, 'adr/003-invalid-utf8.md');
  writeFileSync(invalidPath, Buffer.from([0xc3, 0x28]));

  const result = index.rebuild({ id: 'sample', path: repo });

  assert.deepEqual(result.decisions.map((decision) => decision.path), [
    'adr/001-valid.md',
    'adr/002-no-title.md',
  ]);
  assert.equal(result.decisions[1].title, null);
  assert.deepEqual(result.warnings.map((warning) => warning.path), [
    'adr/002-no-title.md',
    'adr/003-invalid-utf8.md',
  ]);
  assert.match(result.warnings[0].message, /H1 title/i);
  assert.match(result.warnings[1].message, /UTF-8|read/i);
});
