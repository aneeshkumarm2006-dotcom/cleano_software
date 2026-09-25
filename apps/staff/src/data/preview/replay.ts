// How the sample data answers a mutation, the way the server will: the first
// request with a key is applied, and a retry with the same key gets the same
// answer without being applied again. A refusal comes back after the same
// delay as a success, so error states are seen as they will be.
const answers = new Map<string, unknown>();

export function once<T>(key: string, run: () => T, ms = 450): Promise<T> {
  try {
    if (!answers.has(key)) answers.set(key, run());
  } catch (e) {
    return new Promise((_, reject) => setTimeout(() => reject(e), ms));
  }
  const value = answers.get(key) as T;
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
