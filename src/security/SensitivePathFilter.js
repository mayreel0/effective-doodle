import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build']);
const SECRET_QUERY_NAME = '(?:api[-_]?key|access[-_]?(?:key|token)|private[-_]?key|client[-_]?secret|database[-_]?url|authorization|password|passwd|credential|secret|token)';
const SECRET_QUERY_PARAMETER = new RegExp(`([?&#]${SECRET_QUERY_NAME}=)([^&#\\s"']*)`, 'gi');
const CREDENTIAL_USERINFO = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/@\s"']+)@/g;

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
        hasSensitiveNameToken(segment)
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
    return redactCredentialUrls(redactAssignments(text));
  }

  extractSecretKeys(text) {
    assertText(text);
    const keys = new Set();

    for (const assignment of scanAssignments(text)) {
      if (isSecretKey(assignment.key) || containsCredentialUrl(assignment.value)) keys.add(assignment.key);
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
  const descendantPrefix = ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`;
  return candidate === ancestor || candidate.startsWith(descendantPrefix);
}

function hasSensitiveNameToken(name) {
  const normalized = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
  return /(?:^|[._-])(?:secrets?|credentials?)(?=[._-]|$)/.test(normalized);
}

function redactAssignments(text) {
  const assignments = scanAssignments(text).filter((assignment) => isSecretKey(assignment.key));
  let redacted = '';
  let cursor = 0;

  for (const assignment of assignments) {
    redacted += text.slice(cursor, assignment.redactionStart);
    redacted += assignment.replacement;
    cursor = assignment.redactionEnd;
  }

  return `${redacted}${text.slice(cursor)}`;
}

function scanAssignments(text) {
  const assignments = [];
  let index = 0;

  while (index < text.length) {
    const key = readKey(text, index);
    if (!key.value) {
      index = key.next;
      continue;
    }

    let separatorIndex = skipWhitespace(text, key.end);
    const separator = text[separatorIndex];
    if (separator !== '=' && separator !== ':') {
      index = key.end;
      continue;
    }

    const valueStart = skipWhitespace(text, separatorIndex + 1);
    if (isUrlScheme(key.value, separator, text.slice(valueStart))) {
      index = findUrlEnd(text, valueStart);
      continue;
    }

    const value = readValue(text, valueStart, key.quoted && separator === ':');
    assignments.push({
      key: key.value,
      value: text.slice(valueStart, value.end),
      redactionStart: value.redactionStart,
      redactionEnd: value.redactionEnd,
      replacement: value.replacement,
    });
    index = isSecretKey(key.value) ? Math.max(value.end, key.end) : Math.max(valueStart, key.end);
  }

  return assignments;
}

function readKey(text, index) {
  const character = text[index];
  if (character === '"' || character === "'") {
    const end = findQuotedEnd(text, index, character);
    if (end === -1) return { value: null, next: text.length };
    const value = text.slice(index + 1, end);
    return isKey(value)
      ? { value, quoted: true, end: end + 1, next: end + 1 }
      : { value: null, next: end + 1 };
  }

  if (!/[A-Za-z]/.test(character) || (index > 0 && /[A-Za-z0-9_.-]/.test(text[index - 1]))) {
    return { value: null, next: index + 1 };
  }

  let end = index + 1;
  while (end < text.length && /[A-Za-z0-9_.-]/.test(text[end])) end += 1;
  return { value: text.slice(index, end), quoted: false, end, next: end };
}

function readValue(text, start, jsonScalar) {
  const quote = text[start];
  if (quote === '"' || quote === "'" || quote === '`') {
    const closingQuote = findQuotedEnd(text, start, quote);
    const contentEnd = closingQuote === -1 ? text.length : closingQuote;
    return {
      end: closingQuote === -1 ? text.length : closingQuote + 1,
      redactionStart: start + 1,
      redactionEnd: contentEnd,
      replacement: '[REDACTED]',
    };
  }

  const end = findUnquotedEnd(text, start);
  let contentEnd = end;
  while (contentEnd > start && /\s/.test(text[contentEnd - 1])) contentEnd -= 1;
  return {
    end,
    redactionStart: start,
    redactionEnd: contentEnd,
    replacement: jsonScalar ? '"[REDACTED]"' : '[REDACTED]',
  };
}

function findUnquotedEnd(text, start) {
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let index = start;

  while (index < text.length) {
    const character = text[index];
    if (character === '"' || character === "'" || character === '`') {
      const quotedEnd = findQuotedEnd(text, index, character);
      if (quotedEnd === -1) return text.length;
      index = quotedEnd + 1;
      continue;
    }
    if (character === '(') parentheses += 1;
    else if (character === ')' && parentheses > 0) parentheses -= 1;
    else if (character === '[') brackets += 1;
    else if (character === ']' && brackets > 0) brackets -= 1;
    else if (character === '{') braces += 1;
    else if (character === '}' && braces > 0) braces -= 1;
    else if (parentheses === 0 && brackets === 0 && braces === 0 && /[;,\r\n}]/.test(character)) break;
    index += 1;
  }

  return index;
}

function findQuotedEnd(text, start, quote) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (quote === '`' && text[index] === '$' && text[index + 1] === '{') {
      const expressionEnd = findTemplateExpressionEnd(text, index + 2);
      if (expressionEnd === -1) return -1;
      index = expressionEnd + 1;
      continue;
    }
    if (text[index] === quote) return index;
    index += 1;
  }
  return -1;
}

function findTemplateExpressionEnd(text, start) {
  let depth = 1;
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (character === '"' || character === "'" || character === '`') {
      const quotedEnd = findQuotedEnd(text, index, character);
      if (quotedEnd === -1) return -1;
      index = quotedEnd + 1;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
}

function skipWhitespace(text, start) {
  let index = start;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function findUrlEnd(text, start) {
  let index = start;
  while (index < text.length && !/\s/.test(text[index])) index += 1;
  return index;
}

function isKey(value) {
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value);
}

function isUrlScheme(key, separator, value) {
  return separator === ':' && value.startsWith('//') && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(key);
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

function redactCredentialUrls(text) {
  return text
    .replace(CREDENTIAL_USERINFO, '$1[REDACTED]@')
    .replace(SECRET_QUERY_PARAMETER, '$1[REDACTED]');
}

function containsCredentialUrl(value) {
  const userinfo = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@\s"']+@/;
  const secretQuery = new RegExp(`[?&#]${SECRET_QUERY_NAME}=[^&#\\s"']*`, 'i');
  return userinfo.test(value) || secretQuery.test(value);
}

function assertText(text) {
  if (typeof text !== 'string') throw new TypeError('Sensitive content must be a string.');
}
