import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { ChangeAnalyzer } from './changes/ChangeAnalyzer.js';
import { ProjectSync } from './changes/ProjectSync.js';
import { sanitizeChanges } from './changes/sanitizeChanges.js';
import { ContextBuilder } from './context/ContextBuilder.js';
import { CurrentStateBuilder } from './current-state/CurrentStateBuilder.js';
import { DecisionIndex } from './decisions/DecisionIndex.js';
import { GitRepository } from './git/GitRepository.js';
import { ProjectRegistry } from './projects/ProjectRegistry.js';
import { KnowledgeStore, SCHEMA_VERSION } from './storage/KnowledgeStore.js';

export class KnowledgeProvider {
  constructor({ home, store = new KnowledgeStore({ home }) } = {}) {
    this.store = store;
    this.registry = new ProjectRegistry({ store });
    this.analyzer = new ChangeAnalyzer();
    this.projectSync = new ProjectSync({ registry: this.registry, store });
    this.decisionIndex = new DecisionIndex({ store });
    this.contextBuilder = new ContextBuilder({ registry: this.registry, store });
  }

  register(path, options) {
    return this.registry.register(path, options);
  }

  list() {
    return { schemaVersion: SCHEMA_VERSION, projects: this.registry.list() };
  }

  unregister(projectId) {
    this.registry.unregister(projectId);
    return { schemaVersion: SCHEMA_VERSION, id: projectId, unregistered: true };
  }

  sync(projectId, { since, rebuild = false } = {}) {
    const project = this.registry.get(projectId);
    this.store.assertExternalToRepository(project.path, projectId);
    const baseRef = since ?? (rebuild ? 'HEAD' : undefined);
    if (rebuild) this.analyzer.analyze(project.path, { since: baseRef });
    const filenames = ['project.json', 'current.json', 'changes.json', 'decisions.json'];
    const previous = new Map(filenames.map((filename) => [
      filename,
      this.store.readProjectJson(projectId, filename),
    ]));
    try {
      const changes = this.projectSync.run(projectId, { since: baseRef });
      const current = new CurrentStateBuilder({
        repository: new GitRepository(project.path),
        store: this.store,
      }).persist(projectId);
      const decisions = this.decisionIndex.rebuild(project);
      return { schemaVersion: SCHEMA_VERSION, projectId, current, changes, decisions };
    } catch (error) {
      const rollbackErrors = [];
      for (const [filename, value] of previous) {
        try {
          if (value === null) {
            rmSync(join(this.store.projectDirectory(projectId), filename), { force: true });
          } else {
            this.store.writeProjectJson(projectId, filename, value);
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], `Sync failed for '${projectId}' and rollback was incomplete.`);
      }
      throw error;
    }
  }

  getCurrent(projectId) {
    this.registry.get(projectId);
    return this.#readRequired(projectId, 'current.json');
  }

  getChanges(projectId, { since } = {}) {
    const project = this.registry.get(projectId);
    this.store.assertExternalToRepository(project.path, projectId);
    if (since !== undefined) {
      return {
        schemaVersion: SCHEMA_VERSION,
        projectId,
        ...sanitizeChanges(this.analyzer.analyze(project.path, { since })),
      };
    }
    return this.#readRequired(projectId, 'changes.json');
  }

  getContext(projectId, task) {
    return this.contextBuilder.getContext(projectId, task);
  }

  #readRequired(projectId, filename) {
    const value = this.store.readProjectJson(projectId, filename);
    if (value === null) throw new Error(`Project '${projectId}' has no ${filename}; run sync first.`);
    return value;
  }
}
