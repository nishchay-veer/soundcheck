import { getJobEnv } from "@soundcheck/core";

export interface Task {
  index: number;
  count: number;
}

/** This Cloud Run task's position, from `CLOUD_RUN_TASK_INDEX` and `CLOUD_RUN_TASK_COUNT`. */
export function currentTask(): Task {
  const env = getJobEnv();
  return { index: env.CLOUD_RUN_TASK_INDEX, count: env.CLOUD_RUN_TASK_COUNT };
}

/**
 * This task's contiguous slice of `items`. Slices across all tasks cover every
 * item exactly once, in order, and differ in size by at most one.
 */
export function shard<T>(items: readonly T[], task: Task = currentTask()): T[] {
  const { index, count } = task;
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`Task count must be a positive integer, got ${count}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`Task index must be an integer in [0, ${count}), got ${index}`);
  }
  const start = Math.floor((index * items.length) / count);
  const end = Math.floor(((index + 1) * items.length) / count);
  return items.slice(start, end);
}
