import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import { ProjectRegistry } from '../../src/projects/ProjectRegistry.js';
import { KnowledgeStore } from '../../src/storage/KnowledgeStore.js';

const [home, operation, repo, id, barrier] = process.argv.slice(2);

class PausingStore extends KnowledgeStore {
  writeRegistry(registry) {
    if (barrier === 'crash-after-write') {
      super.writeRegistry(registry);
      process.kill(process.pid, 'SIGKILL');
    }
    if (barrier) {
      writeFileSync(join(barrier, 'ready'), 'ready');
      const deadline = Date.now() + 8000;
      while (!existsSync(join(barrier, 'release'))) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for test barrier');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    return super.writeRegistry(registry);
  }
}

try {
  if (operation === 'claim-lock') {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      try {
        const release = lockfile.lockSync(home, { lockfilePath: join(home, '.registry.lock'), stale: 2000 });
        writeFileSync(repo, 'acquired');
        release();
        process.exit(0);
      } catch (error) {
        if (error.code !== 'ELOCKED') throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    throw new Error('Timed out claiming test registry lock');
  }
  const registry = new ProjectRegistry({ store: new PausingStore({ home }) });
  if (operation === 'register') registry.register(repo, { id });
  else if (operation === 'unregister') registry.unregister(id);
  else throw new Error(`Unknown operation: ${operation}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
