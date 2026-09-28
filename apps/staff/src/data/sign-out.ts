// Work a feature keeps in memory outside the query cache, cleared when the
// person signs out. Features register here, rather than the session importing
// each of them, so the session depends on nothing above it.
const tasks = new Set<() => void>();

/** Run `task` whenever someone signs out on this phone. */
export function onSignOut(task: () => void): void {
  tasks.add(task);
}

export function runSignOutTasks(): void {
  for (const task of tasks) task();
}
