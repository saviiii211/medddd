/**
 * Core pure business logic for UMFCD MedFlash tests and flashcards.
 * Decoupled for fast-feedback unit testing.
 */

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  category: string;
  status: 'known' | 'unknown' | 'unseen';
}

export interface QuizQuestion {
  id: string;
  number: number;
  type: 'CS' | 'CG'; // CS = Complement Simplu (A-E), CG = Complement Grupat (1,2,3,4)
  stem: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
    E: string;
  };
  correctLetter: string; // 'A' | 'B' | 'C' | 'D' | 'E'
  explanation: string;
  sourceQuote?: string;
  userChoice: string | null;
}

/**
 * Validates Complement Grupat (CG) proposition combinations according to official UMFCD admission rules:
 * A = 1, 2, 3
 * B = 1, 3
 * C = 2, 4
 * D = 4
 * E = toate (1, 2, 3, 4) sau altă combinație / niciuna
 */
export function getCGKeyFromPropositions(props: number[]): 'A' | 'B' | 'C' | 'D' | 'E' {
  const sorted = [...props].sort((a, b) => a - b);
  const key = sorted.join(',');

  if (key === '1,2,3') return 'A';
  if (key === '1,3') return 'B';
  if (key === '2,4') return 'C';
  if (key === '4') return 'D';
  return 'E';
}

/**
 * Calculates score and statistics for a test.
 */
export function calculateQuizScore(questions: QuizQuestion[]): {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  scorePercentage: number;
} {
  const total = questions.length;
  let answered = 0;
  let correct = 0;

  for (const q of questions) {
    if (q.userChoice) {
      answered++;
      if (q.userChoice.trim().toUpperCase() === q.correctLetter.trim().toUpperCase()) {
        correct++;
      }
    }
  }

  const wrong = answered - correct;
  const scorePercentage = total > 0 ? Math.round((correct / total) * 100) : 0;

  return { total, answered, correct, wrong, scorePercentage };
}

/**
 * Calculates learning deck statistics.
 */
export function calculateDeckStats(cards: Flashcard[]): {
  total: number;
  known: number;
  unknown: number;
  unseen: number;
  progressPercent: number;
} {
  const total = cards.length;
  let known = 0;
  let unknown = 0;
  let unseen = 0;

  for (const card of cards) {
    if (card.status === 'known') known++;
    else if (card.status === 'unknown') unknown++;
    else unseen++;
  }

  const progressPercent = total > 0 ? Math.round((known / total) * 100) : 0;
  return { total, known, unknown, unseen, progressPercent };
}

/**
 * Intelligent text chunking from extracted PDF content for batch processing.
 */
export function getPdfChunkForBatch(
  fullText: string,
  batchIndex: number,
  totalBatches: number,
  maxChars = 16000
): string {
  if (!fullText) return '';
  if (fullText.length <= maxChars || totalBatches <= 1) {
    return fullText.slice(0, maxChars);
  }
  const step = Math.max(1000, Math.floor((fullText.length - maxChars) / (totalBatches - 1)));
  const start = Math.min(batchIndex * step, Math.max(0, fullText.length - maxChars));
  return fullText.slice(start, start + maxChars);
}
