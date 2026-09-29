import { join } from 'node:path';
import { workerData } from 'node:worker_threads';
import lockfile from 'proper-lockfile';

const { home, staleMs, signal } = workerData;
const state = new Int32Array(signal, 0, 4);
const errorBytes = new Uint8Array(signal, 16);

function report(status, error) {
  if (error) {
    const message = Buffer.from(error.message ?? String(error));
    const length = Math.min(message.length, errorBytes.length);
    errorBytes.set(message.subarray(0, length));
    Atomics.store(state, 2, length);
  }
  Atomics.store(state, 0, status);
  Atomics.notify(state, 0);
}

async function ownLock() {
  const deadline = Date.now() + 5_000;
  let release;
  while (!release && Atomics.load(state, 1) === 0) {
    try {
      release = await lockfile.lock(home, {
        lockfilePath: join(home, '.registry.lock'),
        stale: staleMs,
        update: Math.max(1_000, Math.floor(staleMs / 3)),
        onCompromised: (error) => report(6, error),
      });
    } catch (error) {
      if (error.code !== 'ELOCKED') {
        report(3, error);
        return;
      }
      if (Date.now() >= deadline) {
        report(2, error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!release) return;
  if (Atomics.load(state, 1) !== 0) {
    await release();
    return;
  }
  report(1);
  const interval = setInterval(async () => {
    if (Atomics.load(state, 1) === 0) return;
    clearInterval(interval);
    if (Atomics.load(state, 0) === 6) return;
    try {
      await release();
      report(4);
    } catch (error) {
      report(5, error);
    }
  }, 10);
}

ownLock().catch((error) => report(3, error));
