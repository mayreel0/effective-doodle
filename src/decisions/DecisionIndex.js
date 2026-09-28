import { closeSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { TextDecoder } from 'node:util';

import { SensitivePathFilter } from '../security/SensitivePathFilter.js';

const DECISION_ROOTS = ['adr', 'decisions', 'docs/adr', 'docs/decisions'];
const DEFAULT_MAX_CONTENT_LENGTH = 4_096;

export class DecisionIndex {
  constructor({ store, pathFilter = new SensitivePathFilter(), maxContentLength = DEFAULT_MAX_CONTENT_LENGTH }) {
    if (!store) throw new Error('DecisionIndex requires a KnowledgeStore.');
    if (!Number.isSafeInteger(maxContentLength) || maxContentLength <= 0) {
      throw new Error('maxContentLength must be a positive integer.');
    }
    this.store = store;
    this.pathFilter = pathFilter;
    this.maxContentLength = maxContentLength;
  }

  rebuild(project) {
    assertProject(project);
    this.store.assertExternalToRepository(project.path, project.id);
    const warnings = [];
    const paths = this.#decisionPaths(project.path, warnings);
    const decisions = [];

    for (const path of paths) {
      try {
        const absolutePath = this.pathFilter.resolveSafePath(project.path, path);
        const { text: markdown, truncated } = readBoundedUtf8(absolutePath, this.maxContentLength);
        if (truncated) {
          warnings.push({
            path,
            message: `Decision content exceeded the ${this.maxContentLength}-character scan limit; indexed a bounded prefix.`,
          });
        }
        const title = firstH1(markdown);
        if (title === null) warnings.push({ path, message: 'Decision document has no H1 title.' });
        decisions.push({
          id: basename(path, extname(path)),
          filename: basename(path),
          path,
          title,
          status: decisionStatus(markdown),
          content: this.pathFilter.redactText(markdown).slice(0, this.maxContentLength),
        });
      } catch (error) {
        warnings.push({ path, message: `Unable to read decision document as UTF-8: ${error.message}` });
      }
    }

    decisions.sort((left, right) => compareText(left.path, right.path));
    warnings.sort((left, right) => compareText(left.path, right.path) || compareText(left.message, right.message));
    return this.store.writeProjectJson(project.id, 'decisions.json', {
      projectId: project.id,
      decisions,
      warnings,
    });
  }

  #decisionPaths(repositoryPath, warnings) {
    const paths = [];
    for (const root of DECISION_ROOTS) this.#walk(repositoryPath, root, paths, warnings);
    return paths.sort(compareText);
  }

  #walk(repositoryPath, relativeDirectory, paths, warnings) {
    if (this.pathFilter.isExcluded(relativeDirectory)) return;
    let entries;
    try {
      const lexicalDirectory = join(repositoryPath, relativeDirectory);
      if (lstatSync(lexicalDirectory).isSymbolicLink()) {
        warnings.push({ path: relativeDirectory, message: 'Skipped symbolic link decision directory.' });
        return;
      }
      const directory = this.pathFilter.resolveSafePath(repositoryPath, relativeDirectory);
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      warnings.push({ path: relativeDirectory, message: `Unable to scan decision directory: ${error.message}` });
      return;
    }

    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const path = relative(repositoryPath, join(repositoryPath, relativeDirectory, entry.name)).replaceAll('\\', '/');
      if (entry.isSymbolicLink() && extname(entry.name).toLowerCase() === '.md') {
        warnings.push({ path, message: 'Skipped symbolic link decision document.' });
        continue;
      }
      if (this.pathFilter.isExcluded(path)) continue;
      if (entry.isDirectory()) {
        this.#walk(repositoryPath, path, paths, warnings);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        paths.push(path);
      }
    }
  }
}

function readBoundedUtf8(path, maxContentLength) {
  const maxBytes = maxContentLength * 4;
  const buffer = Buffer.allocUnsafe(maxBytes + 1);
  const descriptor = openSync(path, 'r');
  let bytesRead = 0;
  try {
    while (bytesRead < buffer.length) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
  } finally {
    closeSync(descriptor);
  }

  const hasUnreadBytes = bytesRead > maxBytes;
  const prefix = buffer.subarray(0, Math.min(bytesRead, maxBytes));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decoded = decoder.decode(prefix, hasUnreadBytes ? { stream: true } : undefined);
  return {
    text: decoded.slice(0, maxContentLength),
    truncated: hasUnreadBytes || decoded.length > maxContentLength,
  };
}

function assertProject(project) {
  if (!project || typeof project.id !== 'string' || typeof project.path !== 'string') {
    throw new Error('DecisionIndex requires project metadata with id and path.');
  }
}

function firstH1(markdown) {
  const match = markdown.match(/^#(?!#)\s+(.+?)\s*$/m);
  return match ? normalizeMarkdownValue(match[1].replace(/\s+#+\s*$/, ''), { lowercase: false }) || null : null;
}

function decisionStatus(markdown) {
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const frontmatterStatus = frontmatter?.[1].match(/^\s*status\s*:\s*(.+?)\s*$/im)?.[1];
  if (frontmatterStatus) return normalizeMarkdownValue(frontmatterStatus) || 'unknown';

  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^\s*(?:[-*]\s+)?(?:\*\*|__)?status(?:\*\*|__)?\s*:\s*(.+?)\s*$/i);
    if (inline) return normalizeMarkdownValue(inline[1]) || 'unknown';
    if (/^#{2,6}\s+status\s*#*\s*$/i.test(lines[index])) {
      const value = lines.slice(index + 1).find((line) => line.trim().length > 0 && !/^#/.test(line.trim()));
      return value ? normalizeMarkdownValue(value) || 'unknown' : 'unknown';
    }
  }
  return 'unknown';
}

function normalizeMarkdownValue(value, { lowercase = true } = {}) {
  const normalized = value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/!?\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return lowercase ? normalized.toLowerCase() : normalized;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
