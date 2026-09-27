import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const SCHEMA_VERSION = 1;

export class KnowledgeStore {
  constructor({ home } = {}) {
    const configuredHome = home ?? process.env.DOODLE_HOME ?? join(homedir(), '.doodle');
    if (typeof configuredHome !== 'string' || configuredHome.trim().length === 0) {
      throw new Error('DOODLE_HOME must not be empty.');
    }
    this.home = resolve(configuredHome);
  }

  registryPath() {
    return join(this.home, 'registry.json');
  }

  projectDirectory(projectId) {
    assertProjectId(projectId);
    return join(this.home, 'projects', projectId);
  }

  assertExternalToRepository(repositoryPath, projectId) {
    const repository = realpathSync(repositoryPath);
    const home = physicalPath(this.home);
    const registry = physicalPath(this.registryPath());
    const project = physicalPath(this.projectDirectory(projectId));
    if (
      isSameOrDescendant(repository, home) ||
      isSameOrDescendant(repository, registry) ||
      pathsOverlap(repository, project)
    ) {
      throw new Error(`DOODLE_HOME must remain outside the source repository: ${repository}`);
    }
  }

  readRegistry() {
    try {
      return readVersionedJson(this.registryPath());
    } catch (error) {
      if (error.cause?.code === 'ENOENT') return { schemaVersion: SCHEMA_VERSION, projects: [] };
      throw error;
    }
  }

  writeRegistry(registry) {
    const value = withSchemaVersion(registry);
    writeJsonAtomic(this.registryPath(), value);
    return value;
  }

  readProjectJson(projectId, filename) {
    assertJsonFilename(filename);
    const path = join(this.projectDirectory(projectId), filename);
    try {
      return readVersionedJson(path);
    } catch (error) {
      if (error.cause?.code === 'ENOENT') return null;
      throw error;
    }
  }

  writeProjectJson(projectId, filename, value) {
    assertJsonFilename(filename);
    const versionedValue = withSchemaVersion(value);
    writeJsonAtomic(join(this.projectDirectory(projectId), filename), versionedValue);
    return versionedValue;
  }

  removeProject(projectId) {
    rmSync(this.projectDirectory(projectId), { recursive: true, force: true });
  }

}

export function assertProjectId(projectId) {
  if (
    typeof projectId !== 'string' ||
    projectId.length === 0 ||
    projectId === '.' ||
    projectId === '..' ||
    /[\\/\0\r\n]/.test(projectId) ||
    Buffer.byteLength(projectId, 'utf8') > 200
  ) {
    throw new Error(`Invalid project ID: ${projectId}`);
  }
}

function physicalPath(path) {
  const missing = [];
  let candidate = path;
  while (true) {
    try {
      return join(realpathSync(candidate), ...missing);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(path);
      missing.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function isSameOrDescendant(ancestor, candidate) {
  return candidate === ancestor || candidate.startsWith(`${ancestor}${sep}`);
}

function pathsOverlap(left, right) {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function assertJsonFilename(filename) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(filename)) {
    throw new Error(`Invalid JSON filename: ${filename}`);
  }
}

function readVersionedJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    assertSchemaVersion(value);
    return value;
  } catch (error) {
    throw new Error(`Failed to read JSON at ${path}: ${error.message}`, { cause: error });
  }
}

function assertSchemaVersion(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Persisted JSON must use schemaVersion ${SCHEMA_VERSION}.`);
  }
}

function withSchemaVersion(value) {
  if (value?.schemaVersion !== undefined && value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Persisted JSON must use schemaVersion ${SCHEMA_VERSION}.`);
  }
  return { ...value, schemaVersion: SCHEMA_VERSION };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
