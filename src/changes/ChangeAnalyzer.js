import { execFileSync } from 'node:child_process';

export class GitAnalysisError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'GitAnalysisError';
  }
}

export class InvalidGitRefError extends GitAnalysisError {
  constructor(ref, options) {
    super(`Invalid Git ref: ${ref}`, options);
    this.name = 'InvalidGitRefError';
    this.ref = ref;
  }
}

export class ChangeAnalyzer {
  analyze(repositoryPath, { since }) {
    assertRepository(repositoryPath);
    const base = resolveRef(repositoryPath, since);
    const head = resolveHead(repositoryPath);
    const commits = parseCommits(
      runGit(repositoryPath, ['log', '-z', '--format=%H%x00%s', `${base}..${head}`, '--']),
    );
    const statuses = parseNameStatuses(
      runGit(repositoryPath, ['diff', '--name-status', '-z', '-M', '--no-ext-diff', base, head, '--']),
    );
    const statistics = parseNumstat(
      runGit(repositoryPath, ['diff', '--numstat', '-z', '-M', '--no-ext-diff', base, head, '--']),
    );

    return {
      base,
      head,
      commits,
      files: statuses.map((file) => ({ ...file, ...statistics.get(file.path) })),
    };
  }
}

function assertRepository(repositoryPath) {
  try {
    runGit(repositoryPath, ['rev-parse', '--git-dir']);
  } catch (error) {
    throw new GitAnalysisError(`Unable to access Git repository: ${repositoryPath}`, { cause: error });
  }
}

function resolveRef(repositoryPath, ref) {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new InvalidGitRefError(String(ref));
  }
  try {
    return runGit(repositoryPath, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  } catch (error) {
    throw new InvalidGitRefError(ref, { cause: error });
  }
}

function resolveHead(repositoryPath) {
  try {
    return runGit(repositoryPath, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  } catch (error) {
    throw new GitAnalysisError('Unable to resolve Git HEAD.', { cause: error });
  }
}

function runGit(repositoryPath, args) {
  try {
    return execFileSync('git', ['-C', repositoryPath, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const detail = stderr || error.message || `exit status ${error.status}`;
    throw new GitAnalysisError(`Git command failed: git ${args[0]}: ${detail}`, { cause: error });
  }
}

function parseCommits(output) {
  if (output.length === 0) return [];
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const commits = [];
  for (let index = 0; index < fields.length; index += 2) {
    commits.push({ sha: fields[index], message: fields[index + 1] });
  }
  return commits;
}

function parseNameStatuses(output) {
  const fields = nulFields(output);
  const files = [];
  for (let index = 0; index < fields.length; ) {
    const code = fields[index++];
    if (code.startsWith('R') || code.startsWith('C')) {
      const previousPath = fields[index++];
      const path = fields[index++];
      files.push({ path, previousPath, status: statusName(code) });
    } else {
      files.push({ path: fields[index++], status: statusName(code) });
    }
  }
  return files;
}

function parseNumstat(output) {
  const fields = nulFields(output);
  const statistics = new Map();
  for (let index = 0; index < fields.length; ) {
    const header = fields[index++];
    const firstSeparator = header.indexOf('\t');
    const secondSeparator = header.indexOf('\t', firstSeparator + 1);
    const added = header.slice(0, firstSeparator);
    const deleted = header.slice(firstSeparator + 1, secondSeparator);
    const pathInHeader = header.slice(secondSeparator + 1);
    let path = pathInHeader;
    if (path === '') {
      index += 1;
      path = fields[index++];
    }
    const binary = added === '-' || deleted === '-';
    statistics.set(path, {
      additions: binary ? null : Number(added),
      deletions: binary ? null : Number(deleted),
      binary,
    });
  }
  return statistics;
}

function nulFields(output) {
  if (output.length === 0) return [];
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  return fields;
}

function statusName(code) {
  return {
    A: 'added',
    C: 'copied',
    D: 'deleted',
    M: 'modified',
    R: 'renamed',
    T: 'type-changed',
    U: 'unmerged',
    X: 'unknown',
  }[code[0]] ?? 'unknown';
}
