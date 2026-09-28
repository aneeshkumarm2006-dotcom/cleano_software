export function formatJobNumber(n: number): string {
  return `JOB-${n.toString().padStart(5, "0")}`;
}
