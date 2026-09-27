import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

export function createGitRepository(root, name = 'sample-project') {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'doodle@example.test']);
  git(repo, ['config', 'user.name', 'Doodle Test']);
  writeFileSync(join(repo, 'README.md'), '# Sample Project\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'initial commit']);
  return repo;
}
