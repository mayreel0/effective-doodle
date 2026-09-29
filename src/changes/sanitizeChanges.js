import { SensitivePathFilter } from '../security/SensitivePathFilter.js';

export function sanitizeChanges(changes, pathFilter = new SensitivePathFilter()) {
  return {
    ...changes,
    commits: changes.commits.map((commit) => ({
      ...commit,
      message: pathFilter.redactText(commit.message),
    })),
    files: changes.files
      .filter((file) => !pathFilter.isExcluded(file.path) &&
        (!file.previousPath || !pathFilter.isExcluded(file.previousPath)))
      .map((file) => ({
        ...file,
        path: pathFilter.redactText(file.path),
        ...(file.previousPath ? { previousPath: pathFilter.redactText(file.previousPath) } : {}),
      })),
  };
}
