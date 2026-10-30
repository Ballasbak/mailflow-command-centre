// Shared, side-effect-free identifier checks for the attention-queue core.
// One standard UUID shape (8-4-4-4-12) is used by enqueue, recovery and worker.
// Keep this validator centralized: a shortened regex previously broke both
// queue and recovery without reaching the database.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLUGIN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isPluginId(value) {
  return typeof value === 'string' && PLUGIN_RE.test(value);
}
