export const ROUNDS = { 1: ['bad', 'signup'], 2: ['bad', 'payment'], 3: ['good', 'signup'], 4: ['good', 'payment'] };
export const WORDS = ['Frustrated', 'Confused', 'Anxious', 'Blamed', 'Annoyed', 'Calm', 'Helped', 'In control'];
export const PID = /^[a-f0-9]{24}$/;

const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Trim, drop control characters, collapse whitespace, cap length.
export const clean = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';

// Returns a row ready to insert, or a string describing the first problem.
export function validateResponse(b) {
  if (!b || typeof b !== 'object') return 'body must be a JSON object';
  if (typeof b.pid !== 'string' || !PID.test(b.pid)) return 'bad pid';
  if (!int(b.round, 1, 4)) return 'round must be 1-4';
  const [design, task] = ROUNDS[b.round];
  if (b.design !== design) return 'design does not match round';
  if (b.task !== task) return 'task does not match round';
  if (!int(b.feeling, 1, 5)) return 'feeling must be 1-5';
  if (!Array.isArray(b.words) || b.words.length > WORDS.length) return 'words must be an array';
  if (!b.words.every((w) => WORDS.includes(w))) return 'unknown word';
  if (new Set(b.words).size !== b.words.length) return 'duplicate word';
  if (b.comment != null && typeof b.comment !== 'string') return 'comment must be text';
  if (typeof b.comment === 'string' && b.comment.length > 200) return 'comment too long';
  if (!int(b.attempts, 0, 99)) return 'attempts out of range';
  if (!int(b.seconds, 0, 3600)) return 'seconds out of range';
  if (typeof b.skipped !== 'boolean') return 'skipped must be true or false';
  return {
    pid: b.pid, round: b.round, design, task, feeling: b.feeling,
    words: JSON.stringify(b.words), comment: clean(b.comment, 80),
    attempts: b.attempts, seconds: b.seconds, skipped: b.skipped ? 1 : 0,
  };
}
