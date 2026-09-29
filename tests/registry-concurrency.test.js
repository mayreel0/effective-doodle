import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createGitRepository } from './helpers/git-fixture.js';
import { ProjectRegistry } from '../src/projects/ProjectRegistry.js';
import { KnowledgeStore } from '../src/storage/KnowledgeStore.js';
import lockfile from 'proper-lockfile';

const worker = new URL('./helpers/registry-worker.js', import.meta.url);

function runWorker(home, operation, repo, id, barrier) {
  const child = spawn(process.execPath, [worker.pathname, home, operation, repo, id, barrier ?? ''], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr })));
  return { child, done };
}

async function waitFor(path) {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Worker never reached barrier: ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function raceWithPausedWriter(t, first, second, { initialAlpha = false, secondId = 'beta', samePath = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doodle-registry-race-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const repoA = createGitRepository(root, 'source-a');
  const repoB = createGitRepository(root, 'source-b');
  if (initialAlpha) new ProjectRegistry({ store: new KnowledgeStore({ home }) }).register(repoA, { id: 'alpha' });
  const barrier = join(root, 'barrier');
  mkdirSync(barrier);
  const a = runWorker(home, first, repoA, 'alpha', barrier);
  t.after(() => a.child.kill());
  await waitFor(join(barrier, 'ready'));
  const b = runWorker(home, second, samePath ? repoA : repoB, secondId);
  t.after(() => b.child.kill());
  // Allow an unprotected second writer to complete before the first writer resumes.
  await Promise.race([b.done, new Promise((resolve) => setTimeout(resolve, 1000))]);
  writeFileSync(join(barrier, 'release'), 'go');
  return { home, a: await a.done, b: await b.done };
}

test('concurrent registrations of distinct repositories retain both entries', async (t) => {
  const { home, a, b } = await raceWithPausedWriter(t, 'register', 'register');
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const persisted = JSON.parse(readFileSync(join(home, 'registry.json'), 'utf8'));
  assert.deepEqual(persisted.projects.map((entry) => entry.id), ['alpha', 'beta']);
});

test('concurrent registration of the same repository rejects the duplicate path', async (t) => {
  const { home, a, b } = await raceWithPausedWriter(t, 'register', 'register', { samePath: true });
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 1);
  assert.match(b.stderr, /path is already registered/i);
  const persisted = JSON.parse(readFileSync(join(home, 'registry.json'), 'utf8'));
  assert.deepEqual(persisted.projects.map((entry) => entry.id), ['alpha']);
  assert.equal(existsSync(join(home, 'projects', 'beta')), false);
});

test('concurrent registration of the same ID rejects the duplicate ID', async (t) => {
  const { home, a, b } = await raceWithPausedWriter(t, 'register', 'register', { secondId: 'alpha' });
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 1);
  assert.match(b.stderr, /already registered/i);
  const persisted = JSON.parse(readFileSync(join(home, 'registry.json'), 'utf8'));
  assert.deepEqual(persisted.projects.map((entry) => entry.id), ['alpha']);
});

test('concurrent unregister and register leave registry and active directories aligned', async (t) => {
  const { home, a, b } = await raceWithPausedWriter(t, 'unregister', 'register', { initialAlpha: true });
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const persisted = JSON.parse(readFileSync(join(home, 'registry.json'), 'utf8'));
  assert.deepEqual(persisted.projects.map((entry) => entry.id), ['beta']);
  assert.equal(existsSync(join(home, 'projects', 'alpha')), false);
  assert.equal(existsSync(join(home, 'projects', 'beta', 'project.json')), true);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'doodle-registry-crash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const barrier = join(root, 'barrier');
  mkdirSync(barrier);
  return { root, home, barrier, registry: new ProjectRegistry({ store: new KnowledgeStore({ home }) }) };
}

function ageCrashedLock(home) {
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(home, '.registry.lock'), old, old);
}

test('a crashed registration can be recovered without leaving orphan metadata', async (t) => {
  const { root, home, barrier, registry } = fixture(t);
  const repo = createGitRepository(root, 'source');
  const worker = runWorker(home, 'register', repo, 'alpha', barrier);
  t.after(() => worker.child.kill());
  await waitFor(join(barrier, 'ready'));
  worker.child.kill('SIGKILL');
  await worker.done;
  ageCrashedLock(home);

  registry.register(repo, { id: 'alpha' });

  assert.deepEqual(registry.list().map((entry) => entry.id), ['alpha']);
  assert.equal(existsSync(join(home, 'projects', 'alpha', 'project.json')), true);
});

test('a crashed unregistration restores active metadata before the next update', async (t) => {
  const { root, home, barrier, registry } = fixture(t);
  const repoA = createGitRepository(root, 'source-a');
  const repoB = createGitRepository(root, 'source-b');
  registry.register(repoA, { id: 'alpha' });
  const worker = runWorker(home, 'unregister', repoA, 'alpha', barrier);
  t.after(() => worker.child.kill());
  await waitFor(join(barrier, 'ready'));
  worker.child.kill('SIGKILL');
  await worker.done;
  ageCrashedLock(home);

  assert.equal(registry.get('alpha').path, realpathSync(repoA));
  registry.register(repoB, { id: 'beta' });

  assert.deepEqual(registry.list().map((entry) => entry.id), ['alpha', 'beta']);
  assert.equal(existsSync(join(home, 'projects', 'alpha', 'project.json')), true);
});

test('a committed unregistration is retained and its staged data is cleaned after a crash', async (t) => {
  const { root, home, registry } = fixture(t);
  const repoA = createGitRepository(root, 'source-a');
  const repoB = createGitRepository(root, 'source-b');
  registry.register(repoA, { id: 'alpha' });
  const worker = runWorker(home, 'unregister', repoA, 'alpha', 'crash-after-write');
  t.after(() => worker.child.kill());
  const result = await worker.done;
  assert.equal(result.code, null);
  ageCrashedLock(home);

  assert.deepEqual(registry.list(), []);
  registry.register(repoB, { id: 'beta' });

  assert.deepEqual(registry.list().map((entry) => entry.id), ['beta']);
  assert.equal(existsSync(join(home, 'projects', 'alpha')), false);
  assert.equal(existsSync(join(home, 'registry-transaction.json')), false);
  assert.equal(existsSync(join(home, 'staged-removals')) ? readdirSync(join(home, 'staged-removals')).length : 0, 0);
});

test('a committed registration is retained after a crash before journal cleanup', async (t) => {
  const { root, home, registry } = fixture(t);
  const repo = createGitRepository(root, 'source');
  const worker = runWorker(home, 'register', repo, 'alpha', 'crash-after-write');
  t.after(() => worker.child.kill());
  const result = await worker.done;
  assert.equal(result.code, null);
  ageCrashedLock(home);

  assert.equal(registry.get('alpha').path, realpathSync(repo));
  assert.equal(existsSync(join(home, 'projects', 'alpha', 'project.json')), true);
  assert.equal(existsSync(join(home, 'registry-transaction.json')), false);
});

test('a live synchronous operation keeps its lock fresh while another process waits', async (t) => {
  const { root, home } = fixture(t);
  const marker = join(root, 'acquired');
  const store = new KnowledgeStore({ home, registryLockStaleMs: 2000 });
  let contender;
  store.withRegistryLock(() => {
    contender = runWorker(home, 'claim-lock', marker, 'unused');
    t.after(() => contender.child.kill());
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3200);
    assert.equal(existsSync(marker), false, 'contender stole a live registry lock');
  });
  const result = await contender.done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(marker), true);
});

test('a live registry lock times out without changing registry or metadata', (t) => {
  const { root, home, registry } = fixture(t);
  const repo = createGitRepository(root, 'source');
  mkdirSync(home);
  const release = lockfile.lockSync(home, { lockfilePath: join(home, '.registry.lock'), stale: 30_000 });
  try {
    assert.throws(() => registry.register(repo, { id: 'alpha' }), /Timed out waiting for the project registry lock/);
  } finally {
    release();
  }
  assert.equal(existsSync(join(home, 'registry.json')), false);
  assert.equal(existsSync(join(home, 'projects', 'alpha')), false);
});
