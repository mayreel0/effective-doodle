import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeChanges } from '../src/changes/sanitizeChanges.js';

test('keeps an allowed destination when its previous path is excluded', () => {
  const changes = {
    base: 'base',
    head: 'head',
    commits: [],
    files: [
      { path: 'src/public.js', previousPath: 'team-secrets/private.js', status: 'renamed' },
      { path: 'src/copied.js', previousPath: '.env', status: 'copied' },
    ],
  };

  assert.deepEqual(sanitizeChanges(changes), {
    base: 'base',
    head: 'head',
    commits: [],
    files: [
      { path: 'src/public.js', status: 'added' },
      { path: 'src/copied.js', status: 'added' },
    ],
  });
});

test('preserves safe previous paths and excludes sensitive destinations', () => {
  const changes = {
    commits: [],
    files: [
      { path: 'src/new.js', previousPath: 'src/old.js', status: 'renamed' },
      { path: '.env', previousPath: 'src/old-env', status: 'renamed' },
    ],
  };

  assert.deepEqual(sanitizeChanges(changes).files, [
    { path: 'src/new.js', previousPath: 'src/old.js', status: 'renamed' },
  ]);
});
