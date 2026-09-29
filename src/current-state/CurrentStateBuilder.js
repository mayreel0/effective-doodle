import { basename } from 'node:path';

import { SensitivePathFilter } from '../security/SensitivePathFilter.js';
import { SCHEMA_VERSION, assertProjectId } from '../storage/KnowledgeStore.js';

const LANGUAGE_BY_EXTENSION = new Map([
  ['.c', 'C'],
  ['.cc', 'C++'],
  ['.cpp', 'C++'],
  ['.css', 'CSS'],
  ['.go', 'Go'],
  ['.html', 'HTML'],
  ['.java', 'Java'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.kt', 'Kotlin'],
  ['.kts', 'Kotlin'],
  ['.md', 'Markdown'],
  ['.php', 'PHP'],
  ['.py', 'Python'],
  ['.rb', 'Ruby'],
  ['.rs', 'Rust'],
  ['.sh', 'Shell'],
  ['.swift', 'Swift'],
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.vue', 'Vue'],
]);

const MANIFEST_NAMES = new Set([
  'build.gradle',
  'build.gradle.kts',
  'cargo.toml',
  'composer.json',
  'gemfile',
  'go.mod',
  'package.json',
  'pom.xml',
  'pyproject.toml',
  'requirements.txt',
]);

export class CurrentStateBuilder {
  constructor({ repository, store, sensitivePathFilter = new SensitivePathFilter(), clock = () => new Date() }) {
    if (!repository) throw new Error('CurrentStateBuilder requires a GitRepository.');
    this.repository = repository;
    this.store = store;
    this.sensitivePathFilter = sensitivePathFilter;
    this.clock = clock;
  }

  build(projectId) {
    assertProjectId(projectId);
    const safeFiles = this.repository
      .visibleFiles()
      .filter((path) => !this.sensitivePathFilter.isExcluded(path))
      .map((path) => this.sensitivePathFilter.redactText(path));
    const gitRevision = this.repository.revision();
    const revisionPaths = [
      ...gitRevision.committed,
      ...Object.values(gitRevision.workingTree).flat(),
    ];
    const ignoredRevisionPaths = this.repository.ignoredPaths(revisionPaths);
    const isSafeRevisionPath = (path) =>
      !ignoredRevisionPaths.has(path) && !this.sensitivePathFilter.isExcluded(path);
    const generatedAt = asIsoTimestamp(this.clock());
    const workingTree = Object.fromEntries(
      Object.entries(gitRevision.workingTree).map(([state, paths]) => [
        state,
        paths.filter(isSafeRevisionPath).map((path) => this.sensitivePathFilter.redactText(path)),
      ]),
    );

    return {
      schemaVersion: SCHEMA_VERSION,
      projectId,
      revision: gitRevision.head,
      repository: {
        branch: this.sensitivePathFilter.redactText(gitRevision.branch),
        head: gitRevision.head,
        committed: gitRevision.committed.filter(isSafeRevisionPath)
          .map((path) => this.sensitivePathFilter.redactText(path)),
      },
      workingTree,
      generatedAt,
      facts: buildFacts(safeFiles),
    };
  }

  persist(projectId) {
    if (!this.store) throw new Error('CurrentStateBuilder requires a KnowledgeStore to persist current.json.');
    this.store.assertExternalToRepository(this.repository.root, projectId);
    return this.store.writeProjectJson(projectId, 'current.json', this.build(projectId));
  }
}

function buildFacts(paths) {
  const sortedPaths = sort(paths);
  return {
    directories: sort(
      sortedPaths
        .filter((path) => path.includes('/'))
        .map((path) => path.split('/')[0]),
    ),
    languages: sort(sortedPaths.map(detectLanguage).filter(Boolean)),
    runtimes: detectRuntimes(sortedPaths),
    packageManagers: detectPackageManagers(sortedPaths),
    manifests: sortedPaths.filter((path) => MANIFEST_NAMES.has(basename(path).toLowerCase())),
    config: sortedPaths.filter(isKeyConfig),
    documentation: {
      readmes: sortedPaths.filter((path) => /^readme(?:\..+)?$/i.test(basename(path))),
      docs: locationDirectories(sortedPaths, new Set(['doc', 'docs', 'documentation'])),
      adrs: locationDirectories(sortedPaths, new Set(['adr', 'adrs', 'architecture-decisions'])),
      decisions: locationDirectories(sortedPaths, new Set(['decision', 'decisions', 'decision-records'])),
    },
  };
}

function detectLanguage(path) {
  const name = basename(path).toLowerCase();
  if (name === 'dockerfile') return 'Dockerfile';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? null : LANGUAGE_BY_EXTENSION.get(name.slice(dot)) ?? null;
}

function detectRuntimes(paths) {
  const names = new Set(paths.map((path) => basename(path).toLowerCase()));
  const extensions = new Set(paths.map((path) => extension(path)));
  const runtimes = [];
  if (names.has('package.json') || extensions.has('.js') || extensions.has('.ts')) runtimes.push('Node.js');
  if (names.has('pyproject.toml') || names.has('requirements.txt') || extensions.has('.py')) runtimes.push('Python');
  if (names.has('go.mod') || extensions.has('.go')) runtimes.push('Go');
  if (names.has('cargo.toml') || extensions.has('.rs')) runtimes.push('Rust');
  if (names.has('gemfile') || extensions.has('.rb')) runtimes.push('Ruby');
  if (names.has('composer.json') || extensions.has('.php')) runtimes.push('PHP');
  if (names.has('pom.xml') || names.has('build.gradle') || names.has('build.gradle.kts')) runtimes.push('JVM');
  return sort(runtimes);
}

function detectPackageManagers(paths) {
  const names = new Set(paths.map((path) => basename(path).toLowerCase()));
  const managers = [];
  if (names.has('package-lock.json') || names.has('npm-shrinkwrap.json')) managers.push('npm');
  if (names.has('pnpm-lock.yaml')) managers.push('pnpm');
  if (names.has('yarn.lock')) managers.push('Yarn');
  if (names.has('bun.lock') || names.has('bun.lockb')) managers.push('Bun');
  if (names.has('uv.lock')) managers.push('uv');
  if (names.has('poetry.lock')) managers.push('Poetry');
  if (names.has('pipfile.lock')) managers.push('Pipenv');
  if (names.has('cargo.lock')) managers.push('Cargo');
  if (names.has('go.sum')) managers.push('Go modules');
  if (names.has('gemfile.lock')) managers.push('Bundler');
  if (names.has('composer.lock')) managers.push('Composer');
  if (names.has('gradlew')) managers.push('Gradle');
  if (names.has('mvnw')) managers.push('Maven');
  return sort(managers);
}

function isKeyConfig(path) {
  const name = basename(path).toLowerCase();
  return (
    name === '.editorconfig' ||
    name === '.gitattributes' ||
    name === '.gitignore' ||
    name === 'dockerfile' ||
    name === 'makefile' ||
    /^(?:eslint|prettier|vite|vitest|jest|webpack|rollup|babel|tailwind|next|nuxt)\.config\./.test(name) ||
    /^(?:tsconfig|jsconfig)(?:\.[^.]+)?\.json$/.test(name) ||
    /^(?:docker-compose|compose)(?:\.[^.]+)?\.ya?ml$/.test(name)
  );
}

function locationDirectories(paths, names) {
  const locations = [];
  for (const path of paths) {
    const segments = path.split('/');
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (names.has(segments[index].toLowerCase())) locations.push(segments.slice(0, index + 1).join('/'));
    }
  }
  return sort(locations);
}

function extension(path) {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot);
}

function asIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid generatedAt timestamp: ${value}`);
  return date.toISOString();
}

function sort(values) {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
