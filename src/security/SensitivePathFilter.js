import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build']);
const SECRET_QUERY_NAME = '(?:api[-_]?key|access[-_]?(?:key|token)|private[-_]?key|client[-_]?secret|database[-_]?url|authorization|password|passwd|credential|secret|token)';
const SECRET_QUERY_PARAMETER = new RegExp(`([?&#]${SECRET_QUERY_NAME}=)([^&#\\s"']*)`, 'gi');
const CREDENTIAL_USERINFO = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/@\s"']+)@/g;
const ASSIGNMENT = /^(?<leading>\s*(?:(?:export\s+)?(?:const|let|var)\s+|export\s+)?)(?<quote>["']?)(?<key>[A-Za-z][A-Za-z0-9_.-]*)\k<quote>(?<separator>\s*[:=]\s*)(?<value>.*)$/;

export class SensitivePathFilter {
  isExcluded(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (normalized === '.') return false;

    return normalized.split('/').some((segment) => {
      const name = segment.toLowerCase();
      return (
        EXCLUDED_DIRECTORIES.has(name) ||
        name === '.env' ||
        name.startsWith('.env.') ||
        name.endsWith('.pem') ||
        name.endsWith('.key') ||
        name.startsWith('credentials') ||
        name.startsWith('secrets')
      );
    });
  }

  resolveSafePath(repositoryRoot, relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    const repository = realpathSync(repositoryRoot);
    const candidate = physicalPath(resolve(repository, normalized));

    if (!isSameOrDescendant(repository, candidate)) {
      throw new Error(`Path resolves outside repository: ${relativePath}`);
    }

    return candidate;
  }

  redactText(text) {
    assertText(text);
    const redactedAssignments = text
      .split('\n')
      .map((line) => redactAssignment(line))
      .join('\n');

    return redactCredentialUrls(redactJsonProperties(redactedAssignments));
  }

  extractSecretKeys(text) {
    assertText(text);
    const keys = new Set();

    for (const line of text.split('\n')) {
      const assignment = parseAssignment(line);
      if (!assignment) continue;
      if (isSecretKey(assignment.key) || containsCredentialUrl(assignment.value)) {
        keys.add(assignment.key);
      }
    }

    for (const match of text.matchAll(/(["'])([A-Za-z][A-Za-z0-9_.-]*)\1\s*:\s*(["'])((?:\\[\s\S]|(?!\3)[\s\S])*)\3/g)) {
      if (isSecretKey(match[2]) || containsCredentialUrl(match[4])) keys.add(match[2]);
    }
    for (const match of text.matchAll(/(["'])([A-Za-z][A-Za-z0-9_.-]*)\1\s*:\s*(-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null))(?=\s*[,}])/g)) {
      if (isSecretKey(match[2])) keys.add(match[2]);
    }

    return [...keys].sort((left, right) => left.localeCompare(right, 'en'));
  }
}

function normalizeRelativePath(path) {
  if (typeof path !== 'string' || path.includes('\0')) {
    throw new Error('Path must be a repository-relative string.');
  }

  const portable = path.replaceAll('\\', '/');
  if (isAbsolute(path) || portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)) {
    throw new Error(`Path must be repository-relative: ${path}`);
  }

  const segments = [];
  for (const segment of portable.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) throw new Error(`Path must be repository-relative: ${path}`);
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join('/') || '.';
}

function physicalPath(path) {
  const missing = [];
  let candidate = path;
  while (true) {
    try {
      return join(realpathSync(candidate), ...missing);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        if (lstatSync(candidate).isSymbolicLink()) {
          throw new Error(`Cannot safely resolve dangling symbolic link: ${candidate}`);
        }
      } catch (lstatError) {
        if (lstatError.code !== 'ENOENT') throw lstatError;
      }
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(path);
      missing.unshift(candidate.slice(parent.length + 1));
      candidate = parent;
    }
  }
}

function isSameOrDescendant(ancestor, candidate) {
  return candidate === ancestor || candidate.startsWith(`${ancestor}${sep}`);
}

function redactAssignment(line) {
  const assignment = parseAssignment(line);
  if (!assignment || !isSecretKey(assignment.key)) return line;
  return `${assignment.prefix}${redactAssignedValue(assignment.value)}`;
}

function parseAssignment(line) {
  const match = line.match(ASSIGNMENT);
  if (!match) return null;
  if (match.groups.separator.trim() === ':' && match.groups.value.startsWith('//')) return null;
  return {
    key: match.groups.key,
    prefix: `${match.groups.leading}${match.groups.quote}${match.groups.key}${match.groups.quote}${match.groups.separator}`,
    value: match.groups.value,
  };
}

function isSecretKey(key) {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.-]/g, '_')
    .toLowerCase();
  return /(?:^|_)(?:api_?key|access_?key|private_?key|client_secret|password|passwd|authorization|credential|database_url|secret|token)(?:_|$)/.test(
    normalized,
  );
}

function redactAssignedValue(value) {
  const quoted = value.match(/^(["'])(.*)\1(\s*[,;]?\s*)$/);
  if (quoted) return `${quoted[1]}[REDACTED]${quoted[1]}${quoted[3]}`;
  const punctuation = value.match(/([,;]\s*)$/)?.[1] ?? '';
  return `[REDACTED]${punctuation}`;
}

function redactCredentialUrls(text) {
  return text
    .replace(CREDENTIAL_USERINFO, '$1[REDACTED]@')
    .replace(SECRET_QUERY_PARAMETER, '$1[REDACTED]');
}

function redactJsonProperties(text) {
  const quoted = text.replace(
    /(["'])([A-Za-z][A-Za-z0-9_.-]*)\1(\s*:\s*)(["'])((?:\\[\s\S]|(?!\4)[\s\S])*)\4/g,
    (property, keyQuote, key, separator, valueQuote) =>
      isSecretKey(key) ? `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}` : property,
  );
  return quoted.replace(
    /(["'])([A-Za-z][A-Za-z0-9_.-]*)\1(\s*:\s*)(-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null))(?=\s*[,}])/g,
    (property, keyQuote, key, separator) =>
      isSecretKey(key) ? `${keyQuote}${key}${keyQuote}${separator}"[REDACTED]"` : property,
  );
}

function containsCredentialUrl(value) {
  const userinfo = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@\s"']+@/;
  const secretQuery = new RegExp(`[?&#]${SECRET_QUERY_NAME}=[^&#\\s"']*`, 'i');
  return userinfo.test(value) || secretQuery.test(value);
}

function assertText(text) {
  if (typeof text !== 'string') throw new TypeError('Sensitive content must be a string.');
}
