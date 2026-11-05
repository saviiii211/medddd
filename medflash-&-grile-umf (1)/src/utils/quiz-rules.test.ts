import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCGKeyFromPropositions,
  calculateQuizScore,
  calculateDeckStats,
  getPdfChunkForBatch,
  QuizQuestion,
  Flashcard
} from './quiz-rules.ts';

test('getCGKeyFromPropositions maps UMFCD combinations correctly', () => {
  assert.equal(getCGKeyFromPropositions([1, 2, 3]), 'A');
  assert.equal(getCGKeyFromPropositions([3, 1, 2]), 'A'); // order invariant
  assert.equal(getCGKeyFromPropositions([1, 3]), 'B');
  assert.equal(getCGKeyFromPropositions([3, 1]), 'B');
  assert.equal(getCGKeyFromPropositions([2, 4]), 'C');
  assert.equal(getCGKeyFromPropositions([4]), 'D');
  assert.equal(getCGKeyFromPropositions([1, 2, 3, 4]), 'E'); // all correct
  assert.equal(getCGKeyFromPropositions([]), 'E'); // none correct
  assert.equal(getCGKeyFromPropositions([1, 4]), 'E'); // alternative combination
});

test('calculateQuizScore calculates correct, wrong and score percentage', () => {
  const dummyQuestions: QuizQuestion[] = [
    {
      id: 'q1',
      number: 1,
      type: 'CS',
      stem: 'Care este rolul ribozomilor?',
      options: { A: 'Sinteza proteinelor', B: 'Lipide', C: 'ADN', D: 'ARN', E: 'Niciunul' },
      correctLetter: 'A',
      explanation: 'Ribozomii sintetizează proteine.',
      userChoice: 'A'
    },
    {
      id: 'q2',
      number: 2,
      type: 'CS',
      stem: 'Unde se află ADN-ul celular?',
      options: { A: 'În perete', B: 'În nucleu', C: 'În ribozom', D: 'În lizozom', E: 'În vezicule' },
      correctLetter: 'B',
      explanation: 'În nucleu.',
      userChoice: 'C' // wrong
    },
    {
      id: 'q3',
      number: 3,
      type: 'CS',
      stem: 'Mitocondriile produc ATP?',
      options: { A: 'Da', B: 'Nu', C: 'Uneori', D: 'Doar noaptea', E: 'Niciodată' },
      correctLetter: 'A',
      explanation: 'Da, produc ATP.',
      userChoice: null // unanswered
    }
  ];

  const score = calculateQuizScore(dummyQuestions);
  assert.equal(score.total, 3);
  assert.equal(score.answered, 2);
  assert.equal(score.correct, 1);
  assert.equal(score.wrong, 1);
  assert.equal(score.scorePercentage, 33);
});

test('calculateDeckStats computes cards learning progress', () => {
  const dummyCards: Flashcard[] = [
    { id: '1', front: 'F1', back: 'B1', category: 'C1', status: 'known' },
    { id: '2', front: 'F2', back: 'B2', category: 'C1', status: 'known' },
    { id: '3', front: 'F3', back: 'B3', category: 'C1', status: 'unknown' },
    { id: '4', front: 'F4', back: 'B4', category: 'C1', status: 'unseen' },
  ];

  const stats = calculateDeckStats(dummyCards);
  assert.equal(stats.total, 4);
  assert.equal(stats.known, 2);
  assert.equal(stats.unknown, 1);
  assert.equal(stats.unseen, 1);
  assert.equal(stats.progressPercent, 50);
});

test('getPdfChunkForBatch chunks text within boundaries', () => {
  const sample = 'A'.repeat(50000);
  const chunk0 = getPdfChunkForBatch(sample, 0, 3, 10000);
  assert.equal(chunk0.length, 10000);

  const chunkShort = getPdfChunkForBatch('Short text', 0, 1, 5000);
  assert.equal(chunkShort, 'Short text');
});
