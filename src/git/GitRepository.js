import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

export class GitRepository {
  constructor(path) {
    const inputPath = typeof path === 'string' ? path : path?.path;
    if (typeof inputPath !== 'string' || inputPath.length === 0) {
      throw new Error('Git repository path must be a non-empty string.');
    }
    const root = runGit(inputPath, ['rev-parse', '--show-toplevel'], { context: inputPath }).stdout.trim();
    this.root = realpathSync(root);
  }

  branch() {
    const result = runGit(this.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      allowedStatuses: [1],
      context: 'HEAD',
    });
    if (result.status === 1) {
      const head = this.head();
      throw new Error(`Cannot determine branch for detached HEAD at ${head}.`);
    }
    return result.stdout.trim();
  }

  head(ref = 'HEAD') {
    assertRef(ref);
    return runGit(this.root, ['rev-parse', '--verify', `${ref}^{commit}`], { context: `ref ${ref}` }).stdout.trim();
  }

  committedFiles(ref = 'HEAD') {
    assertRef(ref);
    const output = runGit(this.root, ['ls-tree', '-r', '-z', '--name-only', ref], {
      context: `ref ${ref}`,
    }).stdout;
    return sortPaths(splitNull(output));
  }

  workingTree() {
    const output = runGit(this.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      context: 'working tree',
    }).stdout;
    const entries = splitNull(output);
    const state = { staged: [], modified: [], untracked: [], deleted: [] };

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const x = entry[0];
      const y = entry[1];
      const path = entry.slice(3);
      if (x === '?' && y === '?') {
        state.untracked.push(path);
        continue;
      }
      if (x !== ' ') state.staged.push(path);
      if (y !== ' ' && y !== 'D') state.modified.push(path);
      if (x === 'D' || y === 'D') state.deleted.push(path);
      if (x === 'R' || x === 'C' || y === 'R' || y === 'C') index += 1;
    }

    return Object.fromEntries(Object.entries(state).map(([key, paths]) => [key, sortPaths(paths)]));
  }

  revision() {
    return {
      branch: this.branch(),
      head: this.head(),
      committed: this.committedFiles(),
      workingTree: this.workingTree(),
    };
  }

  visibleFiles() {
    const output = runGit(this.root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      context: 'repository files',
    }).stdout;
    const paths = sortPaths(splitNull(output));
    const ignored = this.ignoredPaths(paths);
    return paths.filter((path) => !ignored.has(path));
  }

  ignoredPaths(paths) {
    if (paths.length === 0) return new Set();
    const result = runGit(this.root, ['check-ignore', '--no-index', '-z', '--stdin'], {
      allowedStatuses: [1],
      context: 'repository paths',
      input: `${paths.join('\0')}\0`,
    });
    return new Set(splitNull(result.stdout));
  }
}

function runGit(repository, args, { allowedStatuses = [], context, input } = {}) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw gitError(args, context, result.error.message, result.error);
  }
  if (result.status !== 0 && !allowedStatuses.includes(result.status)) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    throw gitError(args, context, detail);
  }
  return result;
}

function gitError(args, context, detail, cause) {
  const command = `git ${args.join(' ')}`;
  const suffix = context ? ` (${context})` : '';
  return new Error(`Git command failed: ${command}${suffix}: ${detail}`, cause ? { cause } : undefined);
}

function assertRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || /[\0\r\n]/.test(ref)) {
    throw new Error(`Invalid Git ref: ${ref}`);
  }
}

function splitNull(value) {
  return value.split('\0').filter(Boolean);
}

function sortPaths(paths) {
  return [...new Set(paths)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
