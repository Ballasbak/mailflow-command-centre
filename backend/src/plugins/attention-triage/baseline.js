// Activation baselines must be minted on the server when a mailbox opts in.
// A missing, malformed or future baseline means NO automatic ingestion or AI work.
export function validActivationBaseline(value, now = new Date()) {
  if (typeof value !== 'string' || !(now instanceof Date) ||
      Number.isNaN(now.getTime())) return false;
  const stamp = new Date(value);
  return !Number.isNaN(stamp.getTime()) &&
    stamp.toISOString() === value &&
    stamp.getTime() <= now.getTime();
}
