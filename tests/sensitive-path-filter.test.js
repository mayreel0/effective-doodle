import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, relative } from 'node:path';
import test from 'node:test';

import { SensitivePathFilter } from '../src/security/SensitivePathFilter.js';

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'doodle-sensitive-filter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// 한글: 기본 민감 파일 및 생성물 경로를 분석 대상에서 제외한다.
test('excludes default sensitive files and generated directories', () => {
  const filter = new SensitivePathFilter();
  const excluded = [
    '.env',
    '.env.local',
    'config/.ENV.production',
    'certs/server.pem',
    'certs/server.KEY',
    'credentials.json',
    'config/credentials-prod.yaml',
    'secrets.toml',
    'config/my-secrets.txt',
    'config/aws-credentials.json',
    'config/prod-secret.yml',
    '.git/config',
    'packages/app/node_modules/dependency/index.js',
    'dist/index.js',
    'packages/app/build/output.js',
  ];

  for (const path of excluded) assert.equal(filter.isExcluded(path), true, path);
});

// 한글: 이름이 비슷하지만 민감하지 않은 일반 소스 경로는 허용한다.
test('keeps ordinary source paths that only resemble excluded names', () => {
  const filter = new SensitivePathFilter();
  const included = ['README.md', 'src/keymap.js', 'src/building/index.js', 'docs/secretary.md'];

  for (const path of included) assert.equal(filter.isExcluded(path), false, path);
});

// 한글: 절대 경로와 저장소 밖으로 나가는 상대 경로를 거부한다.
test('rejects absolute paths and repository traversal', () => {
  const filter = new SensitivePathFilter();

  assert.throws(() => filter.isExcluded('/tmp/.env'), /repository-relative/i);
  assert.throws(() => filter.isExcluded('../outside/.env'), /repository-relative/i);
  assert.throws(() => filter.isExcluded('src/../../outside'), /repository-relative/i);
});

// 한글: 저장소 내부 경로를 물리 경로로 안전하게 해석한다.
test('resolves existing and missing paths that remain inside the repository', (t) => {
  const root = temporaryRoot(t);
  const repository = join(root, 'repository');
  mkdirSync(join(repository, 'src'), { recursive: true });
  writeFileSync(join(repository, 'src', 'index.js'), 'export {}\n');
  const filter = new SensitivePathFilter();
  const canonicalRepository = realpathSync(repository);

  assert.equal(filter.resolveSafePath(repository, 'src/index.js'), join(canonicalRepository, 'src', 'index.js'));
  assert.equal(filter.resolveSafePath(repository, 'src/missing.js'), join(canonicalRepository, 'src', 'missing.js'));
});

// 한글: 시스템 루트를 repository 경계로 사용할 때도 내부 경로를 올바르게 허용한다.
test('accepts descendants when the repository boundary is a filesystem root', (t) => {
  const root = temporaryRoot(t);
  const sourcePath = join(root, 'source.txt');
  writeFileSync(sourcePath, 'safe\n');
  const canonicalSource = realpathSync(sourcePath);
  const filesystemRoot = parse(canonicalSource).root;
  const filter = new SensitivePathFilter();

  assert.equal(filter.resolveSafePath(filesystemRoot, relative(filesystemRoot, canonicalSource)), canonicalSource);
});

// 한글: 심볼릭 링크를 통한 저장소 경계 이탈을 거부한다.
test('rejects symlink escapes outside the repository boundary', (t) => {
  const root = temporaryRoot(t);
  const repository = join(root, 'repository');
  const outside = join(root, 'outside');
  mkdirSync(repository);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside-secret\n');
  symlinkSync(outside, join(repository, 'linked-outside'));
  const filter = new SensitivePathFilter();

  assert.throws(() => filter.resolveSafePath(repository, 'linked-outside/secret.txt'), /outside repository/i);
  assert.throws(() => filter.resolveSafePath(repository, 'linked-outside/missing.txt'), /outside repository/i);
});

// 한글: 대상이 없는 외부 심볼릭 링크도 안전한 미존재 경로로 오인하지 않는다.
test('rejects dangling symlinks that could later escape the repository', (t) => {
  const root = temporaryRoot(t);
  const repository = join(root, 'repository');
  mkdirSync(repository);
  symlinkSync(join(root, 'outside-not-created'), join(repository, 'dangling-outside'));
  const filter = new SensitivePathFilter();

  assert.throws(() => filter.resolveSafePath(repository, 'dangling-outside/secret.txt'), /symbolic link/i);
});

// 한글: secret-like 설정값을 구문은 유지한 채 마스킹한다.
test('redacts secret-like assignments while preserving non-secret settings', () => {
  const filter = new SensitivePathFilter();
  const input = [
    'API_KEY=plain-api-key',
    'password: "plain-password"',
    "clientSecret: 'plain-client-secret'",
    '"access_token": "plain-access-token",',
    'theme=dark',
  ].join('\n');

  const redacted = filter.redactText(input);

  assert.match(redacted, /API_KEY=\[REDACTED\]/);
  assert.match(redacted, /password: "\[REDACTED\]"/);
  assert.match(redacted, /clientSecret: '\[REDACTED\]'/);
  assert.match(redacted, /"access_token": "\[REDACTED\]",/);
  assert.match(redacted, /theme=dark/);
  assert.doesNotMatch(redacted, /plain-(?:api-key|password|client-secret|access-token)/);
});

// 한글: 한 줄 JSON 속성과 자바스크립트 선언에 포함된 민감값을 마스킹한다.
test('redacts secret-like JSON properties and JavaScript declarations', () => {
  const filter = new SensitivePathFilter();
  const input = [
    '{"api_key":"plain-json-secret","theme":"dark"}',
    "const clientSecret = 'plain-js-secret';",
    'export TOKEN=plain-exported-token',
  ].join('\n');

  const redacted = filter.redactText(input);

  assert.match(redacted, /"api_key":"\[REDACTED\]"/);
  assert.match(redacted, /"theme":"dark"/);
  assert.match(redacted, /const clientSecret = '\[REDACTED\]';/);
  assert.match(redacted, /export TOKEN=\[REDACTED\]/);
  assert.deepEqual(filter.extractSecretKeys(input), ['api_key', 'clientSecret', 'TOKEN']);
  assert.doesNotMatch(redacted, /plain-json-secret|plain-js-secret|plain-exported-token/);
});

// 한글: 한 줄에 여러 할당문이 있어도 뒤따르는 민감값을 모두 마스킹한다.
test('redacts later secret assignments on the same line', () => {
  const filter = new SensitivePathFilter();
  const input = 'let a = 1; const API_KEY = "plain-secret"; const TOKEN = "plain-token";';

  const redacted = filter.redactText(input);

  assert.equal(redacted, 'let a = 1; const API_KEY = "[REDACTED]"; const TOKEN = "[REDACTED]";');
  assert.deepEqual(filter.extractSecretKeys(input), ['API_KEY', 'TOKEN']);
  assert.doesNotMatch(redacted, /plain-secret|plain-token/);
});

// 한글: 쉼표로 구분된 선언에서도 모든 민감 할당값을 마스킹한다.
test('redacts secret assignments separated by commas', () => {
  const filter = new SensitivePathFilter();
  const input = 'const a = 1, API_KEY = plain-secret, TOKEN = "plain-token";';

  const redacted = filter.redactText(input);

  assert.equal(redacted, 'const a = 1, API_KEY = [REDACTED], TOKEN = "[REDACTED]";');
  assert.deepEqual(filter.extractSecretKeys(input), ['API_KEY', 'TOKEN']);
  assert.doesNotMatch(redacted, /plain-secret|plain-token/);
});

// 한글: 함수 호출 내부의 쉼표는 할당값 경계로 오인하지 않고 전체 표현식을 마스킹한다.
test('redacts complete secret expressions containing nested commas', () => {
  const filter = new SensitivePathFilter();
  const input = 'const TOKEN = join(prefix, "plain-secret"); const mode = "safe";';

  const redacted = filter.redactText(input);

  assert.equal(redacted, 'const TOKEN = [REDACTED]; const mode = "safe";');
  assert.deepEqual(filter.extractSecretKeys(input), ['TOKEN']);
  assert.doesNotMatch(redacted, /join|plain-secret/);
});

// 한글: 비민감 outer 값 내부의 민감 object property와 중첩 할당도 마스킹한다.
test('redacts secret assignments nested inside non-secret values', () => {
  const filter = new SensitivePathFilter();
  const input = [
    'const config = { apiKey: "plain-api-key", nested: { password: "plain-password" } };',
    'const result = (TOKEN = "plain-token");',
  ].join('\n');

  const redacted = filter.redactText(input);

  assert.match(redacted, /apiKey: "\[REDACTED\]"/);
  assert.match(redacted, /password: "\[REDACTED\]"/);
  assert.match(redacted, /TOKEN = "\[REDACTED\]"/);
  assert.deepEqual(filter.extractSecretKeys(input), ['apiKey', 'password', 'TOKEN']);
  assert.doesNotMatch(redacted, /plain-api-key|plain-password|plain-token/);
});

// 한글: 여러 줄에 걸친 quoted secret의 전체 본문을 마스킹한다.
test('redacts complete multiline quoted secret assignments', () => {
  const filter = new SensitivePathFilter();
  const input = [
    'const PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----',
    'MIIEpAIBAAKCAQEA-plain-key-material',
    '-----END RSA PRIVATE KEY-----`;',
  ].join('\n');

  const redacted = filter.redactText(input);

  assert.equal(redacted, 'const PRIVATE_KEY = `[REDACTED]`;');
  assert.deepEqual(filter.extractSecretKeys(input), ['PRIVATE_KEY']);
  assert.doesNotMatch(redacted, /BEGIN RSA|MIIEpAIB|END RSA|plain-key-material/);
});

// 한글: 중첩 template literal이 있어도 민감값의 닫는 백틱까지 전체를 마스킹한다.
test('redacts secret templates with nested template literals', () => {
  const filter = new SensitivePathFilter();
  const input = 'const PRIVATE_KEY = `before${`nested`}after-plain-secret`;';

  const redacted = filter.redactText(input);

  assert.equal(redacted, 'const PRIVATE_KEY = `[REDACTED]`;');
  assert.deepEqual(filter.extractSecretKeys(input), ['PRIVATE_KEY']);
  assert.doesNotMatch(redacted, /before|nested|after-plain-secret/);
});

// 한글: 이스케이프 문자열과 숫자형 JSON 민감값을 누출 없이 유효하게 마스킹한다.
test('redacts escaped strings and scalar secret values in JSON', () => {
  const filter = new SensitivePathFilter();
  const input = String.raw`{"api_key":"first\"second-secret","password":123456,"theme":1}`;

  const redacted = filter.redactText(input);
  const parsed = JSON.parse(redacted);

  assert.deepEqual(parsed, { api_key: '[REDACTED]', password: '[REDACTED]', theme: 1 });
  assert.deepEqual(filter.extractSecretKeys(input), ['api_key', 'password']);
  assert.doesNotMatch(redacted, /second-secret|123456/);
});

// 한글: URL 사용자 정보와 민감한 쿼리 매개변수 값을 마스킹한다.
test('redacts credentials embedded in URLs', () => {
  const filter = new SensitivePathFilter();
  const input = [
    'endpoint=https://alice:plain-password@example.test/path?lang=ko',
    'callback=https://example.test/callback?token=plain-token&mode=test',
  ].join('\n');

  const redacted = filter.redactText(input);

  assert.match(redacted, /https:\/\/\[REDACTED\]@example\.test\/path\?lang=ko/);
  assert.match(redacted, /token=\[REDACTED\]&mode=test/);
  assert.doesNotMatch(redacted, /alice|plain-password|plain-token/);
});

// 한글: URL의 일반적인 secret-like 쿼리 키 변형도 동일하게 마스킹한다.
test('redacts supported secret key variants in URL query parameters', () => {
  const filter = new SensitivePathFilter();
  const input = [
    'first=https://example.test/?access_key=plain-access-key',
    'second=https://example.test/?api-key=plain-api-key',
    'third=https://example.test/?authorization=plain-authorization',
  ].join('\n');

  const redacted = filter.redactText(input);

  assert.equal((redacted.match(/\[REDACTED\]/g) ?? []).length, 3);
  assert.deepEqual(filter.extractSecretKeys(input), ['first', 'second', 'third']);
  assert.doesNotMatch(redacted, /plain-access-key|plain-api-key|plain-authorization/);
});

// 한글: 독립 URL의 scheme을 민감 설정 키로 잘못 추출하지 않는다.
test('does not treat a standalone URL scheme as a secret key', () => {
  const filter = new SensitivePathFilter();
  const input = 'https://example.test/?apiKey=plain-api-key';

  assert.deepEqual(filter.extractSecretKeys(input), []);
  assert.doesNotMatch(filter.redactText(input), /plain-api-key/);
});

// 한글: 민감 설정은 값 없이 키 이름만 결정적으로 추출한다.
test('extracts only sorted unique secret key names', () => {
  const filter = new SensitivePathFilter();
  const input = [
    'TOKEN=plain-token',
    'theme=dark',
    'password: plain-password',
    'TOKEN=second-token',
    'service_url=https://user:plain-password@example.test',
  ].join('\n');

  const keys = filter.extractSecretKeys(input);
  const serialized = JSON.stringify({ keys, content: filter.redactText(input) });

  assert.deepEqual(keys, ['password', 'service_url', 'TOKEN']);
  assert.doesNotMatch(serialized, /plain-token|second-token|plain-password|user/);
});

// 한글: 제외된 .env 파일의 derived metadata에는 키 이름만 남고 실제 값은 남지 않는다.
test('keeps env-derived metadata free of URL password and token values', () => {
  const filter = new SensitivePathFilter();
  const env = [
    'DATABASE_URL=postgres://user:plain-db-password@example.test/database',
    'PASSWORD=plain-password',
    'TOKEN=plain-token',
  ].join('\n');

  const persisted = JSON.stringify({
    path: '.env',
    excluded: filter.isExcluded('.env'),
    keys: filter.extractSecretKeys(env),
  });

  assert.deepEqual(JSON.parse(persisted), {
    path: '.env',
    excluded: true,
    keys: ['DATABASE_URL', 'PASSWORD', 'TOKEN'],
  });
  assert.doesNotMatch(persisted, /plain-db-password|plain-password|plain-token|postgres:\/\//);
});

// 한글: 필터링 과정은 관찰 대상 저장소 파일을 변경하지 않는다.
test('does not modify source repository files', (t) => {
  const root = temporaryRoot(t);
  const repository = join(root, 'repository');
  const sourcePath = join(repository, 'config.txt');
  const source = 'API_KEY=plain-api-key\ntheme=dark\n';
  mkdirSync(repository);
  writeFileSync(sourcePath, source);
  const filter = new SensitivePathFilter();

  filter.resolveSafePath(repository, 'config.txt');
  filter.redactText(readFileSync(sourcePath, 'utf8'));
  filter.extractSecretKeys(readFileSync(sourcePath, 'utf8'));

  assert.equal(readFileSync(sourcePath, 'utf8'), source);
});
