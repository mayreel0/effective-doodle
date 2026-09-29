import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename } from 'node:path';

import { assertProjectId } from '../storage/KnowledgeStore.js';

export class ProjectRegistry {
  constructor({ store }) {
    this.store = store;
  }

  register(inputPath, { id } = {}) {
    const canonicalPath = canonicalGitRoot(inputPath);
    const projectId = id ?? basename(canonicalPath);
    assertProjectId(projectId);
    this.store.assertExternalToRepository(canonicalPath, projectId);
    return this.store.withRegistryLock(() => this.#registerLocked(canonicalPath, projectId));
  }

  #registerLocked(canonicalPath, projectId) {
    this.store.recoverRegistryMutation();
    const registry = this.store.readRegistry();

    if (registry.projects.some((project) => project.id === projectId)) {
      throw new Error(`Project ID '${projectId}' is already registered.`);
    }
    if (registry.projects.some((project) => normalizedId(project.id) === normalizedId(projectId))) {
      throw new Error(`Project ID '${projectId}' collides with an existing storage ID.`);
    }
    if (registry.projects.some((project) => project.path === canonicalPath)) {
      throw new Error(`Project path is already registered: ${canonicalPath}`);
    }

    this.store.assertNewProjectStorageAvailable(projectId);
    this.store.beginRegistryMutation({ operation: 'register', projectId, path: canonicalPath });
    let metadata;
    try {
      metadata = this.store.writeNewProjectJson(projectId, 'project.json', {
        id: projectId,
        path: canonicalPath,
      });
    } catch (error) {
      try {
        this.store.recoverRegistryMutation();
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Failed to register '${projectId}' and recover its metadata.`);
      }
      throw error;
    }
    const entry = { id: projectId, path: canonicalPath };
    registry.projects.push(entry);
    registry.projects.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    try {
      this.store.writeRegistry(registry);
    } catch (error) {
      try {
        this.store.recoverRegistryMutation();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Failed to register '${projectId}' and roll back its metadata.`,
        );
      }
      throw error;
    }
    this.store.finishRegistryMutation();
    return metadata;
  }

  list() {
    return this.store.withRegistryLock(() => {
      this.store.recoverRegistryMutation({ cleanupCommitted: false });
      return [...this.store.readRegistry().projects];
    });
  }

  get(projectId) {
    return this.store.withRegistryLock(() => {
      this.store.recoverRegistryMutation({ cleanupCommitted: false });
      const entry = this.store.readRegistry().projects.find((project) => project.id === projectId);
      if (!entry) throw new Error(`Project '${projectId}' is not registered.`);
      const metadata = this.store.readProjectJson(projectId, 'project.json');
      if (!metadata) throw new Error(`Project metadata is missing for '${projectId}'.`);
      return metadata;
    });
  }

  unregister(projectId) {
    return this.store.withRegistryLock(() => this.#unregisterLocked(projectId));
  }

  #unregisterLocked(projectId) {
    this.store.recoverRegistryMutation();
    const registry = this.store.readRegistry();
    const remaining = registry.projects.filter((project) => project.id !== projectId);
    if (remaining.length === registry.projects.length) {
      throw new Error(`Project '${projectId}' is not registered.`);
    }
    const stagingName = this.store.newStagedRemovalName(projectId);
    this.store.beginRegistryMutation({ operation: 'unregister', projectId, stagingName });
    let stagedPath;
    try {
      stagedPath = this.store.stageProjectRemoval(projectId, stagingName);
      this.store.writeRegistry({ ...registry, projects: remaining });
    } catch (error) {
      try {
        this.store.recoverRegistryMutation();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Failed to unregister '${projectId}' and restore its staged derived data.`,
        );
      }
      throw error;
    }
    try {
      this.store.discardStagedProject(stagedPath);
      this.store.finishRegistryMutation();
    } catch (error) {
      throw new Error(
        `Project '${projectId}' was unregistered, but staged derived data cleanup failed: ${error.message}`,
        { cause: error },
      );
    }
  }
}

function normalizedId(projectId) {
  return projectId.normalize('NFC').toLowerCase();
}

function canonicalGitRoot(inputPath) {
  let inputStat;
  try {
    inputStat = statSync(inputPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Repository path does not exist: ${inputPath}`, { cause: error });
    throw new Error(`Unable to inspect repository path: ${inputPath}`, { cause: error });
  }
  if (!inputStat.isDirectory()) throw new Error(`Repository path is not a directory: ${inputPath}`);
  const canonicalInput = realpathSync(inputPath);
  try {
    const root = execFileSync('git', ['-C', canonicalInput, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return realpathSync(root);
  } catch (error) {
    throw new Error(`Path is not a Git repository: ${canonicalInput}`, { cause: error });
  }
}
