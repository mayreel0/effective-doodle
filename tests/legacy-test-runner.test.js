import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// 한글: 앞선 셸 테스트가 실패하면 뒤의 성공 테스트가 이를 가리지 못한다.
test('legacy test runner propagates an earlier shell test failure', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-legacy-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'test:legacy': scripts['test:legacy'] } }));
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests/01-fail.sh'), 'exit 7\n');
  writeFileSync(join(root, 'tests/02-pass.sh'), 'printf passed > marker\n');

  const result = spawnSync('npm', ['run', 'test:legacy', '--silent'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(root, 'marker')), false);
});
