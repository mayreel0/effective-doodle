import { basename } from 'node:path';

import { SensitivePathFilter } from '../security/SensitivePathFilter.js';
import { SCHEMA_VERSION } from '../storage/KnowledgeStore.js';

const SOURCE_PRECEDENCE = [
  'machine-readable-config',
  'current-source-code',
  'explicit-decisions',
  'readme-and-docs',
  'derived-knowledge',
];

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
  '가',
  '과',
  '그리고',
  '는',
  '대한',
  '또는',
  '를',
  '수정',
  '에',
  '에서',
  '와',
  '은',
  '을',
  '이',
  '작업',
  '및',
  '위한',
]);

export class ContextBuilder {
  constructor({ registry, store, pathFilter = new SensitivePathFilter(), clock = () => new Date() }) {
    if (!registry) throw new Error('ContextBuilder requires a ProjectRegistry.');
    if (!store) throw new Error('ContextBuilder requires a KnowledgeStore.');
    this.registry = registry;
    this.store = store;
    this.pathFilter = pathFilter;
    this.clock = clock;
  }

  getContext(projectId, task) {
    if (typeof task !== 'string') throw new Error('Task context requires task text.');
    const project = this.registry.get(projectId);
    this.store.assertExternalToRepository(project.path, projectId);
    const current = this.store.readProjectJson(projectId, 'current.json');
    if (current === null) {
      throw new Error(`Project '${projectId}' has no current state; run sync before building context.`);
    }

    const safeTask = this.pathFilter.redactText(task);
    const taskTokens = tokenize(safeTask);
    const changes = this.store.readProjectJson(projectId, 'changes.json');
    const decisionIndex = this.store.readProjectJson(projectId, 'decisions.json') ?? {
      decisions: [],
      warnings: [],
    };
    const rankedDecisions = rankDecisions(
      decisionIndex.decisions ?? [],
      taskTokens,
      this.pathFilter,
    );
    const relevantDecisions = rankedDecisions.map(({ sourcePath, ...decision }) => decision);
    const { workingTree, ...currentState } = sanitizeCurrentState(current, this.pathFilter);
    const warnings = sanitizeWarnings(decisionIndex.warnings ?? [], this.pathFilter);
    if (changes !== null && changes.head !== current.revision) {
      warnings.push({
        source: 'consistency',
        message: `Current state revision ${current.revision} differs from recent changes head ${changes.head}.`,
      });
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: asIsoTimestamp(this.clock()),
      task: { text: safeTask, tokens: taskTokens },
      project: {
        id: project.id,
        path: project.path,
        revision: current.revision,
      },
      currentState,
      workingTree,
      recentChanges: sanitizeChanges(changes, this.pathFilter),
      relevantDecisions,
      relevantConfiguration: rankConfiguration(current.facts?.config ?? [], taskTokens, this.pathFilter),
      knownConstraints: extractConstraints(
        rankedDecisions.map((decision) => decision.sourcePath),
        decisionIndex.decisions ?? [],
        this.pathFilter,
      ),
      sourcePrecedence: [...SOURCE_PRECEDENCE],
      warnings,
    };
  }
}

function rankDecisions(decisions, taskTokens, pathFilter) {
  if (taskTokens.length === 0) return [];
  return decisions
    .filter((decision) => isAllowedPath(pathFilter, decision.path))
    .map((decision) => {
      const fields = [
        { value: decision.filename, weight: 4 },
        { value: decision.title, weight: 3 },
        { value: decision.content, weight: 1 },
      ].map((field) => ({
        tokens: new Set(tokenize(field.value ?? '', { removeStopwords: false })),
        weight: field.weight,
      }));
      const matchedTerms = [];
      let score = 0;
      for (const term of taskTokens) {
        let matched = false;
        for (const field of fields) {
          if (field.tokens.has(term)) {
            score += field.weight;
            matched = true;
          }
        }
        if (matched) matchedTerms.push(term);
      }
      return {
        sourcePath: decision.path,
        id: pathFilter.redactText(String(decision.id ?? '')),
        filename: sanitizeOutputPath(decision.filename, pathFilter),
        path: sanitizeOutputPath(decision.path, pathFilter),
        title: decision.title === null ? null : pathFilter.redactText(String(decision.title)),
        status: pathFilter.redactText(String(decision.status ?? 'unknown')),
        score,
        matchedTerms,
      };
    })
    .filter((decision) => decision.score > 0)
    .sort((left, right) => right.score - left.score || compareText(left.path, right.path));
}

function rankConfiguration(paths, taskTokens, pathFilter) {
  if (taskTokens.length === 0) return [];
  return paths
    .filter((path) => isAllowedPath(pathFilter, path))
    .map((path) => {
      const pathTokens = tokenize(basename(path), { removeStopwords: false });
      const matchedTerms = taskTokens.filter((term) => pathTokens.includes(term));
      return {
        path: sanitizeOutputPath(path, pathFilter),
        score: matchedTerms.length * 2,
        matchedTerms,
      };
    })
    .filter((config) => config.score > 0)
    .sort((left, right) => right.score - left.score || compareText(left.path, right.path));
}

function extractConstraints(relevantPaths, allDecisions, pathFilter) {
  const relevantPathSet = new Set(relevantPaths);
  const constraints = [];
  for (const decision of allDecisions) {
    if (
      !isAllowedPath(pathFilter, decision.path) ||
      !relevantPathSet.has(decision.path) ||
      typeof decision.content !== 'string'
    ) continue;
    const lines = decision.content.split(/\r?\n/);
    let insideFence = false;
    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      if (/^\s*```/.test(rawLine)) {
        insideFence = !insideFence;
        continue;
      }
      if (insideFence) continue;
      const line = rawLine.replace(/^\s*(?:[-*+]\s+|>\s*)/, '').trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      const labeled = line.match(/^(?:constraints?|제약(?:사항)?)\s*:\s*(.+)$/i);
      const isNormative = /\b(?:must|shall|required|prohibited)\b/i.test(line) ||
        /(?:반드시|금지|해야\s*한다|해서는\s*안)/.test(line);
      if (!labeled && !isNormative) continue;
      const text = redactContextText(labeled?.[1] ?? line, pathFilter).slice(0, 500);
      constraints.push({
        sourcePath: sanitizeOutputPath(decision.path, pathFilter),
        line: index + 1,
        text,
      });
    }
  }
  return constraints.sort(
    (left, right) => compareText(left.sourcePath, right.sourcePath) || left.line - right.line,
  );
}

function sanitizeCurrentState(current, pathFilter) {
  const repository = {
    ...current.repository,
    branch: pathFilter.redactText(String(current.repository?.branch ?? '')),
    committed: filterPaths(current.repository?.committed ?? [], pathFilter),
  };
  const workingTree = Object.fromEntries(
    Object.entries(current.workingTree ?? {}).map(([state, paths]) => [
      state,
      filterPaths(paths, pathFilter),
    ]),
  );
  const facts = sanitizeFacts(current.facts, pathFilter);
  return { ...current, repository, workingTree, facts };
}

function sanitizeFacts(facts, pathFilter) {
  if (!facts) return facts;
  const documentation = facts.documentation
    ? Object.fromEntries(
        Object.entries(facts.documentation).map(([kind, paths]) => [
          kind,
          filterPaths(paths, pathFilter),
        ]),
      )
    : facts.documentation;
  return {
    ...facts,
    directories: filterPaths(facts.directories ?? [], pathFilter),
    manifests: filterPaths(facts.manifests ?? [], pathFilter),
    config: filterPaths(facts.config ?? [], pathFilter),
    documentation,
  };
}

function sanitizeChanges(changes, pathFilter) {
  if (changes === null) return null;
  return {
    ...changes,
    commits: (changes.commits ?? []).map((commit) => ({
      ...commit,
      message: redactContextText(commit.message ?? '', pathFilter),
    })),
    files: (changes.files ?? [])
      .filter((file) => isAllowedPath(pathFilter, file.path))
      .map((file) => {
        const safeFile = {
          ...file,
          path: sanitizeOutputPath(file.path, pathFilter),
        };
        if (file.previousPath) {
          if (isAllowedPath(pathFilter, file.previousPath)) {
            safeFile.previousPath = sanitizeOutputPath(file.previousPath, pathFilter);
          } else {
            delete safeFile.previousPath;
            if (safeFile.status === 'renamed' || safeFile.status === 'copied') {
              safeFile.status = 'added';
            }
          }
        }
        return safeFile;
      }),
  };
}

function sanitizeWarnings(warnings, pathFilter) {
  return warnings
    .filter((warning) => isAllowedPath(pathFilter, warning.path))
    .map((warning) => ({
      source: 'decisions',
      path: sanitizeOutputPath(warning.path, pathFilter),
      message: redactContextText(warning.message ?? '', pathFilter),
    }))
    .sort((left, right) => compareText(left.path, right.path) || compareText(left.message, right.message));
}

function filterPaths(paths, pathFilter) {
  return paths
    .filter((path) => isAllowedPath(pathFilter, path))
    .map((path) => sanitizeOutputPath(path, pathFilter));
}

function sanitizeOutputPath(path, pathFilter) {
  return pathFilter.redactText(String(path));
}

function redactContextText(value, pathFilter) {
  const redacted = pathFilter.redactText(String(value));
  return redacted.replace(/\S+/g, (token) => {
    const candidate = token.replace(/^[('"`\[<{]+|[),;:'"`\]>}]+$/g, '');
    if (candidate.length === 0 || isAllowedPath(pathFilter, candidate)) return token;
    return token.replace(candidate, '[EXCLUDED]');
  });
}

function isAllowedPath(pathFilter, path) {
  try {
    return typeof path === 'string' && !pathFilter.isExcluded(path);
  } catch {
    return false;
  }
}

function tokenize(value, { removeStopwords = true } = {}) {
  const tokens = String(value)
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  const filtered = removeStopwords ? tokens.filter((token) => !STOPWORDS.has(token)) : tokens;
  return [...new Set(filtered)].sort(compareText);
}

function asIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid generatedAt timestamp: ${value}`);
  return date.toISOString();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
