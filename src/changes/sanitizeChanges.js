import { SensitivePathFilter } from '../security/SensitivePathFilter.js';

export function sanitizeChanges(changes, pathFilter = new SensitivePathFilter()) {
  return {
    ...changes,
    commits: changes.commits.map((commit) => ({
      ...commit,
      message: pathFilter.redactText(commit.message),
    })),
    files: changes.files
      .filter((file) => !pathFilter.isExcluded(file.path))
      .map((file) => {
        const safeFile = { ...file, path: pathFilter.redactText(file.path) };
        if (file.previousPath) {
          if (pathFilter.isExcluded(file.previousPath)) {
            delete safeFile.previousPath;
            if (safeFile.status === 'renamed' || safeFile.status === 'copied') {
              safeFile.status = 'added';
            }
          } else {
            safeFile.previousPath = pathFilter.redactText(file.previousPath);
          }
        }
        return safeFile;
      }),
  };
}
