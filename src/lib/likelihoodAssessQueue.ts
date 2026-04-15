/**
 * Limits concurrent milestone on-time likelihood assessments (Claude) so opening
 * Roadmap with many Slack threads does not stampede the API.
 */

const MAX_CONCURRENT = 2;

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

export async function runWithLikelihoodConcurrency<T>(
  fn: () => Promise<T>
): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
