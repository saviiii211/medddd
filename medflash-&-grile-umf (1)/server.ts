import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '20mb' }));

export function cleanApiKey(raw?: string | null): string {
  if (!raw) return '';
  let key = String(raw).trim();
  if (key === 'MY_GEMINI_API_KEY' || key === 'PLACEHOLDER' || key === 'YOUR_API_KEY') {
    return '';
  }
  // Strip common variable name prefixes like GEMINI_API_KEY= or API_KEY:
  key = key.replace(/^(GEMINI_API_KEY|API_KEY|KEY)\s*[:=]\s*/i, '');
  // Strip "Bearer "
  key = key.replace(/^Bearer\s+/i, '');
  // Strip quotes (single, double, backtick, curly quotes)
  key = key.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '');
  // Strip internal whitespace, tabs, newlines
  key = key.replace(/[\r\n\t\s]/g, '');
  if (key === 'MY_GEMINI_API_KEY' || key === 'PLACEHOLDER' || key === 'YOUR_API_KEY') {
    return '';
  }
  return key;
}

export function formatGeminiErrorMessage(err: any): string {
  if (!err) return 'A apărut o eroare la apelarea serviciului Gemini AI.';
  const rawMsg = typeof err === 'string' ? err : err.message || '';

  // Attempt to parse nested JSON error from GoogleGenAI SDK
  try {
    let candidate = rawMsg;
    const jsonMatch = rawMsg.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      candidate = jsonMatch[0];
    }
    const parsed = JSON.parse(candidate);
    const errObj = parsed.error || parsed;
    const code = errObj.code;
    const status = errObj.status;
    const message = errObj.message || '';

    if (
      code === 400 ||
      status === 'INVALID_ARGUMENT' ||
      message.includes('API key not valid') ||
      message.includes('API_KEY_INVALID')
    ) {
      return 'Cheia API introdusă nu este validă. Asigură-te că folosești o cheie Gemini (format nou „AQ...” sau clasic „AIza...”) copiată din Google AI Studio (https://aistudio.google.com/app/apikey). Verifică să fie copiată complet, fără spații sau ghilimele.';
    }
    if (code === 403 || status === 'PERMISSION_DENIED') {
      return 'Permisiune refuzată pentru această cheie API. Verifică dacă cheia are acces la Generative Language API sau generează una nouă gratuită în Google AI Studio.';
    }
    if (code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('RESOURCE_EXHAUSTED')) {
      return 'Limita temporară de cereri gratuite (rate limit) a fost atinsă. Așteaptă câteva secunde sau încearcă din nou.';
    }
    if (code === 404 || status === 'NOT_FOUND') {
      return 'Modelul AI solicitat nu este disponibil pentru această cheie sau regiune.';
    }
    if (message) {
      return `Eroare Google AI (${code || status || '400'}): ${message}`;
    }
  } catch {
    // Not valid JSON
  }

  if (rawMsg.includes('API key not valid') || rawMsg.includes('API_KEY_INVALID')) {
    return 'Cheia API introdusă nu este validă. Asigură-te că folosești o cheie Gemini validă (începe cu „AQ” sau „AIza”) copiată de pe https://aistudio.google.com/app/apikey.';
  }
  if (rawMsg.includes('PERMISSION_DENIED')) {
    return 'Permisiune refuzată pentru această cheie API. Te rugăm să generezi o cheie nouă gratuită în Google AI Studio.';
  }
  if (rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('quota')) {
    return 'Limita de cereri gratuite a fost atinsă temporar. Te rugăm să aștepți 15-30 de secunde.';
  }
  if (rawMsg.includes('DEADLINE_EXCEEDED') || rawMsg.includes('timeout') || rawMsg.includes('aborted')) {
    return 'Timpul de răspuns a expirat (timeout). Serverul reîncearcă automat.';
  }

  return rawMsg;
}

function getGeminiClient(customApiKey?: string) {
  const cleanedCustom = cleanApiKey(customApiKey);
  const cleanedEnv = cleanApiKey(process.env.GEMINI_API_KEY);
  const apiKey = cleanedCustom || cleanedEnv;

  if (!apiKey) {
    throw new Error(
      'Cheia GEMINI_API_KEY lipsește. Adaugă cheia ta gratuită din Google AI Studio (https://aistudio.google.com/app/apikey) în fereastra „Setări Gemini API” din aplicație.'
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: 120000,
    },
  });
}

async function generateWithFallback(ai: GoogleGenAI, { contents, systemInstruction, responseSchema }: any) {
  const models = ['gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const config: any = {
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        };
        if (systemInstruction) config.systemInstruction = systemInstruction;
        if (responseSchema) config.responseSchema = responseSchema;

        const response = await ai.models.generateContent({
          model,
          contents,
          config,
        });

        const jsonText = (response.text || '[]').replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(jsonText);
      } catch (err: any) {
        lastError = err;
        console.warn(`Attempt ${attempt} on ${model} failed:`, err.message || err);
        const errStr = String(err?.message || '');
        if (
          errStr.includes('API key not valid') ||
          errStr.includes('API_KEY_INVALID') ||
          errStr.includes('PERMISSION_DENIED')
        ) {
          throw err;
        }
        if (attempt === 1) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }
  }

  throw lastError;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const envKey = cleanApiKey(process.env.GEMINI_API_KEY);
  const hasEnvKey = !!envKey && (envKey.startsWith('AQ') || envKey.startsWith('AIza'));
  res.json({ status: 'ok', hasEnvKey, model: 'gemini-3.8-flash' });
});

// Test & Validate API key endpoint (Supports both new AQ... and classic AIza... formats)
app.post('/api/gemini/validate-key', async (req, res) => {
  try {
    const rawKey = req.body?.apiKey;
    const cleanedCustom = cleanApiKey(rawKey);
    const cleanedEnv = cleanApiKey(process.env.GEMINI_API_KEY);
    const isEnvValid = cleanedEnv.startsWith('AQ') || cleanedEnv.startsWith('AIza');
    const cleaned = cleanedCustom || (isEnvValid ? cleanedEnv : '');

    if (!cleaned) {
      return res.status(400).json({
        valid: false,
        error:
          'Nu ai introdus nicio cheie API. Te rugăm să introduci cheia ta gratuită Google Gemini (care începe cu „AQ” sau „AIzaSy”).',
      });
    }

    // Helpful check: if user pastes an OpenAI key by mistake
    if (cleaned.startsWith('sk-')) {
      return res.status(400).json({
        valid: false,
        error:
          'Cheia introdusă începe cu „sk-”, specifică OpenAI. Pentru această aplicație folosește o cheie Google Gemini (care începe cu „AQ” sau „AIzaSy”). Poți genera gratuit pe https://aistudio.google.com/app/apikey',
      });
    }

    const ai = new GoogleGenAI({
      apiKey: cleaned,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
        timeout: 15000,
      },
    });

    const testResp = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'Raspunde doar cu "OK"',
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    return res.json({
      valid: true,
      model: 'gemini-3.8-flash',
      keyFormat: cleaned.startsWith('AQ') ? 'Google AI Studio Auth Key (AQ)' : 'Google Standard Key (AIza)',
      message: 'Cheia API este 100% validă și funcțională cu modelul ultra-rapid Gemini 3.8 Flash!',
      responsePreview: (testResp.text || 'OK').trim(),
    });
  } catch (err: any) {
    console.error('API key validation error:', err);
    return res.status(400).json({
      valid: false,
      error: formatGeminiErrorMessage(err),
    });
  }
});

// General structured content generation
app.post('/api/gemini/generate-structured', async (req, res) => {
  try {
    const { systemPrompt, userPrompt, responseSchema, customApiKey } = req.body;
    if (!userPrompt) {
      return res.status(400).json({ error: 'userPrompt este obligatoriu' });
    }

    const ai = getGeminiClient(customApiKey);
    const parsed = await generateWithFallback(ai, {
      contents: userPrompt,
      systemInstruction: systemPrompt,
      responseSchema,
    });

    return res.json({ success: true, data: parsed });
  } catch (err: any) {
    console.error('Error generating structured content:', err);
    return res.status(500).json({
      error: formatGeminiErrorMessage(err),
    });
  }
});

// Fast dedicated flashcards generator
app.post('/api/gemini/generate-flashcards', async (req, res) => {
  try {
    const { text, count = 25, folderName = 'Medicină', customApiKey } = req.body;
    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Textul extras din PDF este prea scurt.' });
    }

    const ai = getGeminiClient(customApiKey);

    const systemPrompt = `Ești profesor universitar la UMF Carol Davila. Creează flashcarduri medicale fidele textului PDF furnizat, cu întrebare pe față (front) și răspuns exact pe verso (back). Nu inventa noțiuni; bazează-te strict pe terminologia medicală și detaliile din text.`;

    const schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          front: { type: Type.STRING },
          back: { type: Type.STRING },
          category: { type: Type.STRING },
        },
        required: ['front', 'back', 'category'],
      },
    };

    if (count > 14 && text.length > 2000) {
      const half = Math.ceil(count / 2);
      const remaining = count - half;
      const mid = Math.floor(text.length / 2);
      const part1 = text.slice(0, Math.min(mid, 12000));
      const part2 = text.slice(mid, mid + 12000);

      const [res1, res2] = await Promise.all([
        generateWithFallback(ai, {
          contents: `Generează exact ${half} flashcarduri din această primă secțiune de curs medical:\n\n${part1}`,
          systemInstruction: systemPrompt,
          responseSchema: schema,
        }),
        generateWithFallback(ai, {
          contents: `Generează exact ${remaining} flashcarduri din această a doua secțiune de curs medical:\n\n${part2}`,
          systemInstruction: systemPrompt,
          responseSchema: schema,
        }),
      ]);

      const combined = [...(Array.isArray(res1) ? res1 : []), ...(Array.isArray(res2) ? res2 : [])];
      return res.json({ success: true, flashcards: combined });
    }

    const userPrompt = `Generează exact ${count} flashcarduri din acest text din cursul UMFCD:\n\n${text.slice(0, 14000)}`;

    const list = await generateWithFallback(ai, {
      contents: userPrompt,
      systemInstruction: systemPrompt,
      responseSchema: schema,
    });

    return res.json({ success: true, flashcards: list });
  } catch (err: any) {
    console.error('Flashcard generation error:', err);
    return res.status(500).json({
      error: formatGeminiErrorMessage(err),
    });
  }
});

// Fast dedicated quiz batch generator (supports CS = Complement Simplu & CG = Complement Grupat)
app.post('/api/gemini/generate-test-batch', async (req, res) => {
  try {
    const {
      text,
      count = 10,
      type = 'CS', // 'CS' or 'CG'
      startNumber = 1,
      customApiKey,
    } = req.body;

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Textul sursă PDF este necesar.' });
    }

    const ai = getGeminiClient(customApiKey);

    if (type === 'CS') {
      const systemPrompt = `Ești profesor universitar la UMF Carol Davila (UMFCD). Creează grile oficiale de complement simplu (cu o singură variantă corectă dintre A, B, C, D, E) strict fidele textului furnizat. Oferă explicații clare conform manualului și citează fragmentul relevant.`;

      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            stem: { type: Type.STRING },
            optA: { type: Type.STRING },
            optB: { type: Type.STRING },
            optC: { type: Type.STRING },
            optD: { type: Type.STRING },
            optE: { type: Type.STRING },
            correctLetter: { type: Type.STRING },
            explanation: { type: Type.STRING },
            sourceQuote: { type: Type.STRING },
          },
          required: [
            'stem',
            'optA',
            'optB',
            'optC',
            'optD',
            'optE',
            'correctLetter',
            'explanation',
            'sourceQuote',
          ],
        },
      };

      const userPrompt = `Generează ${count} întrebări de complement simplu (A-E) din acest fragment de curs medical:\n\n${text.slice(0, 14000)}`;

      const rawList = await generateWithFallback(ai, {
        contents: userPrompt,
        systemInstruction: systemPrompt,
        responseSchema: schema,
      });

      const questions = rawList.map((q: any, idx: number) => ({
        id: 'q_' + Date.now() + '_' + (startNumber + idx),
        number: startNumber + idx,
        type: 'CS',
        stem: q.stem,
        options: {
          A: q.optA,
          B: q.optB,
          C: q.optC,
          D: q.optD,
          E: q.optE,
        },
        correctLetter: (q.correctLetter || 'A').trim().toUpperCase(),
        explanation: q.explanation,
        sourceQuote: q.sourceQuote || '',
        userChoice: null,
      }));

      return res.json({ success: true, questions });
    } else {
      const systemPrompt = `Ești profesor la UMF Carol Davila. Creează grile oficiale de complement grupat (cu 4 afirmații numerotate 1, 2, 3, 4).
Cheia oficială de răspuns UMFCD:
A = sunt corecte afirmațiile 1, 2 și 3
B = sunt corecte afirmațiile 1 și 3
C = sunt corecte afirmațiile 2 și 4
D = este corectă doar afirmația 4
E = sunt corecte toate cele 4 afirmații sau altă combinație / niciuna.
Formulează afirmații precise din textul PDF.`;

      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            stem: { type: Type.STRING },
            prop1: { type: Type.STRING },
            prop2: { type: Type.STRING },
            prop3: { type: Type.STRING },
            prop4: { type: Type.STRING },
            correctLetter: { type: Type.STRING },
            explanation: { type: Type.STRING },
            sourceQuote: { type: Type.STRING },
          },
          required: [
            'stem',
            'prop1',
            'prop2',
            'prop3',
            'prop4',
            'correctLetter',
            'explanation',
            'sourceQuote',
          ],
        },
      };

      const userPrompt = `Generează ${count} întrebări de complement grupat (1, 2, 3, 4) din acest text medical:\n\n${text.slice(0, 14000)}`;

      const rawList = await generateWithFallback(ai, {
        contents: userPrompt,
        systemInstruction: systemPrompt,
        responseSchema: schema,
      });

      const questions = rawList.map((q: any, idx: number) => ({
        id: 'q_' + Date.now() + '_' + (startNumber + idx),
        number: startNumber + idx,
        type: 'CG',
        stem: `${q.stem}\n1. ${q.prop1}\n2. ${q.prop2}\n3. ${q.prop3}\n4. ${q.prop4}`,
        options: {
          A: '1, 2, 3 sunt corecte',
          B: '1, 3 sunt corecte',
          C: '2, 4 sunt corecte',
          D: 'doar 4 este corectă',
          E: 'toate sunt corecte (sau altă variantă)',
        },
        correctLetter: (q.correctLetter || 'A').trim().toUpperCase(),
        explanation: q.explanation,
        sourceQuote: q.sourceQuote || '',
        userChoice: null,
      }));

      return res.json({ success: true, questions });
    }
  } catch (err: any) {
    console.error('Quiz batch generation error:', err);
    return res.status(500).json({
      error: formatGeminiErrorMessage(err),
    });
  }
});

// Mount Vite or static dist
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
  });
}

startServer();
