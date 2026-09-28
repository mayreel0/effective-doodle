import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ContextBuilder } from '../src/context/ContextBuilder.js';
import { ProjectRegistry } from '../src/projects/ProjectRegistry.js';
import { SensitivePathFilter } from '../src/security/SensitivePathFilter.js';
import { KnowledgeStore } from '../src/storage/KnowledgeStore.js';
import { createGitRepository, git } from './helpers/git-fixture.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'doodle-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = createGitRepository(root);
  const store = new KnowledgeStore({ home: join(root, 'doodle-home') });
  const registry = new ProjectRegistry({ store });
  registry.register(repository, { id: 'sample' });
  const head = git(repository, ['rev-parse', 'HEAD']);

  store.writeProjectJson('sample', 'current.json', {
    projectId: 'sample',
    revision: head,
    generatedAt: '2026-09-28T01:00:00.000Z',
    repository: { branch: 'main', head, committed: ['README.md', 'tsconfig.auth.json'] },
    workingTree: {
      staged: [],
      modified: ['src/auth/token.js'],
      untracked: [],
      deleted: [],
    },
    facts: {
      directories: ['docs', 'src'],
      languages: ['JavaScript'],
      runtimes: ['Node.js'],
      packageManagers: ['npm'],
      manifests: ['package.json'],
      config: ['tsconfig.auth.json'],
      documentation: { readmes: ['README.md'], docs: ['docs'], adrs: ['docs/adr'], decisions: [] },
    },
  });
  store.writeProjectJson('sample', 'changes.json', {
    projectId: 'sample',
    base: '1111111111111111111111111111111111111111',
    head,
    commits: [{ sha: head, message: 'adjust authentication tokens; TOKEN=commit-secret' }],
    files: [
      { path: 'src/auth/token.js', status: 'modified', additions: 2, deletions: 1, binary: false },
      { path: '.env', status: 'modified', additions: 1, deletions: 1, binary: false },
      {
        path: 'src/auth/public.js',
        previousPath: 'team-secrets/private.js',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        binary: false,
      },
    ],
  });
  store.writeProjectJson('sample', 'decisions.json', {
    projectId: 'sample',
    decisions: [
      {
        id: '001-authentication',
        filename: '001-authentication.md',
        path: 'docs/adr/001-authentication.md',
        title: 'Authentication token handling',
        status: 'accepted',
        content: '# Authentication token handling\n\nConstraint: Tokens must not be logged; PASSWORD=db-secret\nAPI_KEY=plain-secret',
      },
      {
        id: '002-database',
        filename: '002-database.md',
        path: 'docs/adr/002-database.md',
        title: 'Database engine',
        status: 'accepted',
        content: '# Database engine\n\nUse SQLite for local data.',
      },
      {
        id: '003-hidden',
        filename: '003-hidden.md',
        path: 'docs/adr/team-secrets/003-hidden.md',
        title: 'Authentication secret',
        status: 'accepted',
        content: 'TOKEN=hidden-secret',
      },
      {
        id: '004-data-note',
        filename: '004-data-note.md',
        path: 'docs/adr/004-data-note.md',
        title: 'Storage choice',
        status: 'proposed',
        content: 'Database and SQLite are mentioned here.',
      },
      {
        id: '005-data-note',
        filename: '005-data-note.md',
        path: 'docs/adr/005-data-note.md',
        title: 'Storage choice',
        status: 'proposed',
        content: 'Database and SQLite are mentioned here.',
      },
    ],
    warnings: [{ path: 'docs/adr/004-broken.md', message: 'Unable to read decision document.' }],
  });

  return {
    repository,
    store,
    head,
    builder: new ContextBuilder({
      registry,
      store,
      pathFilter: new SensitivePathFilter(),
      clock: () => new Date('2026-09-28T02:00:00.000Z'),
    }),
  };
}

// 한글: 현재 상태와 작업 트리, 최근 변경을 분리하고 관련 결정과 설정을 lexical 점수순으로 반환한다.
test('builds separated context sections with deterministic lexical relevance', (t) => {
  const { repository, builder } = fixture(t);
  const sourceStatus = git(repository, ['status', '--porcelain']);

  const context = builder.getContext('sample', 'authentication auth token 수정');

  assert.equal(context.schemaVersion, 1);
  assert.equal(context.generatedAt, '2026-09-28T02:00:00.000Z');
  assert.deepEqual(context.task, {
    text: 'authentication auth token 수정',
    tokens: ['auth', 'authentication', 'token'],
  });
  assert.equal(context.project.id, 'sample');
  assert.equal(context.project.revision, context.currentState.revision);
  assert.equal('workingTree' in context.currentState, false);
  assert.deepEqual(context.workingTree.modified, ['src/auth/token.js']);
  assert.deepEqual(context.recentChanges.files.map((file) => file.path), [
    'src/auth/token.js',
    'src/auth/public.js',
  ]);
  assert.deepEqual(context.relevantDecisions.map((decision) => decision.id), ['001-authentication']);
  assert.deepEqual(context.relevantDecisions[0].matchedTerms, ['authentication', 'token']);
  assert.ok(context.relevantDecisions[0].score > 0);
  assert.deepEqual(context.relevantConfiguration, [
    { path: 'tsconfig.auth.json', score: 2, matchedTerms: ['auth'] },
  ]);
  assert.deepEqual(context.knownConstraints, [
    {
      sourcePath: 'docs/adr/001-authentication.md',
      line: 3,
      text: 'Tokens must not be logged; PASSWORD=[REDACTED]',
    },
  ]);
  assert.deepEqual(context.warnings, [
    {
      source: 'decisions',
      path: 'docs/adr/004-broken.md',
      message: 'Unable to read decision document.',
    },
  ]);
  assert.deepEqual(context.sourcePrecedence, [
    'machine-readable-config',
    'current-source-code',
    'explicit-decisions',
    'readme-and-docs',
    'derived-knowledge',
  ]);
  assert.deepEqual(
    builder.getContext('sample', 'authentication auth token 수정'),
    context,
  );
  assert.equal(git(repository, ['status', '--porcelain']), sourceStatus);
});

// 한글: decision content 일치는 낮은 점수를 받고 filename과 title 일치는 더 높은 점수를 받는다.
test('weights filename and title matches above content-only matches', (t) => {
  const { builder } = fixture(t);

  const context = builder.getContext('sample', 'database sqlite');

  assert.deepEqual(context.relevantDecisions.map((decision) => decision.id), [
    '002-database',
    '004-data-note',
    '005-data-note',
  ]);
  assert.deepEqual(context.relevantDecisions.map(({ score, matchedTerms }) => ({ score, matchedTerms })), [
    { score: 9, matchedTerms: ['database', 'sqlite'] },
    { score: 2, matchedTerms: ['database', 'sqlite'] },
    { score: 2, matchedTerms: ['database', 'sqlite'] },
  ]);
});

// 한글: 빈 문자열이나 불용어만 있는 작업은 오류 없이 동일한 빈 relevance 결과를 만든다.
test('returns predictable empty relevance for empty and stopword-only tasks', (t) => {
  const { builder } = fixture(t);

  const empty = builder.getContext('sample', '');
  const stopwords = builder.getContext('sample', 'the and 수정 작업');

  assert.deepEqual(empty.task.tokens, []);
  assert.deepEqual(stopwords.task.tokens, []);
  assert.deepEqual(empty.relevantDecisions, []);
  assert.deepEqual(stopwords.relevantDecisions, []);
  assert.deepEqual(empty.relevantConfiguration, []);
  assert.deepEqual(stopwords.relevantConfiguration, []);
  assert.deepEqual(empty.knownConstraints, []);
  assert.deepEqual(stopwords.knownConstraints, []);
});

// 한글: context 결과에 secret 값이나 제외 경로의 decision metadata를 노출하지 않는다.
test('does not expose secret values or excluded decision paths', (t) => {
  const { builder, store } = fixture(t);
  const current = store.readProjectJson('sample', 'current.json');
  current.repository.branch = 'feature/TOKEN=branch-secret';
  current.repository.committed.push('.env', 'team-secrets/private.js', 'tsconfig.TOKEN=path-secret.json');
  current.workingTree.untracked.push('.env.local', 'src/PASSWORD=working-secret.js');
  current.facts.directories.push('team-secrets');
  current.facts.manifests.push('.env');
  current.facts.config.push('.env', 'team-secrets/config.json', 'tsconfig.TOKEN=config-secret.json');
  current.facts.documentation.readmes.push('team-secrets/README.md');
  current.facts.documentation.docs.push('.env.docs');
  store.writeProjectJson('sample', 'current.json', current);

  const changes = store.readProjectJson('sample', 'changes.json');
  changes.commits[0].message =
    'Update .env and team-secrets/private.js; TOKEN=commit-secret';
  changes.files.push({
    path: 'src/TOKEN=change-secret.js',
    status: 'added',
    additions: 1,
    deletions: 0,
    binary: false,
  });
  store.writeProjectJson('sample', 'changes.json', changes);

  const decisions = store.readProjectJson('sample', 'decisions.json');
  decisions.decisions[0].status = 'accepted; PASSWORD=status-secret';
  decisions.warnings[0].message = 'Unable to read; TOKEN=warning-secret';
  store.writeProjectJson('sample', 'decisions.json', decisions);

  const serialized = JSON.stringify(
    builder.getContext('sample', 'authentication secret api PASSWORD=task-secret'),
  );

  assert.doesNotMatch(
    serialized,
    /plain-secret|hidden-secret|commit-secret|db-secret|task-secret|branch-secret|path-secret|working-secret|config-secret|change-secret|status-secret|warning-secret/,
  );
  assert.doesNotMatch(serialized, /team-secrets|\.env/);
  assert.match(serialized, /\[REDACTED\]/);
});

// 한글: current state revision과 changes head가 다르면 충돌 가능성을 warning으로 노출한다.
test('warns when current state and recent changes describe different revisions', (t) => {
  const { builder, store } = fixture(t);
  const changes = store.readProjectJson('sample', 'changes.json');
  changes.head = '2222222222222222222222222222222222222222';
  store.writeProjectJson('sample', 'changes.json', changes);

  const context = builder.getContext('sample', 'authentication');

  assert.deepEqual(context.warnings.at(-1), {
    source: 'consistency',
    message: `Current state revision ${context.project.revision} differs from recent changes head ${changes.head}.`,
  });
});

// 한글: current state가 없으면 sync가 필요하다는 명확한 오류를 반환한다.
test('requires persisted current state before building context', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-context-missing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = createGitRepository(root);
  const store = new KnowledgeStore({ home: join(root, 'doodle-home') });
  const registry = new ProjectRegistry({ store });
  registry.register(repository, { id: 'sample' });
  const builder = new ContextBuilder({ registry, store });

  assert.throws(() => builder.getContext('sample', 'authentication'), /current state.*sync/i);
});
