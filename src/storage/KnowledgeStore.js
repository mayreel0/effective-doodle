import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';

export const SCHEMA_VERSION = 1;

export class KnowledgeStore {
  constructor({ home, registryLockStaleMs = 30_000 } = {}) {
    const configuredHome = home ?? process.env.DOODLE_HOME ?? join(homedir(), '.doodle');
    if (typeof configuredHome !== 'string' || configuredHome.trim().length === 0) {
      throw new Error('DOODLE_HOME must not be empty.');
    }
    this.home = resolve(configuredHome);
    if (!Number.isInteger(registryLockStaleMs) || registryLockStaleMs < 2_000) {
      throw new Error('registryLockStaleMs must be at least 2000 milliseconds.');
    }
    this.registryLockStaleMs = registryLockStaleMs;
  }

  registryPath() {
    return join(this.home, 'registry.json');
  }

  registryTransactionPath() {
    return join(this.home, 'registry-transaction.json');
  }

  beginRegistryMutation(transaction) {
    writeJsonAtomic(this.registryTransactionPath(), withSchemaVersion(transaction));
  }

  finishRegistryMutation() {
    rmSync(this.registryTransactionPath(), { force: true });
  }

  recoverRegistryMutation({ cleanupCommitted = true } = {}) {
    let transaction;
    try {
      transaction = readVersionedJson(this.registryTransactionPath());
    } catch (error) {
      if (error.cause?.code === 'ENOENT') return;
      throw error;
    }
    assertProjectId(transaction.projectId);
    const registry = this.readRegistry();
    const registered = registry.projects.some((project) => project.id === transaction.projectId);
    if (transaction.operation === 'register' && typeof transaction.path === 'string') {
      const metadata = this.readProjectJson(transaction.projectId, 'project.json');
      if (registered) {
        if (metadata?.path !== transaction.path) {
          throw new Error(`Cannot recover registration for '${transaction.projectId}': metadata differs from registry transaction.`);
        }
      } else {
        if (metadata && metadata.path !== transaction.path) {
          throw new Error(`Cannot recover registration for '${transaction.projectId}': derived data belongs to another project.`);
        }
        this.rollbackNewProjectJson(transaction.projectId, 'project.json');
      }
    } else if (transaction.operation === 'unregister' && typeof transaction.stagingName === 'string') {
      const stagedPath = this.stagedRemovalPath(transaction.projectId, transaction.stagingName);
      if (registered) {
        if (existsSync(stagedPath)) {
          if (existsSync(this.projectDirectory(transaction.projectId))) {
            throw new Error(`Cannot recover unregistration for '${transaction.projectId}': both active and staged data exist.`);
          }
          this.restoreStagedProject(transaction.projectId, stagedPath);
        } else if (!existsSync(this.projectDirectory(transaction.projectId))) {
          throw new Error(`Cannot recover unregistration for '${transaction.projectId}': project data is missing.`);
        }
      } else {
        if (!cleanupCommitted) return;
        this.discardStagedProject(stagedPath);
      }
    } else {
      throw new Error('Invalid project registry transaction.');
    }
    this.finishRegistryMutation();
  }

  withRegistryLock(operation) {
    mkdirSync(this.home, { recursive: true });
    // The registry operations below are synchronous. Keep the lock's heartbeat on
    // another event loop so a long operation cannot make its own lock stale.
    const signal = new SharedArrayBuffer(16 + 512);
    const state = new Int32Array(signal, 0, 4);
    const owner = new Worker(new URL('./registry-lock-worker.js', import.meta.url), {
      workerData: { home: this.home, staleMs: this.registryLockStaleMs, signal },
    });
    owner.on('error', () => {}); // The synchronous waiter reports worker failures by timeout.
    owner.unref();
    const deadline = Date.now() + 6_000;
    while (Atomics.load(state, 0) === 0 && Date.now() < deadline) {
      Atomics.wait(state, 0, 0, 50);
    }
    const acquired = Atomics.load(state, 0);
    if (acquired !== 1) {
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
      if (acquired === 2 || acquired === 0) {
        throw new Error('Timed out waiting for the project registry lock.');
      }
      throw new Error(`Could not acquire the project registry lock: ${lockWorkerError(signal, state)}`);
    }
    try {
      return operation();
    } finally {
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
      const releaseDeadline = Date.now() + 5_000;
      while (Atomics.load(state, 0) === 1 && Date.now() < releaseDeadline) {
        Atomics.wait(state, 0, 1, 50);
      }
      if (Atomics.load(state, 0) !== 4) {
        throw new Error(`Could not release the project registry lock: ${lockWorkerError(signal, state)}`);
      }
    }
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

  assertNewProjectStorageAvailable(projectId) {
    if (existsSync(this.projectDirectory(projectId))) {
      throw new Error(`Derived project storage already exists for '${projectId}'.`);
    }
  }

  writeNewProjectJson(projectId, filename, value) {
    assertJsonFilename(filename);
    const projectDirectory = this.projectDirectory(projectId);
    mkdirSync(dirname(projectDirectory), { recursive: true });
    try {
      mkdirSync(projectDirectory);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error(`Derived project storage already exists for '${projectId}'.`, { cause: error });
      }
      throw error;
    }

    try {
      return this.writeProjectJson(projectId, filename, value);
    } catch (error) {
      this.rollbackNewProjectJson(projectId, filename);
      throw error;
    }
  }

  rollbackNewProjectJson(projectId, filename) {
    assertJsonFilename(filename);
    const projectDirectory = this.projectDirectory(projectId);
    rmSync(join(projectDirectory, filename), { force: true });
    try {
      rmdirSync(projectDirectory);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    }
  }

  newStagedRemovalName(projectId) {
    assertProjectId(projectId);
    return `${projectId}.${randomUUID()}`;
  }

  stagedRemovalPath(projectId, stagingName) {
    assertProjectId(projectId);
    if (!stagingName.startsWith(`${projectId}.`) || !/^[0-9a-f-]{36}$/i.test(stagingName.slice(projectId.length + 1))) {
      throw new Error('Invalid staged project removal name.');
    }
    return join(this.home, 'staged-removals', stagingName);
  }

  stageProjectRemoval(projectId, stagingName = this.newStagedRemovalName(projectId)) {
    const projectDirectory = this.projectDirectory(projectId);
    const stagingDirectory = join(this.home, 'staged-removals');
    const stagedPath = this.stagedRemovalPath(projectId, stagingName);
    mkdirSync(stagingDirectory, { recursive: true });
    try {
      renameSync(projectDirectory, stagedPath);
      return stagedPath;
    } catch (error) {
      if (error.code === 'ENOENT') {
        removeEmptyDirectory(stagingDirectory);
        return null;
      }
      throw error;
    }
  }

  restoreStagedProject(projectId, stagedPath) {
    if (stagedPath === null) return;
    renameSync(stagedPath, this.projectDirectory(projectId));
    removeEmptyDirectory(dirname(stagedPath));
  }

  discardStagedProject(stagedPath) {
    if (stagedPath === null) return;
    rmSync(stagedPath, { recursive: true, force: true });
    removeEmptyDirectory(dirname(stagedPath));
  }
}

function lockWorkerError(signal, state) {
  const length = Atomics.load(state, 2);
  if (length === 0) return 'lock owner did not respond';
  return Buffer.from(new Uint8Array(signal, 16, length)).toString('utf8');
}

function removeEmptyDirectory(path) {
  try {
    rmdirSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
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
