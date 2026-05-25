import type { ProviderId } from '../types/router.js';

type QueueEntry = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type QueueState = {
  active: number;
  queue: QueueEntry[];
};

const states = new Map<ProviderId, QueueState>();

function getState(providerId: ProviderId): QueueState {
  const existing = states.get(providerId);
  if (existing) return existing;

  const created: QueueState = {
    active: 0,
    queue: []
  };
  states.set(providerId, created);
  return created;
}

function release(providerId: ProviderId): void {
  const state = getState(providerId);
  state.active = Math.max(0, state.active - 1);
  const next = state.queue.shift();

  if (!next) return;
  if (next.timer) clearTimeout(next.timer);
  state.active += 1;
  next.resolve(() => release(providerId));
}

export function withProviderSlot<T>(
  providerId: ProviderId,
  maxConcurrent: number,
  queueTimeoutMs: number,
  task: (queueWaitMs: number) => Promise<T>
): Promise<T> {
  const state = getState(providerId);
  const startedAt = performance.now();

  const acquire = () => new Promise<() => void>((resolve, reject) => {
    const grant = () => resolve(() => release(providerId));
    const entry: QueueEntry = {
      resolve: grant,
      reject,
      timer: null
    };

    if (state.active < maxConcurrent) {
      state.active += 1;
      grant();
      return;
    }

    entry.timer = setTimeout(() => {
      const index = state.queue.indexOf(entry);
      if (index >= 0) state.queue.splice(index, 1);
      entry.reject(new Error(`Provider ${providerId} queue timeout after ${queueTimeoutMs}ms`));
    }, queueTimeoutMs);

    state.queue.push(entry);
  });

  return acquire().then(async (releaseSlot) => {
    const queueWaitMs = Math.max(0, Math.round(performance.now() - startedAt));
    try {
      return await task(queueWaitMs);
    } finally {
      releaseSlot();
    }
  });
}
