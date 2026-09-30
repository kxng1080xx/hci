import assert from 'node:assert/strict';
import test from 'node:test';
import { AVATARS, LIMIT_MS, QUESTIONS, phaseAt, points, validateAnswer, validateJoin } from '../src/quiz.js';

const pid = 'a1b2c3d4e5f6a1b2c3d4e5f6';

test('answer key matches the handout', () => {
  assert.deepEqual(QUESTIONS.map((q) => 'ABCD'[q.answer]).join(''), 'BDCADABC');
  for (const q of QUESTIONS) assert.equal(q.options.length, 4);
});

test('faster correct answers score more', () => {
  assert.equal(points(0), 1000);
  assert.equal(points(LIMIT_MS), 500);
  assert.equal(points(LIMIT_MS * 5), 500);
  assert.ok(points(2000) > points(8000));
});

test('phase follows the clock', () => {
  const st = { phase: 'question', q: 0, started_at: 10_000 };
  assert.equal(phaseAt(st, 9_000, 0, 5), 'ready');
  assert.equal(phaseAt(st, 12_000, 2, 5), 'question');
  assert.equal(phaseAt(st, 12_000, 5, 5), 'reveal'); // everyone answered
  assert.equal(phaseAt(st, 10_000 + LIMIT_MS, 0, 5), 'reveal');
  assert.equal(phaseAt({ ...st, phase: 'lobby' }, 12_000, 0, 5), 'lobby');
});

test('join and answer validation', () => {
  assert.deepEqual(validateJoin({ pid, nickname: '  Ann\n ', avatar: AVATARS[0] }), { pid, nickname: 'Ann', avatar: AVATARS[0] });
  for (const b of [{ pid, nickname: ' ', avatar: AVATARS[0] }, { pid, nickname: 'A', avatar: '💩' }, { pid: 'x', nickname: 'A', avatar: AVATARS[0] }, null]) {
    assert.equal(typeof validateJoin(b), 'string');
  }
  assert.deepEqual(validateAnswer({ pid, q: 7, choice: 3 }), { pid, q: 7, choice: 3 });
  for (const b of [{ pid, q: 8, choice: 0 }, { pid, q: 0, choice: 4 }, { pid, q: '1', choice: 0 }]) {
    assert.equal(typeof validateAnswer(b), 'string');
  }
});
