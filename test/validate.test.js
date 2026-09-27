import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResponse } from '../src/validate.js';

const ok = {
  pid: 'a1b2c3d4e5f6a1b2c3d4e5f6', round: 2, design: 'bad', task: 'payment', feeling: 1,
  words: ['Anxious', 'Blamed'], comment: '  scary\n\u0007 ', attempts: 3, seconds: 41, skipped: true,
};

test('accepts a valid response and cleans it', () => {
  const r = validateResponse(ok);
  assert.equal(r.comment, 'scary');
  assert.equal(r.words, '["Anxious","Blamed"]');
  assert.equal(r.skipped, 1);
});

test('rejects bad input', () => {
  for (const patch of [
    { pid: 'x' }, { round: 5 }, { design: 'good' }, { task: 'signup' }, { feeling: 0 }, { feeling: 2.5 },
    { words: ['Happy'] }, { words: ['Calm', 'Calm'] }, { words: 'Calm' }, { attempts: -1 }, { seconds: 1e6 },
    { skipped: 'yes' }, { comment: 'x'.repeat(201) }, { comment: 5 },
  ]) assert.equal(typeof validateResponse({ ...ok, ...patch }), 'string', JSON.stringify(patch));
  assert.equal(typeof validateResponse(null), 'string');
});
