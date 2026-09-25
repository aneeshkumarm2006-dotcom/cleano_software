/** A little latency, so loading states are seen and designed, not assumed. */
export const delay = <T,>(value: T, ms = 350) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
