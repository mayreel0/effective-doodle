import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { ChangeAnalyzer } from './ChangeAnalyzer.js';

export class ProjectSync {
  constructor({ registry, store, analyzer = new ChangeAnalyzer() }) {
    this.registry = registry;
    this.store = store;
    this.analyzer = analyzer;
  }

  run(projectId, { since } = {}) {
    const project = this.registry.get(projectId);
    const baseRef = since ?? project.lastSyncRevision ?? 'HEAD';
    const analysis = this.analyzer.analyze(project.path, { since: baseRef });
    const previousChanges = this.store.readProjectJson(projectId, 'changes.json');
    const changes = this.store.writeProjectJson(projectId, 'changes.json', {
      projectId,
      ...analysis,
    });
    try {
      this.store.writeProjectJson(projectId, 'project.json', {
        ...project,
        lastSyncRevision: analysis.head,
      });
    } catch (error) {
      try {
        restoreChanges(this.store, projectId, previousChanges);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Failed to sync '${projectId}' and restore its previous changes snapshot.`,
        );
      }
      throw error;
    }
    return changes;
  }
}

function restoreChanges(store, projectId, previousChanges) {
  if (previousChanges === null) {
    rmSync(join(store.projectDirectory(projectId), 'changes.json'), { force: true });
    return;
  }
  store.writeProjectJson(projectId, 'changes.json', previousChanges);
}
