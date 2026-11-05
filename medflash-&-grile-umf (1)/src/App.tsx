/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Flashcard,
  QuizQuestion,
  calculateQuizScore,
  calculateDeckStats,
  getPdfChunkForBatch,
} from './utils/quiz-rules.ts';

interface StudyFolder {
  id: string;
  ownerKey: string;
  name: string;
  description: string;
  pdfName: string;
  pdfPageCount: number;
  createdAt: number;
  flashcards: Flashcard[];
}

interface StudyTest {
  id: string;
  ownerKey: string;
  folderId: string;
  title: string;
  createdAt: number;
  completed: boolean;
  totalTarget?: number;
  questions: QuizQuestion[];
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

const DEMO_MEDICAL_TEXT = `Capitolul 1: Celula UMFCD - Structură și Funcții
Celula reprezintă unitatea morfo-funcțională și genetică a organismului uman. Membrana celulară (plasmalema) prezintă o structură trilaminată conform modelului mozaicului fluid formulat de Singer și Nicolson (1972), având un bistrat lipidic fosfolipidic în care sunt integrate proteine transmembranare și periferice. Glucidele se găsesc exclusiv pe fața externă a membranei, formând glicocalixul, cu rol în recunoașterea celulară și aderență.
Mitocondriile sunt organite celulare delimitate de două membrane: o membrană externă netedă și o membrană internă cutată, formând criste mitocondriale. În matricea mitocondrială se găsește ADN mitocondrial circular dublu catenar, ribozomi de tip 70S și enzimele ciclului Krebs (ciclul acizilor tricarboxilici). Pe criste se află complexele lanțului respirator și ATP-sintetaza, responsabilă de fosforilarea oxidativă.
Ribozomii (corpusculii lui Palade) au coeficient de sedimentare 80S la eucariote și sunt alcătuiți din două subunități: mare (60S) și mică (40S). Aceștia sintetizează proteine prin translație.
Reticulul endoplasmatic rugos (RER) prezintă ribozomi atașați pe fața externă și este specializat în sinteza proteinelor de export și membranare. Reticulul endoplasmatic neted (REN) nu are ribozomi și este implicat în sinteza lipidelor, a hormonilor steroizi și în detoxifierea celulară prin citocromul P450.
Aparatul Golgi este format din dictiozomi (cisterne aplatizate) și vezicule asociate, având o față cis (formare) orientată spre reticul și o față trans (maturare) orientată spre membrana celulară.`;

export default function App() {
  // Authentication & Profile
  const [currentUser, setCurrentUser] = useState<string>('');
  const [userPin, setUserPin] = useState<string>('');
  const [profileKey, setProfileKey] = useState<string>('');
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(true);

  // Core State
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<StudyTest[]>([]);
  const [customApiKey, setCustomApiKey] = useState<string>('');

  // Navigation
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'swipe' | 'manage' | 'tests'>('swipe');
  const [activeTestId, setActiveTestId] = useState<string | null>(null);

  // Swipe Deck State
  const [studyOnlyUnknown, setStudyOnlyUnknown] = useState<boolean>(false);
  const [studyDeckIds, setStudyDeckIds] = useState<string[]>([]);
  const [currentCardPointer, setCurrentCardPointer] = useState<number>(0);
  const [isCardFlipped, setIsCardFlipped] = useState<boolean>(false);
  const [cardSearchTerm, setCardSearchTerm] = useState<string>('');

  // Quiz Player State
  const [quizFilter, setQuizFilter] = useState<'all' | 'cs' | 'cg' | 'wrong'>('all');
  const [isAsyncGenerating, setIsAsyncGenerating] = useState<boolean>(false);
  const [asyncBannerInfo, setAsyncBannerInfo] = useState<{ current: number; total: number } | null>(null);

  // Modals
  const [isFolderModalOpen, setIsFolderModalOpen] = useState<boolean>(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderNameInput, setFolderNameInput] = useState<string>('');
  const [folderDescInput, setFolderDescInput] = useState<string>('');

  const [isCardModalOpen, setIsCardModalOpen] = useState<boolean>(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardFrontInput, setCardFrontInput] = useState<string>('');
  const [cardBackInput, setCardBackInput] = useState<string>('');
  const [cardTagInput, setCardTagInput] = useState<string>('');

  const [isGenCardsModalOpen, setIsGenCardsModalOpen] = useState<boolean>(false);
  const [genCardsCount, setGenCardsCount] = useState<number>(25);

  const [isGenTestModalOpen, setIsGenTestModalOpen] = useState<boolean>(false);
  const [testTitleInput, setTestTitleInput] = useState<string>('');
  const [testFormatInput, setTestFormatInput] = useState<number>(60);

  const [isSourceTextModalOpen, setIsSourceTextModalOpen] = useState<boolean>(false);
  const [sourceTextEditor, setSourceTextEditor] = useState<string>('');

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [tempApiKeyInput, setTempApiKeyInput] = useState<string>('');
  const [isValidatingKey, setIsValidatingKey] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [showKeyText, setShowKeyText] = useState<boolean>(false);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: () => {},
  });

  const [loadingOverlay, setLoadingOverlay] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    progress: number;
  }>({
    isOpen: false,
    title: '',
    subtitle: '',
    progress: 0,
  });

  const [toasts, setToasts] = useState<Toast[]>([]);

  // Toast Helper
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = 'tst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  };

  // Load Initial Storage on Profile Change
  useEffect(() => {
    const savedUser = localStorage.getItem('medflash_active_user');
    if (savedUser) {
      setCurrentUser(savedUser);
      const cleanKey = savedUser.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      setProfileKey(cleanKey);
      setIsAuthOpen(false);
      loadUserData(cleanKey);
    }
  }, []);

  const loadUserData = (key: string) => {
    try {
      const storedFolders = localStorage.getItem(`medflash_folders_${key}`);
      const storedTests = localStorage.getItem(`medflash_tests_${key}`);
      const storedSources = localStorage.getItem(`medflash_sources_${key}`);
      const storedKey = localStorage.getItem(`medflash_apikey_${key}`);

      if (storedFolders) setFolders(JSON.parse(storedFolders));
      else {
        // Seed initial welcoming medical sample folder
        const defaultFolder: StudyFolder = {
          id: 'fld_demo_celula',
          ownerKey: key,
          name: 'Capitolul 1: Celula & Organite',
          description: 'Material introductiv UMFCD - Manual Biologie XI',
          pdfName: 'Curs_Biologie_Celula_UMFCD.pdf',
          pdfPageCount: 14,
          createdAt: Date.now(),
          flashcards: [
            {
              id: 'crd_seed_1',
              front: 'Care este modelul structural al membranei celulare propus de Singer și Nicolson?',
              back: 'Modelul mozaicului fluid (1972): bistrat fosfolipidic cu proteine transmembranare și periferice integrate.',
              category: 'Membrana Celulară',
              status: 'unseen',
            },
            {
              id: 'crd_seed_2',
              front: 'Unde se găsesc enzimele ciclului Krebs și ADN-ul mitocondrial?',
              back: 'În matricea mitocondrială (ADN circular dublu catenar, ribozomi 70S și enzime Krebs).',
              category: 'Mitocondrii',
              status: 'unseen',
            },
            {
              id: 'crd_seed_3',
              front: 'Ce coeficient de sedimentare au ribozomii eucarioți și din ce subunități sunt compuși?',
              back: 'Coeficient de 80S, formați dintr-o subunitate mare (60S) și o subunitate mică (40S).',
              category: 'Ribozomi',
              status: 'unseen',
            },
          ],
        };
        setFolders([defaultFolder]);
        localStorage.setItem(`medflash_folders_${key}`, JSON.stringify([defaultFolder]));
      }

      if (storedTests) setTests(JSON.parse(storedTests));
      if (storedSources) setSources(JSON.parse(storedSources));
      else {
        const seedSources = { fld_demo_celula: DEMO_MEDICAL_TEXT };
        setSources(seedSources);
        localStorage.setItem(`medflash_sources_${key}`, JSON.stringify(seedSources));
      }

      if (storedKey) {
        setCustomApiKey(storedKey);
        setTempApiKeyInput(storedKey);
      }
    } catch (e) {
      console.warn('Eroare la încărcarea datelor locale:', e);
    }
  };

  const persistFolders = (newFolders: StudyFolder[]) => {
    setFolders(newFolders);
    if (profileKey) {
      localStorage.setItem(`medflash_folders_${profileKey}`, JSON.stringify(newFolders));
    }
  };

  const persistTests = (newTests: StudyTest[]) => {
    setTests(newTests);
    if (profileKey) {
      localStorage.setItem(`medflash_tests_${profileKey}`, JSON.stringify(newTests));
    }
  };

  const persistSources = (newSources: Record<string, string>) => {
    setSources(newSources);
    if (profileKey) {
      localStorage.setItem(`medflash_sources_${profileKey}`, JSON.stringify(newSources));
    }
  };

  // Active Folder
  const activeFolder = useMemo(() => {
    return folders.find((f) => f.id === activeFolderId) || null;
  }, [folders, activeFolderId]);

  // Active Test
  const activeTest = useMemo(() => {
    return tests.find((t) => t.id === activeTestId) || null;
  }, [tests, activeTestId]);

  // Rebuild Deck when folder or filter changes
  useEffect(() => {
    if (!activeFolder) {
      setStudyDeckIds([]);
      return;
    }
    const cards = activeFolder.flashcards || [];
    let ids: string[] = [];
    if (studyOnlyUnknown) {
      ids = cards.filter((c) => c.status === 'unknown').map((c) => c.id);
    } else {
      ids = cards.map((c) => c.id);
    }
    setStudyDeckIds(ids);
    setCurrentCardPointer(0);
    setIsCardFlipped(false);
  }, [activeFolderId, studyOnlyUnknown]);

  // Handle Login
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = currentUser.trim();
    if (!cleanUser) {
      showToast('Introdu un nume de utilizator!', 'error');
      return;
    }
    const normKey = cleanUser.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    setProfileKey(normKey);
    localStorage.setItem('medflash_active_user', cleanUser);
    setIsAuthOpen(false);
    loadUserData(normKey);
    showToast(`Bine ai venit, ${cleanUser}!`, 'success');
  };

  // Switch User
  const handleSwitchUser = () => {
    setIsAuthOpen(true);
  };

  // Open Folder
  const handleOpenFolder = (folderId: string) => {
    setActiveFolderId(folderId);
    setActiveTab('swipe');
    setActiveTestId(null);
    setStudyOnlyUnknown(false);
  };

  const handleNavigateDashboard = () => {
    setActiveFolderId(null);
    setActiveTestId(null);
  };

  // Handle PDF Upload
  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeFolder) return;

    setLoadingOverlay({
      isOpen: true,
      title: 'Se citește PDF-ul...',
      subtitle: 'Extragem textul pagină cu pagină cu PDF.js.',
      progress: 20,
    });

    try {
      if (!window.pdfjsLib) {
        throw new Error('Biblioteca PDF.js nu este încărcată.');
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      let fullText = '';

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const txt = await page.getTextContent();
        fullText += `\n[Pagina ${i}]\n` + txt.items.map((item: any) => item.str).join(' ') + '\n';
        if (i % 5 === 0 || i === numPages) {
          setLoadingOverlay((prev) => ({
            ...prev,
            progress: 20 + Math.round((i / numPages) * 70),
          }));
        }
      }

      const cleanText = fullText.trim();
      const updatedSources = { ...sources, [activeFolder.id]: cleanText };
      persistSources(updatedSources);

      const updatedFolders = folders.map((f) => {
        if (f.id === activeFolder.id) {
          return {
            ...f,
            pdfName: file.name,
            pdfPageCount: numPages,
          };
        }
        return f;
      });
      persistFolders(updatedFolders);

      setLoadingOverlay({ isOpen: false, title: '', subtitle: '', progress: 0 });
      showToast(`PDF încărcat cu succes (${numPages} pagini)!`, 'success');
    } catch (err: any) {
      console.error(err);
      setLoadingOverlay({ isOpen: false, title: '', subtitle: '', progress: 0 });
      showToast('Eroare la citirea PDF-ului: ' + (err.message || ''), 'error');
    } finally {
      event.target.value = '';
    }
  };

  // Save Manual Source Text
  const handleSaveManualSourceText = () => {
    if (!activeFolder) return;
    const updatedSources = { ...sources, [activeFolder.id]: sourceTextEditor };
    persistSources(updatedSources);
    setIsSourceTextModalOpen(false);
    showToast('Textul sursă a fost actualizat!', 'success');
  };

  // Use Demo Text for active folder
  const handleLoadDemoText = () => {
    if (!activeFolder) return;
    const updatedSources = { ...sources, [activeFolder.id]: DEMO_MEDICAL_TEXT };
    persistSources(updatedSources);
    setSourceTextEditor(DEMO_MEDICAL_TEXT);
    showToast('Textul demo UMFCD a fost încărcat în folder!', 'success');
  };

  // Flashcards Generation with Gemini 3.8 Flash
  const handleGenerateFlashcards = async () => {
    if (!activeFolder) return;
    const sourceText = sources[activeFolder.id] || '';
    if (!sourceText || sourceText.length < 20) {
      showToast('Încarcă un PDF sau adaugă text sursă în acest folder mai întâi!', 'error');
      return;
    }

    setIsGenCardsModalOpen(false);
    setLoadingOverlay({
      isOpen: true,
      title: 'Se generează flashcardurile...',
      subtitle: `Gemini 3.8 Flash extrage conceptele cheie (${genCardsCount} carduri)...`,
      progress: 35,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const response = await fetch('/api/gemini/generate-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: sourceText,
          count: genCardsCount,
          folderName: activeFolder.name,
          customApiKey: customApiKey || undefined,
        }),
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Eroare HTTP ${response.status}`);
      }

      const resData = await response.json();
      const rawList = resData.flashcards || [];

      const newCards: Flashcard[] = rawList.map((item: any, idx: number) => ({
        id: 'crd_' + Date.now() + '_' + idx,
        front: item.front,
        back: item.back,
        category: item.category || activeFolder.name,
        status: 'unseen',
      }));

      const updatedFolders = folders.map((f) => {
        if (f.id === activeFolder.id) {
          return {
            ...f,
            flashcards: [...(f.flashcards || []), ...newCards],
          };
        }
        return f;
      });

      persistFolders(updatedFolders);
      setStudyDeckIds([...(activeFolder.flashcards || []).map((c) => c.id), ...newCards.map((c) => c.id)]);
      setCurrentCardPointer(0);
      setLoadingOverlay({ isOpen: false, title: '', subtitle: '', progress: 0 });
      setActiveTab('swipe');
      showToast(`Au fost generate ${newCards.length} flashcarduri rapid!`, 'success');
    } catch (err: any) {
      console.error(err);
      setLoadingOverlay({ isOpen: false, title: '', subtitle: '', progress: 0 });
      let msg = err.message || 'Verifică conexiunea sau cheia API.';
      if (err.name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout') || msg.includes('signal')) {
        msg = 'Generarea durează mai mult datorită volumului textului. Am optimizat procesul, te rugăm să reîncerci acum.';
      }
      showToast(msg, 'error');
      if (
        msg.toLowerCase().includes('cheia') ||
        msg.toLowerCase().includes('api key') ||
        msg.toLowerCase().includes('gemini')
      ) {
        setTimeout(() => {
          setTempApiKeyInput(customApiKey);
          setIsSettingsModalOpen(true);
        }, 900);
      }
    }
  };

  // Test Generation (Instant First Batch + Background Async Remaining Batches)
  const handleGenerateTest = async () => {
    if (!activeFolder) return;
    const sourceText = sources[activeFolder.id] || '';
    if (!sourceText || sourceText.length < 20) {
      showToast('Încarcă un PDF în acest folder pentru a genera teste!', 'error');
      return;
    }

    const title = testTitleInput.trim() || `Test Admitere — ${activeFolder.name}`;
    const totalTarget = testFormatInput; // 60 or 20
    setIsGenTestModalOpen(false);

    setLoadingOverlay({
      isOpen: true,
      title: 'Se generează testul...',
      subtitle: 'Creăm primele 10 întrebări de complement simplu instant...',
      progress: 30,
    });

    try {
      // Step 1: Request initial batch (10 CS questions)
      const chunk1 = getPdfChunkForBatch(sourceText, 0, 4, 14000);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const res1 = await fetch('/api/gemini/generate-test-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: chunk1,
          count: 10,
          type: 'CS',
          startNumber: 1,
          customApiKey: customApiKey || undefined,
        }),
      });
      clearTimeout(timeoutId);

      if (!res1.ok) {
        const errJson = await res1.json().catch(() => ({}));
        throw new Error(errJson.error || `Eroare server (${res1.status})`);
      }

      const data1 = await res1.json();
      const initialQuestions: QuizQuestion[] = data1.questions || [];

      const newTestId = 'tst_' + Date.now();
      const newTest: StudyTest = {
        id: newTestId,
        ownerKey: profileKey,
        folderId: activeFolder.id,
        title,
        createdAt: Date.now(),
        completed: false,
        totalTarget,
        questions: initialQuestions,
      };

      const updatedTests = [newTest, ...tests];
      persistTests(updatedTests);

      setLoadingOverlay({ isOpen: false, title: '', subtitle: '', progress: 0 });
      setActiveTab('tests');
      setActiveTestId(newTestId);
      showToast('Primele 10 întrebări sunt gata! Poți începe rezolvarea.', 'success');

      // If user selected 60 questions (or 20), trigger background asynchronous batches
      if (totalTarget > 10) {
        setIsAsyncGenerating(true);
        setAsyncBannerInfo({ current: initialQuestions.length, total: totalTarget });

        // Run background batches asynchronously
        runBackgroundQuizBatches(newTestId, sourceText, totalTarget, initialQuestions);
      }
    } catch (err: any) {
      console.error(err);
      setLoadingOverlay({ isOpen: false, title: '', subtitle: '', progress: 0 });
      let msg = err.message || 'Nu s-a putut genera testul.';
      if (err.name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout') || msg.includes('signal')) {
        msg = 'Generarea durează mai mult datorită volumului textului. Am optimizat procesul, te rugăm să reîncerci acum.';
      }
      showToast(msg, 'error');
      if (
        msg.toLowerCase().includes('cheia') ||
        msg.toLowerCase().includes('api key') ||
        msg.toLowerCase().includes('gemini')
      ) {
        setTimeout(() => {
          setTempApiKeyInput(customApiKey);
          setIsSettingsModalOpen(true);
        }, 900);
      }
    }
  };

  const runBackgroundQuizBatches = async (
    testId: string,
    sourceText: string,
    targetCount: number,
    existingQuestions: QuizQuestion[]
  ) => {
    try {
      let accumulated = [...existingQuestions];

      if (targetCount === 60) {
        // Plan:
        // Batch 2: 10 CS (Q11-20)
        // Batch 3: 10 CS (Q21-30)
        // Batch 4: 15 CG (Q31-45)
        // Batch 5: 15 CG (Q46-60)
        const batches = [
          { type: 'CS' as const, count: 10, startNumber: 11, chunkIndex: 1 },
          { type: 'CS' as const, count: 10, startNumber: 21, chunkIndex: 2 },
          { type: 'CG' as const, count: 15, startNumber: 31, chunkIndex: 1 },
          { type: 'CG' as const, count: 15, startNumber: 46, chunkIndex: 3 },
        ];

        for (const batch of batches) {
          const chunk = getPdfChunkForBatch(sourceText, batch.chunkIndex, 4, 18000);
          const res = await fetch('/api/gemini/generate-test-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: chunk,
              count: batch.count,
              type: batch.type,
              startNumber: batch.startNumber,
              customApiKey: customApiKey || undefined,
            }),
          });

          if (res.ok) {
            const batchData = await res.json();
            const newQs: QuizQuestion[] = batchData.questions || [];
            accumulated = [...accumulated, ...newQs];

            // Re-number to ensure continuous numbering
            accumulated = accumulated.map((q, idx) => ({ ...q, number: idx + 1 }));

            setTests((prev) => {
              const updated = prev.map((t) => {
                if (t.id === testId) {
                  return { ...t, questions: accumulated };
                }
                return t;
              });
              if (profileKey) {
                localStorage.setItem(`medflash_tests_${profileKey}`, JSON.stringify(updated));
              }
              return updated;
            });

            setAsyncBannerInfo({ current: accumulated.length, total: targetCount });
          }
        }
      } else {
        // For 20 format: Batch 2 is 10 CG questions
        const chunk = getPdfChunkForBatch(sourceText, 1, 2, 18000);
        const res = await fetch('/api/gemini/generate-test-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: chunk,
            count: 10,
            type: 'CG',
            startNumber: 11,
            customApiKey: customApiKey || undefined,
          }),
        });

        if (res.ok) {
          const batchData = await res.json();
          const newQs: QuizQuestion[] = batchData.questions || [];
          accumulated = [...accumulated, ...newQs].map((q, idx) => ({ ...q, number: idx + 1 }));

          setTests((prev) => {
            const updated = prev.map((t) => {
              if (t.id === testId) {
                return { ...t, questions: accumulated };
              }
              return t;
            });
            if (profileKey) {
              localStorage.setItem(`medflash_tests_${profileKey}`, JSON.stringify(updated));
            }
            return updated;
          });
        }
      }

      setIsAsyncGenerating(false);
      setAsyncBannerInfo(null);
      showToast(`Toate cele ${accumulated.length} grile au fost generate!`, 'success');
    } catch (err) {
      console.warn('Background generation notice:', err);
      setIsAsyncGenerating(false);
      setAsyncBannerInfo(null);
    }
  };

  // Card Swipe Interactions
  const currentCard = useMemo(() => {
    if (!activeFolder || studyDeckIds.length === 0) return null;
    const cardId = studyDeckIds[currentCardPointer];
    return activeFolder.flashcards.find((c) => c.id === cardId) || null;
  }, [activeFolder, studyDeckIds, currentCardPointer]);

  const deckStats = useMemo(() => {
    if (!activeFolder) return { total: 0, known: 0, unknown: 0, unseen: 0, progressPercent: 0 };
    return calculateDeckStats(activeFolder.flashcards || []);
  }, [activeFolder]);

  const handleMarkCard = (status: 'known' | 'unknown') => {
    if (!activeFolder || !currentCard) return;

    const updatedFolders = folders.map((f) => {
      if (f.id === activeFolder.id) {
        const updatedCards = f.flashcards.map((c) => {
          if (c.id === currentCard.id) {
            return { ...c, status };
          }
          return c;
        });
        return { ...f, flashcards: updatedCards };
      }
      return f;
    });

    persistFolders(updatedFolders);
    setIsCardFlipped(false);
    setCurrentCardPointer((prev) => prev + 1);
  };

  const handleUndoCard = () => {
    if (currentCardPointer > 0) {
      setCurrentCardPointer((prev) => prev - 1);
      setIsCardFlipped(false);
    }
  };

  const handleShuffleDeck = () => {
    const shuffled = [...studyDeckIds].sort(() => Math.random() - 0.5);
    setStudyDeckIds(shuffled);
    setCurrentCardPointer(0);
    setIsCardFlipped(false);
    showToast('Cardurile au fost amestecate!', 'info');
  };

  const handleResetDeckProgress = () => {
    if (!activeFolder) return;
    const updatedFolders = folders.map((f) => {
      if (f.id === activeFolder.id) {
        return {
          ...f,
          flashcards: f.flashcards.map((c) => ({ ...c, status: 'unseen' as const })),
        };
      }
      return f;
    });
    persistFolders(updatedFolders);
    setStudyOnlyUnknown(false);
    showToast('Progres resetat!', 'info');
  };

  // Quiz Option Selection
  const handleSelectQuizOption = (questionId: string, letter: string) => {
    if (!activeTest) return;

    const updatedTests = tests.map((t) => {
      if (t.id === activeTest.id) {
        const updatedQs = t.questions.map((q) => {
          if (q.id === questionId) {
            return { ...q, userChoice: letter };
          }
          return q;
        });
        return { ...t, questions: updatedQs };
      }
      return t;
    });

    persistTests(updatedTests);
  };

  const handleFinishQuiz = () => {
    if (!activeTest) return;
    const updatedTests = tests.map((t) => {
      if (t.id === activeTest.id) {
        return { ...t, completed: true };
      }
      return t;
    });
    persistTests(updatedTests);
    showToast('Test finalizat cu succes! Baremele sunt vizibile.', 'success');
  };

  // Filtered Quiz Questions
  const filteredQuizQuestions = useMemo(() => {
    if (!activeTest) return [];
    return activeTest.questions.filter((q) => {
      if (quizFilter === 'cs') return q.type === 'CS';
      if (quizFilter === 'cg') return q.type === 'CG';
      if (quizFilter === 'wrong') return q.userChoice && q.userChoice !== q.correctLetter;
      return true;
    });
  }, [activeTest, quizFilter]);

  const quizScore = useMemo(() => {
    if (!activeTest) return { total: 0, answered: 0, correct: 0, wrong: 0, scorePercentage: 0 };
    return calculateQuizScore(activeTest.questions);
  }, [activeTest]);

  // Export / Import Backup
  const handleExportBackup = () => {
    const data = {
      username: currentUser,
      folders,
      sources,
      tests,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_medflash_${currentUser || 'studii'}.json`;
    a.click();
    showToast('Backup descărcat cu succes!', 'success');
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed.folders) persistFolders(parsed.folders);
        if (parsed.tests) persistTests(parsed.tests);
        if (parsed.sources) persistSources(parsed.sources);
        if (parsed.username) {
          setCurrentUser(parsed.username);
          setProfileKey(parsed.username.toLowerCase().replace(/[^a-z0-9_-]/g, '_'));
          localStorage.setItem('medflash_active_user', parsed.username);
        }
        showToast('Backup importat cu succes!', 'success');
      } catch (err) {
        showToast('Fișierul JSON de backup este invalid.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Folder modal handlers
  const handleSaveFolderForm = (e: React.FormEvent) => {
    e.preventDefault();
    const name = folderNameInput.trim();
    if (!name) return;

    if (editingFolderId) {
      const updated = folders.map((f) => {
        if (f.id === editingFolderId) {
          return { ...f, name, description: folderDescInput.trim() };
        }
        return f;
      });
      persistFolders(updated);
      showToast('Folder actualizat!', 'success');
    } else {
      const newFolder: StudyFolder = {
        id: 'fld_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        ownerKey: profileKey,
        name,
        description: folderDescInput.trim(),
        pdfName: '',
        pdfPageCount: 0,
        createdAt: Date.now(),
        flashcards: [],
      };
      persistFolders([newFolder, ...folders]);
      setActiveFolderId(newFolder.id);
      showToast('Folder nou creat!', 'success');
    }
    setIsFolderModalOpen(false);
  };

  const handleDeleteFolder = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    setConfirmModal({
      isOpen: true,
      title: `Ștergi folderul „${folder.name}”?`,
      message: 'Toate cardurile și testele din acest folder vor fi șterse.',
      action: () => {
        const updatedFolders = folders.filter((f) => f.id !== folderId);
        const updatedTests = tests.filter((t) => t.folderId !== folderId);
        persistFolders(updatedFolders);
        persistTests(updatedTests);
        if (activeFolderId === folderId) setActiveFolderId(null);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        showToast('Folderul a fost șters.', 'info');
      },
    });
  };

  // Card modal handlers
  const handleSaveCardForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFolder) return;
    const front = cardFrontInput.trim();
    const back = cardBackInput.trim();
    const category = cardTagInput.trim() || activeFolder.name;
    if (!front || !back) return;

    if (editingCardId) {
      const updatedFolders = folders.map((f) => {
        if (f.id === activeFolder.id) {
          return {
            ...f,
            flashcards: f.flashcards.map((c) =>
              c.id === editingCardId ? { ...c, front, back, category } : c
            ),
          };
        }
        return f;
      });
      persistFolders(updatedFolders);
      showToast('Card modificat!', 'success');
    } else {
      const newCard: Flashcard = {
        id: 'crd_' + Date.now(),
        front,
        back,
        category,
        status: 'unseen',
      };
      const updatedFolders = folders.map((f) => {
        if (f.id === activeFolder.id) {
          return {
            ...f,
            flashcards: [newCard, ...f.flashcards],
          };
        }
        return f;
      });
      persistFolders(updatedFolders);
      showToast('Card adăugat!', 'success');
    }
    setIsCardModalOpen(false);
  };

  const handleDeleteCard = (cardId: string) => {
    if (!activeFolder) return;
    const updatedFolders = folders.map((f) => {
      if (f.id === activeFolder.id) {
        return {
          ...f,
          flashcards: f.flashcards.filter((c) => c.id !== cardId),
        };
      }
      return f;
    });
    persistFolders(updatedFolders);
    showToast('Card șters.', 'info');
  };

  const handleDeleteTest = (testId: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Ștergi acest test?',
      message: 'Rezultatele și răspunsurile tale la acest test vor fi eliminate.',
      action: () => {
        const updated = tests.filter((t) => t.id !== testId);
        persistTests(updated);
        if (activeTestId === testId) setActiveTestId(null);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        showToast('Testul a fost șters.', 'info');
      },
    });
  };

  // Validate API Key with live probe to server
  const handleValidateApiKey = async () => {
    let raw = tempApiKeyInput.trim();
    raw = raw.replace(/^(GEMINI_API_KEY|API_KEY|KEY)\s*[:=]\s*/i, '');
    raw = raw.replace(/^Bearer\s+/i, '');
    raw = raw.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '');
    raw = raw.replace(/[\r\n\t\s]/g, '');

    if (!raw && !customApiKey) {
      setValidationResult({
        success: false,
        message: 'Introdu o cheie API mai întâi sau lasă gol doar dacă este setată cheia pe server.',
      });
      return;
    }

    setIsValidatingKey(true);
    setValidationResult(null);

    try {
      const res = await fetch('/api/gemini/validate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: raw || customApiKey }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setValidationResult({
          success: true,
          message: data.message || 'Cheia API este 100% validă și funcțională!',
        });
        showToast('Cheia API funcționează perfect!', 'success');
      } else {
        setValidationResult({
          success: false,
          message: data.error || 'Cheia API nu a putut fi validată. Verifică formatul sau generează una nouă.',
        });
        showToast('Eroare la cheia API', 'error');
      }
    } catch (err: any) {
      setValidationResult({
        success: false,
        message: err.message || 'Eroare de rețea la validarea cheii.',
      });
      showToast('Eroare de conexiune la verificare', 'error');
    } finally {
      setIsValidatingKey(false);
    }
  };

  // Save Settings Modal
  const handleSaveSettings = () => {
    let key = tempApiKeyInput.trim();
    key = key.replace(/^(GEMINI_API_KEY|API_KEY|KEY)\s*[:=]\s*/i, '');
    key = key.replace(/^Bearer\s+/i, '');
    key = key.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '');
    key = key.replace(/[\r\n\t\s]/g, '');

    setCustomApiKey(key);
    setTempApiKeyInput(key);
    if (profileKey) {
      localStorage.setItem(`medflash_apikey_${profileKey}`, key);
    }
    setIsSettingsModalOpen(false);
    setValidationResult(null);
    showToast(
      key ? 'Cheie API salvată cu succes!' : 'Setări salvate! Se folosește cheia de sistem.',
      'success'
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-teal-500 selection:text-white">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-2xl shadow-xl text-xs sm:text-sm font-semibold text-white transition-all transform pointer-events-auto ${
              toast.type === 'success'
                ? 'bg-emerald-600'
                : toast.type === 'error'
                ? 'bg-rose-600'
                : 'bg-slate-900'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* Auth Screen Modal */}
      {isAuthOpen && (
        <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 via-teal-950 to-slate-900 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white/95 backdrop-blur-xl w-full max-w-md rounded-3xl shadow-2xl border border-white/20 p-6 sm:p-8 my-auto">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-600 to-teal-400 text-white mx-auto mb-5 shadow-lg shadow-teal-500/30">
              <i className="fa-solid fa-stethoscope text-2xl"></i>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-center text-slate-900 tracking-tight">
              MedFlash & Grile UMF
            </h1>
            <p className="text-center text-slate-500 text-sm mt-2 mb-6">
              Introdu numele tău pentru a accesa folderele, flashcardurile și testele tale salvate.
            </p>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Numele tău de utilizator
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-slate-400">
                    <i className="fa-solid fa-user-doctor"></i>
                  </span>
                  <input
                    type="text"
                    required
                    value={currentUser}
                    onChange={(e) => setCurrentUser(e.target.value)}
                    placeholder="ex: maria_umfcd"
                    className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 outline-none font-medium text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  PIN / Cod secret (opțional)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-slate-400">
                    <i className="fa-solid fa-lock"></i>
                  </span>
                  <input
                    type="password"
                    value={userPin}
                    onChange={(e) => setUserPin(e.target.value)}
                    placeholder="ex: 1234 (sau lasă gol)"
                    className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 outline-none font-medium text-slate-800"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white font-bold text-base shadow-lg shadow-teal-600/25 active:scale-[0.99] transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Intră în contul meu</span>
                <i className="fa-solid fa-arrow-right"></i>
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(true)}
                className="text-teal-700 hover:underline font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-gear"></i> Setări API
              </button>
              <label className="text-slate-600 hover:underline font-semibold flex items-center gap-1.5 cursor-pointer">
                <i className="fa-solid fa-file-import"></i> Importă Backup
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleImportBackup}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {activeFolderId && (
              <button
                onClick={handleNavigateDashboard}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition shrink-0 cursor-pointer"
              >
                <i className="fa-solid fa-chevron-left"></i>
              </button>
            )}
            <div
              onClick={handleNavigateDashboard}
              className="flex items-center gap-2.5 cursor-pointer truncate"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-600 to-teal-400 text-white flex items-center justify-center shadow-sm shrink-0">
                <i className="fa-solid fa-dna text-sm"></i>
              </div>
              <div className="truncate">
                <span className="font-extrabold text-base sm:text-lg text-slate-900 tracking-tight block leading-none truncate">
                  {activeFolder ? activeFolder.name : 'MedFlash UMF'}
                </span>
                <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                  <span>Gemini 3.8 Flash Activ</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleExportBackup}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <i className="fa-solid fa-download text-teal-600"></i>
              <span className="hidden md:inline">Backup</span>
            </button>
            <button
              onClick={() => {
                setTempApiKeyInput(customApiKey);
                setIsSettingsModalOpen(true);
              }}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <i className="fa-solid fa-sliders text-slate-600"></i>
              <span className="hidden lg:inline">Setări AI</span>
            </button>
            <button
              onClick={handleSwitchUser}
              className="py-2 px-3 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold flex items-center gap-1.5 transition max-w-[140px] truncate cursor-pointer"
            >
              <i className="fa-solid fa-circle-user text-teal-600"></i>
              <span className="truncate">{currentUser || 'Utilizator'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-6 py-5 pb-24">
        {/* VIEW 1: DASHBOARD / FOLDERE */}
        {!activeFolderId && (
          <section className="space-y-6">
            <div className="bg-gradient-to-r from-teal-900 via-teal-800 to-teal-700 rounded-3xl p-5 sm:p-7 text-white shadow-xl relative overflow-hidden">
              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5 max-w-xl">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs font-semibold">
                    <i className="fa-solid fa-graduation-cap"></i>
                    <span>Pregătire Admitere UMFCD & Biologie</span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-extrabold">Folderele tale de studiu</h2>
                  <p className="text-teal-100 text-xs sm:text-sm leading-relaxed">
                    Organizează capitolele, încarcă PDF-ul și generează carduri sau teste grilă rapide cu Gemini 3.8 Flash.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingFolderId(null);
                    setFolderNameInput('');
                    setFolderDescInput('');
                    setIsFolderModalOpen(true);
                  }}
                  className="py-3.5 px-5 rounded-2xl bg-white text-teal-950 hover:bg-teal-50 font-extrabold text-sm shadow-lg active:scale-95 transition flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                >
                  <i className="fa-solid fa-folder-plus text-teal-600 text-base"></i>
                  <span>Folder Nou</span>
                </button>
              </div>
            </div>

            {/* Dashboard Stats */}
            <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
              <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-slate-200 shadow-sm flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                  <i className="fa-solid fa-folder-open"></i>
                </div>
                <div className="min-w-0">
                  <div className="text-lg sm:text-2xl font-extrabold leading-tight">
                    {folders.length}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">Foldere</div>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-slate-200 shadow-sm flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <i className="fa-solid fa-layer-group"></i>
                </div>
                <div className="min-w-0">
                  <div className="text-lg sm:text-2xl font-extrabold leading-tight">
                    {folders.reduce((acc, f) => acc + (f.flashcards ? f.flashcards.length : 0), 0)}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">Carduri</div>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-slate-200 shadow-sm flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <i className="fa-solid fa-list-check"></i>
                </div>
                <div className="min-w-0">
                  <div className="text-lg sm:text-2xl font-extrabold leading-tight">
                    {tests.length}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">Teste</div>
                </div>
              </div>
            </div>

            {/* Folders Grid */}
            {folders.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {folders.map((folder) => {
                  const cards = folder.flashcards || [];
                  const knownCount = cards.filter((c) => c.status === 'known').length;
                  const unknownCount = cards.filter((c) => c.status === 'unknown').length;
                  const folderTests = tests.filter((t) => t.folderId === folder.id);
                  const progressPercent = cards.length > 0 ? Math.round((knownCount / cards.length) * 100) : 0;

                  return (
                    <div
                      key={folder.id}
                      onClick={() => handleOpenFolder(folder.id)}
                      className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition flex flex-col justify-between cursor-pointer group"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition">
                            <i className="fa-solid fa-book-medical text-lg"></i>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFolder(folder.id);
                            }}
                            className="w-8 h-8 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition cursor-pointer"
                          >
                            <i className="fa-regular fa-trash-can text-sm"></i>
                          </button>
                        </div>
                        <h3 className="font-extrabold text-base sm:text-lg text-slate-900 line-clamp-1">
                          {folder.name}
                        </h3>
                        <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                          {folder.description || (folder.pdfName ? `PDF: ${folder.pdfName}` : 'Fără PDF')}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-4 text-xs font-semibold">
                          <span className="px-2.5 py-1 rounded-xl bg-amber-50 text-amber-800">
                            <i className="fa-solid fa-layer-group mr-1"></i>
                            {cards.length} carduri
                          </span>
                          <span className="px-2.5 py-1 rounded-xl bg-indigo-50 text-indigo-800">
                            <i className="fa-solid fa-list-check mr-1"></i>
                            {folderTests.length} teste
                          </span>
                          {unknownCount > 0 && (
                            <span className="px-2.5 py-1 rounded-xl bg-rose-50 text-rose-700 font-bold">
                              {unknownCount} de reluat
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-100">
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                          <span>Progres</span>
                          <span className="text-teal-700">{progressPercent}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-teal-500 h-full transition-all duration-300"
                            style={{ width: `${progressPercent}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto mb-4 text-2xl">
                  <i className="fa-solid fa-folder-plus"></i>
                </div>
                <h3 className="text-lg font-bold text-slate-800">Nu ai creat niciun folder</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto mt-1 mb-5">
                  Creează primul tău folder (ex: „Capitolul 1 - Celula”) pentru a începe.
                </p>
                <button
                  onClick={() => {
                    setEditingFolderId(null);
                    setFolderNameInput('');
                    setFolderDescInput('');
                    setIsFolderModalOpen(true);
                  }}
                  className="py-3 px-5 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-md transition inline-flex items-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-plus"></i> Creează folder
                </button>
              </div>
            )}
          </section>
        )}

        {/* VIEW 2: FOLDER DETAIL */}
        {activeFolder && (
          <section className="space-y-5">
            {/* Folder Header Card */}
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-800">
                      Folder
                    </span>
                    <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 truncate">
                      {activeFolder.name}
                    </h2>
                    <button
                      onClick={() => {
                        setEditingFolderId(activeFolder.id);
                        setFolderNameInput(activeFolder.name);
                        setFolderDescInput(activeFolder.description || '');
                        setIsFolderModalOpen(true);
                      }}
                      className="text-slate-400 hover:text-teal-600 p-1.5 cursor-pointer"
                    >
                      <i className="fa-solid fa-pen text-xs"></i>
                    </button>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1 flex items-center gap-1.5">
                    {activeFolder.pdfName ? (
                      <>
                        <i className="fa-solid fa-file-circle-check text-emerald-600"></i>
                        <span className="font-semibold text-slate-700">{activeFolder.pdfName}</span>
                        <span className="text-xs text-slate-400">({activeFolder.pdfPageCount} pagini)</span>
                      </>
                    ) : sources[activeFolder.id] ? (
                      <>
                        <i className="fa-solid fa-file-lines text-teal-600"></i>
                        <span>Text sursă încărcat ({sources[activeFolder.id].length.toLocaleString('ro-RO')} caractere)</span>
                      </>
                    ) : (
                      <>
                        <i className="fa-regular fa-file-pdf text-rose-500"></i>
                        <span>Niciun PDF încărcat încă</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer py-2.5 px-4 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs sm:text-sm transition flex items-center gap-2">
                    <i className="fa-solid fa-file-pdf text-rose-600"></i>
                    <span>{activeFolder.pdfName ? 'Schimbă PDF' : 'Încarcă PDF'}</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={handlePdfUpload}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setSourceTextEditor(sources[activeFolder.id] || '');
                      setIsSourceTextModalOpen(true);
                    }}
                    className="py-2.5 px-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs sm:text-sm transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <i className="fa-solid fa-file-lines text-slate-500"></i>
                    <span>Text Sursă</span>
                  </button>
                </div>
              </div>

              {/* Action Buttons for AI Generation */}
              <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => setIsGenCardsModalOpen(true)}
                  className="p-3.5 rounded-2xl bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 text-white font-bold text-sm shadow-md transition flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                      <i className="fa-solid fa-wand-magic-sparkles"></i>
                    </span>
                    <span className="text-left">
                      <span className="block leading-tight">Generează Flashcarduri</span>
                      <span className="block text-[11px] text-teal-100 font-normal">Fidel textului PDF</span>
                    </span>
                  </span>
                  <i className="fa-solid fa-chevron-right text-xs opacity-80"></i>
                </button>

                <button
                  onClick={() => {
                    setTestTitleInput(`Test Admitere — ${activeFolder.name}`);
                    setIsGenTestModalOpen(true);
                  }}
                  className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 text-white font-bold text-sm shadow-md transition flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                      <i className="fa-solid fa-graduation-cap"></i>
                    </span>
                    <span className="text-left">
                      <span className="block leading-tight">Generează Test Grilă (60 Grile)</span>
                      <span className="block text-[11px] text-indigo-100 font-normal">
                        30 Simplu + 30 Grupat (Asincron)
                      </span>
                    </span>
                  </span>
                  <i className="fa-solid fa-chevron-right text-xs opacity-80"></i>
                </button>
              </div>
            </div>

            {/* Folder Tabs */}
            <div className="flex bg-slate-200/70 p-1.5 rounded-2xl gap-1">
              <button
                onClick={() => setActiveTab('swipe')}
                className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'swipe'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-clone text-teal-600"></i>
                <span>Învață (Swipe)</span>
                <span className="px-2 py-0.5 text-[11px] rounded-full bg-teal-100 text-teal-800">
                  {activeFolder.flashcards ? activeFolder.flashcards.length : 0}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('manage')}
                className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'manage'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-pen-to-square text-amber-600"></i>
                <span>Editează Carduri</span>
              </button>

              <button
                onClick={() => setActiveTab('tests')}
                className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'tests'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-file-circle-check text-indigo-600"></i>
                <span>Teste Grilă</span>
                <span className="px-2 py-0.5 text-[11px] rounded-full bg-indigo-100 text-indigo-800">
                  {tests.filter((t) => t.folderId === activeFolder.id).length}
                </span>
              </button>
            </div>

            {/* SUB-TAB 1: SWIPE STUDY */}
            {activeTab === 'swipe' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 sm:gap-5 text-xs sm:text-sm font-bold">
                    <span className="flex items-center gap-1.5 text-emerald-600">
                      <i className="fa-solid fa-circle-check"></i>
                      <span>Știu: <strong>{deckStats.known}</strong></span>
                    </span>
                    <span className="flex items-center gap-1.5 text-rose-600">
                      <i className="fa-solid fa-circle-xmark"></i>
                      <span>Nu știu: <strong>{deckStats.unknown}</strong></span>
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <i className="fa-regular fa-clock"></i>
                      <span>Rămase: <strong>{deckStats.unseen}</strong></span>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setStudyOnlyUnknown(!studyOnlyUnknown)}
                      className={`py-1.5 px-3 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                        studyOnlyUnknown
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700'
                      }`}
                    >
                      <i className="fa-solid fa-rotate-left"></i>
                      <span>{studyOnlyUnknown ? 'Toate cardurile' : 'Reia doar „Nu știu”'}</span>
                    </button>
                    <button
                      onClick={handleShuffleDeck}
                      className="py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                    >
                      <i className="fa-solid fa-shuffle mr-1"></i> Amestecă
                    </button>
                    <button
                      onClick={handleResetDeckProgress}
                      className="py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold transition cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* Cards View / Deck Player */}
                {activeFolder.flashcards && activeFolder.flashcards.length > 0 ? (
                  currentCard ? (
                    <div className="max-w-xl mx-auto space-y-4">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
                        <span>Cardul {currentCardPointer + 1} din {studyDeckIds.length}</span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full ${
                            currentCard.status === 'known'
                              ? 'bg-emerald-100 text-emerald-800'
                              : currentCard.status === 'unknown'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {currentCard.status === 'known'
                            ? 'Știut'
                            : currentCard.status === 'unknown'
                            ? 'De reluat'
                            : 'Neparcurs'}
                        </span>
                      </div>

                      {/* 3D Flashcard */}
                      <div className="relative h-[340px] sm:h-[380px] w-full perspective-1000 select-none">
                        <div
                          className="swipe-card w-full h-full cursor-pointer"
                          onClick={() => setIsCardFlipped(!isCardFlipped)}
                        >
                          <div
                            className={`w-full h-full relative transform-style-3d ${
                              isCardFlipped ? 'rotate-y-180' : ''
                            }`}
                          >
                            {/* Front of card */}
                            <div className="backface-hidden absolute inset-0 bg-white rounded-3xl border-2 border-slate-200 shadow-xl p-6 sm:p-8 flex flex-col justify-between">
                              <div className="flex items-center justify-between text-xs font-bold text-teal-600 uppercase">
                                <span>
                                  <i className="fa-solid fa-circle-question mr-1.5"></i>
                                  Întrebare / Concept
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCardId(currentCard.id);
                                    setCardFrontInput(currentCard.front);
                                    setCardBackInput(currentCard.back);
                                    setCardTagInput(currentCard.category || '');
                                    setIsCardModalOpen(true);
                                  }}
                                  className="p-2 text-slate-400 hover:text-teal-600 cursor-pointer"
                                >
                                  <i className="fa-solid fa-pen"></i>
                                </button>
                              </div>
                              <div className="my-auto overflow-y-auto max-h-[210px] flex items-center justify-center">
                                <p className="text-base sm:text-xl font-bold text-slate-800 text-center leading-relaxed">
                                  {currentCard.front}
                                </p>
                              </div>
                              <div className="text-center text-xs text-slate-400 pt-2 border-t border-slate-100">
                                <i className="fa-solid fa-hand-pointer animate-bounce mr-1"></i>
                                Atinge cardul pentru a vedea răspunsul
                              </div>
                            </div>

                            {/* Back of card */}
                            <div className="backface-hidden rotate-y-180 absolute inset-0 bg-gradient-to-br from-teal-950 to-slate-900 text-white rounded-3xl border-2 border-teal-500/40 shadow-xl p-6 sm:p-8 flex flex-col justify-between">
                              <div className="flex items-center justify-between text-xs font-bold text-teal-300 uppercase">
                                <span>
                                  <i className="fa-solid fa-lightbulb mr-1.5"></i>
                                  Răspuns Exact (din PDF)
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCardId(currentCard.id);
                                    setCardFrontInput(currentCard.front);
                                    setCardBackInput(currentCard.back);
                                    setCardTagInput(currentCard.category || '');
                                    setIsCardModalOpen(true);
                                  }}
                                  className="p-2 text-slate-300 hover:text-white cursor-pointer"
                                >
                                  <i className="fa-solid fa-pen"></i>
                                </button>
                              </div>
                              <div className="my-auto overflow-y-auto max-h-[200px] flex flex-col items-center justify-center gap-3">
                                <p className="text-sm sm:text-lg font-semibold text-white text-center leading-relaxed">
                                  {currentCard.back}
                                </p>
                                <p className="text-[11px] text-teal-200 bg-white/10 px-3 py-1 rounded-full">
                                  {currentCard.category || activeFolder.name}
                                </p>
                              </div>
                              <div className="text-center text-xs text-teal-200/80 pt-2 border-t border-white/10">
                                Apasă pe „Știu” sau „Nu știu” mai jos
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="grid grid-cols-5 gap-2.5 items-center pt-1">
                        <button
                          onClick={() => handleMarkCard('unknown')}
                          className="col-span-2 py-4 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border-2 border-rose-200 font-extrabold text-sm transition flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                        >
                          <i className="fa-solid fa-xmark text-lg"></i>
                          <span>Nu știu</span>
                        </button>
                        <button
                          onClick={handleUndoCard}
                          disabled={currentCardPointer === 0}
                          className="col-span-1 py-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 font-bold transition flex items-center justify-center cursor-pointer disabled:opacity-40"
                        >
                          <i className="fa-solid fa-rotate-left"></i>
                        </button>
                        <button
                          onClick={() => handleMarkCard('known')}
                          className="col-span-2 py-4 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-2 border-emerald-200 font-extrabold text-sm transition flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                        >
                          <span>Știu</span>
                          <i className="fa-solid fa-check text-lg"></i>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Deck Completed State */
                    <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 text-center max-w-xl mx-auto space-y-5 shadow-sm">
                      <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto text-3xl">
                        <i className="fa-solid fa-trophy"></i>
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xl font-extrabold text-slate-900">Ai parcurs pachetul!</h3>
                        <p className="text-sm text-slate-500">
                          Ai știut {deckStats.known} carduri și mai ai {deckStats.unknown} marcate „Nu știu”.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        {deckStats.unknown > 0 && (
                          <button
                            onClick={() => {
                              setStudyOnlyUnknown(true);
                              setCurrentCardPointer(0);
                            }}
                            className="py-3.5 px-6 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow-lg transition inline-flex items-center gap-2 cursor-pointer"
                          >
                            <i className="fa-solid fa-rotate"></i>
                            <span>Reia doar cardurile „Nu știu” ({deckStats.unknown})</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setStudyOnlyUnknown(false);
                            setCurrentCardPointer(0);
                          }}
                          className="py-3.5 px-6 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm transition cursor-pointer"
                        >
                          Parcurge toate din nou
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  /* Empty Cards State */
                  <div className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-8 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto mb-3 text-xl">
                      <i className="fa-solid fa-layer-group"></i>
                    </div>
                    <h3 className="text-base font-bold text-slate-800">Niciun flashcard în acest folder</h3>
                    <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mt-1 mb-5">
                      Încarcă un PDF și apasă pe „Generează Flashcarduri” pentru a crea carduri cu Gemini 3.8 Flash.
                    </p>
                    <button
                      onClick={() => setIsGenCardsModalOpen(true)}
                      className="py-2.5 px-5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm transition inline-flex items-center gap-2 cursor-pointer"
                    >
                      <i className="fa-solid fa-wand-magic-sparkles"></i>
                      <span>Generează din PDF cu AI</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SUB-TAB 2: MANAGE CARDS */}
            {activeTab === 'manage' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input
                      type="text"
                      value={cardSearchTerm}
                      onChange={(e) => setCardSearchTerm(e.target.value)}
                      placeholder="Caută în carduri..."
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 outline-none text-sm"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setEditingCardId(null);
                      setCardFrontInput('');
                      setCardBackInput('');
                      setCardTagInput(activeFolder.name);
                      setIsCardModalOpen(true);
                    }}
                    className="py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs sm:text-sm transition flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                  >
                    <i className="fa-solid fa-plus"></i>
                    <span>Adaugă Manual</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {activeFolder.flashcards &&
                    activeFolder.flashcards
                      .filter(
                        (c) =>
                          !cardSearchTerm ||
                          c.front.toLowerCase().includes(cardSearchTerm.toLowerCase()) ||
                          c.back.toLowerCase().includes(cardSearchTerm.toLowerCase())
                      )
                      .map((card) => (
                        <div
                          key={card.id}
                          className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex items-start justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md inline-block">
                              {card.category}
                            </span>
                            <p className="text-sm font-bold text-slate-800">{card.front}</p>
                            <p className="text-xs text-slate-500">{card.back}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => {
                                setEditingCardId(card.id);
                                setCardFrontInput(card.front);
                                setCardBackInput(card.back);
                                setCardTagInput(card.category);
                                setIsCardModalOpen(true);
                              }}
                              className="text-slate-400 hover:text-teal-600 p-2 cursor-pointer"
                            >
                              <i className="fa-solid fa-pen text-xs"></i>
                            </button>
                            <button
                              onClick={() => handleDeleteCard(card.id)}
                              className="text-slate-400 hover:text-rose-600 p-2 cursor-pointer"
                            >
                              <i className="fa-regular fa-trash-can text-xs"></i>
                            </button>
                          </div>
                        </div>
                      ))}
                </div>
              </div>
            )}

            {/* SUB-TAB 3: TESTE GRILĂ */}
            {activeTab === 'tests' && (
              <div className="space-y-4">
                {/* Tests List (when no test is active) */}
                {!activeTestId && (
                  <div className="space-y-4">
                    <div className="bg-indigo-50/80 border border-indigo-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="text-xs sm:text-sm text-indigo-950 space-y-1">
                        <div className="font-bold flex items-center gap-2">
                          <i className="fa-solid fa-circle-info text-indigo-600"></i>
                          <span>Stil Oficial Admitere UMFCD (Format 60 Grile)</span>
                        </div>
                        <p className="text-indigo-800/90 text-xs leading-relaxed">
                          30 Complement Simplu (A-E) + 30 Complement Grupat (1,2,3,4 cu cheie oficială), generate asincron cu explicații detaliate.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setTestTitleInput(`Test Admitere — ${activeFolder.name}`);
                          setIsGenTestModalOpen(true);
                        }}
                        className="py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm shrink-0 transition flex items-center gap-2 shadow-sm cursor-pointer"
                      >
                        <i className="fa-solid fa-plus"></i>
                        <span>Test Nou (60 Grile)</span>
                      </button>
                    </div>

                    <div className="space-y-3">
                      {tests.filter((t) => t.folderId === activeFolder.id).length === 0 ? (
                        <div className="bg-white rounded-2xl p-6 text-center text-slate-500 text-xs border border-slate-200">
                          Niciun test în acest folder. Apasă pe „Test Nou” pentru a genera.
                        </div>
                      ) : (
                        tests
                          .filter((t) => t.folderId === activeFolder.id)
                          .map((test) => {
                            const score = calculateQuizScore(test.questions);
                            return (
                              <div
                                key={test.id}
                                className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex items-center justify-between gap-3"
                              >
                                <div>
                                  <h4 className="font-bold text-slate-900">{test.title}</h4>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {test.questions.length} întrebări{' '}
                                    {test.completed ? (
                                      <span className="text-emerald-700 font-semibold ml-2">
                                        • Finalizat (Scor: {score.correct}/{score.total})
                                      </span>
                                    ) : (
                                      <span className="text-indigo-600 font-semibold ml-2">
                                        • În desfășurare
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setActiveTestId(test.id)}
                                    className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs cursor-pointer"
                                  >
                                    Deschide
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTest(test.id)}
                                    className="p-2 text-slate-400 hover:text-rose-600 cursor-pointer"
                                  >
                                    <i className="fa-regular fa-trash-can text-sm"></i>
                                  </button>
                                </div>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </div>
                )}

                {/* ACTIVE QUIZ PLAYER */}
                {activeTest && (
                  <div className="space-y-5">
                    <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-3">
                      {/* Async Generation Live Banner */}
                      {isAsyncGenerating && asyncBannerInfo && (
                        <div className="bg-indigo-600 text-white rounded-2xl p-3 text-xs font-bold flex items-center justify-between gap-3 shadow-sm animate-pulse">
                          <div className="flex items-center gap-2.5">
                            <i className="fa-solid fa-spinner fa-spin text-sm"></i>
                            <span>
                              Se generează asincron restul grilelor în fundal... Poți rezolva primele întrebări!
                            </span>
                          </div>
                          <span className="px-2.5 py-1 rounded-lg bg-white/20 text-[11px] font-extrabold shrink-0">
                            {asyncBannerInfo.current} / {asyncBannerInfo.total}
                          </span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          onClick={() => setActiveTestId(null)}
                          className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <i className="fa-solid fa-arrow-left"></i> Înapoi la teste
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-800 font-extrabold text-xs">
                            Scor: {quizScore.correct} / {quizScore.total} ({quizScore.scorePercentage}%)
                          </span>
                          {!activeTest.completed && (
                            <button
                              onClick={handleFinishQuiz}
                              className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer"
                            >
                              Finalizează & Bareme
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <div>
                          <h3 className="font-extrabold text-base sm:text-lg text-slate-900">
                            {activeTest.title}
                          </h3>
                          <p className="text-xs text-slate-500">
                            {activeTest.questions.length} întrebări generate
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            onClick={() => setQuizFilter('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                              quizFilter === 'all'
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            Toate
                          </button>
                          <button
                            onClick={() => setQuizFilter('cs')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                              quizFilter === 'cs'
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            Compl. Simplu
                          </button>
                          <button
                            onClick={() => setQuizFilter('cg')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                              quizFilter === 'cg'
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            Compl. Grupat
                          </button>
                          <button
                            onClick={() => setQuizFilter('wrong')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                              quizFilter === 'wrong'
                                ? 'bg-rose-600 text-white'
                                : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            Greșite
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Official UMFCD Complement Grupat Legend */}
                    <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-3.5 text-xs text-amber-950">
                      <div className="font-extrabold mb-1.5 flex items-center gap-1.5">
                        <i className="fa-solid fa-key text-amber-600"></i>
                        <span>Cheie Oficială COMPLEMENT GRUPAT UMFCD (1, 2, 3, 4):</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 font-semibold">
                        <div className="bg-white/80 px-2 py-1 rounded border border-amber-200">
                          <strong>A</strong> = 1, 2, 3
                        </div>
                        <div className="bg-white/80 px-2 py-1 rounded border border-amber-200">
                          <strong>B</strong> = 1, 3
                        </div>
                        <div className="bg-white/80 px-2 py-1 rounded border border-amber-200">
                          <strong>C</strong> = 2, 4
                        </div>
                        <div className="bg-white/80 px-2 py-1 rounded border border-amber-200">
                          <strong>D</strong> = doar 4
                        </div>
                        <div className="bg-white/80 px-2 py-1 rounded border border-amber-200 col-span-2 sm:col-span-1">
                          <strong>E</strong> = toate/niciuna
                        </div>
                      </div>
                    </div>

                    {/* Questions List */}
                    <div className="space-y-4">
                      {filteredQuizQuestions.map((q) => {
                        const isAnswered = !!q.userChoice;
                        const showSolution = activeTest.completed || isAnswered;

                        return (
                          <div
                            key={q.id}
                            className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-black text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg">
                                #{q.number} • {q.type === 'CS' ? 'Complement Simplu' : 'Complement Grupat'}
                              </span>
                              {showSolution && (
                                <span
                                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                    q.userChoice === q.correctLetter
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {q.userChoice === q.correctLetter ? 'Corect' : 'Greșit'}
                                </span>
                              )}
                            </div>

                            <p className="text-sm font-bold text-slate-900 whitespace-pre-line leading-relaxed">
                              {q.stem}
                            </p>

                            <div className="space-y-1.5">
                              {(['A', 'B', 'C', 'D', 'E'] as const).map((letter) => {
                                const isSelected = q.userChoice === letter;
                                const isCorrect = q.correctLetter === letter;

                                let style = 'bg-white border-slate-200 hover:border-slate-300';
                                if (showSolution) {
                                  if (isCorrect) {
                                    style = 'bg-emerald-50 border-emerald-500 font-bold text-emerald-950';
                                  } else if (isSelected) {
                                    style = 'bg-rose-50 border-rose-500 font-semibold text-rose-950';
                                  }
                                } else if (isSelected) {
                                  style = 'bg-indigo-50 border-indigo-500 font-bold text-indigo-950';
                                }

                                return (
                                  <button
                                    key={letter}
                                    type="button"
                                    onClick={() => handleSelectQuizOption(q.id, letter)}
                                    className={`w-full p-3 rounded-xl border text-left text-xs transition flex items-start gap-2 cursor-pointer ${style}`}
                                  >
                                    <strong className="shrink-0">{letter}.</strong>
                                    <span>{q.options[letter]}</span>
                                  </button>
                                );
                              })}
                            </div>

                            {showSolution && (
                              <div className="p-3.5 bg-slate-50 rounded-2xl text-xs space-y-1 border border-slate-100">
                                <div className="font-extrabold text-emerald-700 flex items-center gap-1.5">
                                  <i className="fa-solid fa-circle-check"></i>
                                  <span>Răspuns corect: {q.correctLetter}</span>
                                </div>
                                <p className="text-slate-700 leading-relaxed">{q.explanation}</p>
                                {q.sourceQuote && (
                                  <p className="text-[11px] text-slate-500 italic mt-1 pt-1 border-t border-slate-200/60">
                                    „{q.sourceQuote}”
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      {/* MODAL: Folder Nou / Redenumește */}
      {isFolderModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900">
                {editingFolderId ? 'Redenumește Folderul' : 'Folder Nou'}
              </h3>
              <button
                onClick={() => setIsFolderModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <form onSubmit={handleSaveFolderForm} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                  Nume Folder
                </label>
                <input
                  type="text"
                  required
                  value={folderNameInput}
                  onChange={(e) => setFolderNameInput(e.target.value)}
                  placeholder="ex: Capitolul 1 - Celula"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                  Descriere (opțional)
                </label>
                <input
                  type="text"
                  value={folderDescInput}
                  onChange={(e) => setFolderDescInput(e.target.value)}
                  placeholder="ex: Curs pag. 1-20"
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 outline-none text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFolderModalOpen(false)}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="py-2.5 px-5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm cursor-pointer"
                >
                  Salvează
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Card Nou / Edit */}
      {isCardModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900">
                {editingCardId ? 'Editează Flashcard' : 'Flashcard Nou'}
              </h3>
              <button
                onClick={() => setIsCardModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <form onSubmit={handleSaveCardForm} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                  Față (Întrebare / Concept)
                </label>
                <textarea
                  required
                  rows={3}
                  value={cardFrontInput}
                  onChange={(e) => setCardFrontInput(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 outline-none text-sm"
                ></textarea>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                  Verso (Răspuns Exact)
                </label>
                <textarea
                  required
                  rows={4}
                  value={cardBackInput}
                  onChange={(e) => setCardBackInput(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 outline-none text-sm"
                ></textarea>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                  Tag / Categorie
                </label>
                <input
                  type="text"
                  value={cardTagInput}
                  onChange={(e) => setCardTagInput(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 outline-none text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCardModalOpen(false)}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="py-2.5 px-5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm cursor-pointer"
                >
                  Salvează
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Generează Flashcarduri */}
      {isGenCardsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-wand-magic-sparkles text-teal-600"></i>
                <span>Generează Flashcarduri</span>
              </h3>
              <button
                onClick={() => setIsGenCardsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <p className="text-xs sm:text-sm text-slate-600">
              Gemini 3.8 Flash va extrage conceptele cheie din PDF-ul tău conform cerințelor de examen UMFCD.
            </p>
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                Număr carduri
              </label>
              <select
                value={genCardsCount}
                onChange={(e) => setGenCardsCount(parseInt(e.target.value, 10))}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold"
              >
                <option value={15}>15 carduri (Ultra-rapid)</option>
                <option value={25}>25 carduri (Recomandat)</option>
                <option value={40}>40 carduri (Aprofundat)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsGenCardsModalOpen(false)}
                className="py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={handleGenerateFlashcards}
                className="py-3 px-5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-md cursor-pointer"
              >
                Generează
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Generează Test Grilă */}
      {isGenTestModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-graduation-cap text-indigo-600"></i>
                <span>Generator Test UMFCD</span>
              </h3>
              <button
                onClick={() => setIsGenTestModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3.5 text-xs text-indigo-950 space-y-1">
              <div className="font-bold">Structură Test:</div>
              <ul className="list-disc list-inside space-y-0.5">
                <li>30 Complement Simplu (A-E)</li>
                <li>30 Complement Grupat (1, 2, 3, 4 cu cheia oficială A-E)</li>
                <li>Explicații complete și citate din PDF</li>
              </ul>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                Titlu Test
              </label>
              <input
                type="text"
                value={testTitleInput}
                onChange={(e) => setTestTitleInput(e.target.value)}
                placeholder="Test Admitere"
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 text-sm outline-none font-medium"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                Format
              </label>
              <select
                value={testFormatInput}
                onChange={(e) => setTestFormatInput(parseInt(e.target.value, 10))}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 font-bold text-sm"
              >
                <option value={60}>Complet: 60 întrebări (30 Simplu + 30 Grupat)</option>
                <option value={20}>Mini-Test: 20 întrebări (10 Simplu + 10 Grupat)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsGenTestModalOpen(false)}
                className="py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={handleGenerateTest}
                className="py-3 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md cursor-pointer"
              >
                Generează Testul
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Text Sursă PDF */}
      {isSourceTextModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-lg font-extrabold text-slate-900">Material Sursă PDF</h3>
              <button
                onClick={() => setIsSourceTextModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <p className="text-xs text-slate-500 shrink-0">
              Aici poți vizualiza și edita textul extras din PDF-ul tău, sau poți încărca un text demo UMFCD.
            </p>
            <textarea
              rows={14}
              value={sourceTextEditor}
              onChange={(e) => setSourceTextEditor(e.target.value)}
              placeholder="Lipește textul cursului de medicină aici..."
              className="w-full flex-1 p-4 rounded-2xl border border-slate-200 bg-slate-50 font-mono text-xs outline-none overflow-y-auto"
            ></textarea>
            <div className="flex items-center justify-between pt-2 shrink-0">
              <span className="text-xs text-slate-500">
                {sourceTextEditor.length.toLocaleString('ro-RO')} caractere
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleLoadDemoText}
                  className="py-2.5 px-3.5 rounded-xl bg-teal-50 text-teal-700 font-semibold text-xs cursor-pointer"
                >
                  Încarcă Demo UMFCD
                </button>
                <button
                  type="button"
                  onClick={() => setIsSourceTextModalOpen(false)}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm cursor-pointer"
                >
                  Închide
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualSourceText}
                  className="py-2.5 px-5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm cursor-pointer"
                >
                  Salvează
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Setări AI & Cheie API */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-key text-teal-600"></i>
                <span>Setări Cheie Gemini API</span>
              </h3>
              <button
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  setValidationResult(null);
                }}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center cursor-pointer hover:bg-slate-200 transition"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="bg-teal-50 border border-teal-200 rounded-2xl p-3.5 text-xs text-teal-950 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <i className="fa-solid fa-bolt text-teal-600"></i>
                <span>Motor AI: Google Gemini 3.8 Flash (Viteză maximă)</span>
              </div>
              <p className="text-teal-800 leading-relaxed">
                Testele și flashcardurile sunt generate direct prin serverul securizat. Folosește o cheie gratuită Gemini pentru a genera teste nelimitate.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold uppercase text-slate-600">
                  Cheie API Google Gemini
                </label>
                <button
                  type="button"
                  onClick={() => setShowKeyText(!showKeyText)}
                  className="text-xs text-teal-700 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <i className={`fa-solid ${showKeyText ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  <span>{showKeyText ? 'Ascunde' : 'Arată cheia'}</span>
                </button>
              </div>

              <div className="relative">
                <input
                  type={showKeyText ? 'text' : 'password'}
                  value={tempApiKeyInput}
                  onChange={(e) => {
                    setTempApiKeyInput(e.target.value);
                    if (validationResult) setValidationResult(null);
                  }}
                  placeholder="AQ... sau AIzaSy..."
                  className="w-full pl-4 pr-12 py-3 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 text-sm font-mono outline-none"
                />
                {tempApiKeyInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setTempApiKeyInput('');
                      setValidationResult(null);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-xs cursor-pointer"
                    title="Șterge"
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                Sunt acceptate atât cheile noi <strong>AQ...</strong> (generate recent în Google AI Studio), cât și cele clasice <strong>AIzaSy...</strong>.
              </p>
            </div>

            {/* Validation Feedback Box */}
            {validationResult && (
              <div
                className={`rounded-2xl p-3.5 text-xs border ${
                  validationResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                <div className="flex items-start gap-2">
                  <i
                    className={`fa-solid mt-0.5 ${
                      validationResult.success
                        ? 'fa-circle-check text-emerald-600 text-sm'
                        : 'fa-triangle-exclamation text-rose-600 text-sm'
                    }`}
                  ></i>
                  <div className="flex-1 space-y-1">
                    <div className="font-bold">
                      {validationResult.success ? 'Conexiune reușită!' : 'Eroare la cheia API'}
                    </div>
                    <p className="leading-relaxed">{validationResult.message}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Guide to get a free key */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2 text-xs">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <i className="fa-solid fa-circle-question text-teal-600"></i>
                <span>Cum obții o cheie gratuită dacă nu ai una?</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-600 leading-relaxed">
                <li>
                  Deschide Google AI Studio:{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-teal-600 font-bold hover:underline"
                  >
                    aistudio.google.com/app/apikey
                  </a>
                </li>
                <li>Apasă pe butonul albastru <strong>„Create API key”</strong>.</li>
                <li>Copiază cheia generată, lipește-o mai sus și apasă <strong>„Testează cheia”</strong>.</li>
              </ol>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2">
              <button
                type="button"
                disabled={isValidatingKey || !tempApiKeyInput.trim()}
                onClick={handleValidateApiKey}
                className="w-full sm:w-auto py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
              >
                {isValidatingKey ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i>
                    <span>Se verifică...</span>
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-vial-circle-check text-teal-600"></i>
                    <span>Testează cheia</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsModalOpen(false);
                    setValidationResult(null);
                  }}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-xs cursor-pointer hover:bg-slate-200"
                >
                  Închide
                </button>
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="py-2.5 px-5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs cursor-pointer shadow-md"
                >
                  Salvează cheia
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirmare */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto text-xl">
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>
            <h3 className="text-lg font-extrabold text-slate-900">{confirmModal.title}</h3>
            <p className="text-xs sm:text-sm text-slate-500">{confirmModal.message}</p>
            <div className="flex justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={confirmModal.action}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 text-white font-bold text-sm cursor-pointer"
              >
                Confirmă
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOADING OVERLAY */}
      {loadingOverlay.isOpen && (
        <div className="fixed inset-0 z-[80] bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto text-2xl">
              <i className="fa-solid fa-spinner fa-spin"></i>
            </div>
            <h3 className="text-lg font-extrabold text-slate-900">{loadingOverlay.title}</h3>
            <p className="text-xs sm:text-sm text-slate-500">{loadingOverlay.subtitle}</p>
            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-teal-600 to-indigo-600 h-full transition-all duration-300"
                style={{ width: `${loadingOverlay.progress}%` }}
              ></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
