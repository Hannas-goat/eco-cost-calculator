const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { createClient } = require('@libsql/client');
const { MATERIALS, PROCESSES, END_OF_LIFE } = require('./public/data.js');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'ecocost_session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// AI part extraction (optional — Google Gemini API, https://ai.google.dev). Switched here
// from NVIDIA's OpenAI-compatible API because Gemini supports native structured JSON output
// (responseSchema below): the API itself constrains generation to the given shape, rather
// than the model just being asked nicely to follow a shape described in the prompt. The
// previous setup went through several rounds of prompt tightening (numbered indices instead
// of name strings, worked examples, etc.) to fight exactly this class of bug -- the model
// sometimes wouldn't follow the requested format at all, and no amount of prompt wording
// fully closed that off. A native schema constraint closes it structurally instead.
// GEMINI_API_KEY is a secret and must only ever live here as a server env var, never in any
// file served to the browser.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY not set — AI part extraction is disabled (everything else still works).');
}
// Gemini's Flash models are natively multimodal (the same model handles text and images),
// so unlike the old NVIDIA setup this doesn't need a separate vision-model override.

// Google Search grounding (built into the Gemini API, not a separate service/key like the
// old Tavily integration) -- lets the model look up a detail the given text/file doesn't
// state before answering. On by default; set GEMINI_ENABLE_SEARCH=false to turn it off if
// it's not needed or not available on your plan.
const GEMINI_ENABLE_SEARCH = process.env.GEMINI_ENABLE_SEARCH !== 'false';

if (!JWT_SECRET) {
  console.error(
    'FATAL: JWT_SECRET is not set. Set it as an environment variable (a long random string) before starting the server.'
  );
  process.exit(1);
}

// No TURSO_DATABASE_URL configured -> fall back to a local SQLite file, so
// `npm start` works out of the box for local development without needing a
// Turso account. In production, set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN)
// to point at your real Turso database.
const usingLocalFallback = !process.env.TURSO_DATABASE_URL;
if (usingLocalFallback) {
  console.warn('TURSO_DATABASE_URL not set — using a local SQLite file (local-dev.db) instead of Turso.');
}
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local-dev.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDb() {
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    totals TEXT NOT NULL,
    recycled_pct REAL NOT NULL DEFAULT 0,
    product TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed for secure cookies to work correctly
app.use(express.json());
app.use(cookieParser());

// --- Auth helpers ---
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signSession(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Session expired — please log in again.' });
  }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a while and try again.' },
});

// --- Auth routes ---
app.post('/api/signup', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Enter a valid email and a password of at least 6 characters.' });
  }
  const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  await db.execute({ sql: 'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', args: [id, email, passwordHash] });
  const user = { id, email };
  setSessionCookie(res, signSession(user));
  res.status(201).json({ user });
});

app.post('/api/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  const result = await db.execute({ sql: 'SELECT id, email, password_hash FROM users WHERE email = ?', args: [email] });
  const row = result.rows[0];
  const ok = row && (await bcrypt.compare(password, row.password_hash));
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
  const user = { id: row.id, email: row.email };
  setSessionCookie(res, signSession(user));
  res.json({ user });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.status(204).end();
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.userId, email: req.userEmail } });
});

// --- Scenarios routes (all scoped to the signed-in user) ---
app.get('/api/scenarios', requireAuth, async (req, res) => {
  const result = await db.execute({
    sql: 'SELECT id, name, totals, recycled_pct, created_at FROM scenarios WHERE user_id = ? ORDER BY created_at ASC',
    args: [req.userId],
  });
  const scenarios = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    totals: JSON.parse(row.totals),
    recycledPct: row.recycled_pct,
  }));
  res.json({ scenarios });
});

app.get('/api/scenarios/:id', requireAuth, async (req, res) => {
  const result = await db.execute({
    sql: 'SELECT id, name, totals, recycled_pct, product FROM scenarios WHERE id = ? AND user_id = ?',
    args: [req.params.id, req.userId],
  });
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Scenario not found.' });
  res.json({
    scenario: {
      id: row.id,
      name: row.name,
      totals: JSON.parse(row.totals),
      recycledPct: row.recycled_pct,
      product: JSON.parse(row.product),
    },
  });
});

app.post('/api/scenarios', requireAuth, async (req, res) => {
  const { name, totals, recycledPct, product } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || !totals || !product) {
    return res.status(400).json({ error: 'Missing name, totals, or product.' });
  }
  const id = crypto.randomUUID();
  await db.execute({
    sql: 'INSERT INTO scenarios (id, user_id, name, totals, recycled_pct, product) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, req.userId, name.trim(), JSON.stringify(totals), recycledPct || 0, JSON.stringify(product)],
  });
  res.status(201).json({ scenario: { id, name: name.trim(), totals, recycledPct: recycledPct || 0 } });
});

app.delete('/api/scenarios/:id', requireAuth, async (req, res) => {
  await db.execute({ sql: 'DELETE FROM scenarios WHERE id = ? AND user_id = ?', args: [req.params.id, req.userId] });
  res.status(204).end();
});

// --- AI part extraction ---
const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10, // stricter than auth -- this hits a paid external API
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests — please wait a few minutes and try again.' },
});

const MATERIAL_NAMES = MATERIALS.map((m) => m.name);
const PROCESS_NAMES = PROCESSES.map((p) => p.name);
const EOL_NAMES = END_OF_LIFE.map((e) => e.name);

// Numbered rather than a plain name list: asking the model to copy a name string
// exactly, even with explicit examples, still let it invent close-but-wrong text
// (e.g. "Carbon (activated)" for what should have been "Graphite (battery anode)"
// -- plausible-sounding, but not in the list, and a plain string comparison can't
// tell "close" from "correct"). A number is much harder to almost-get-right: it's
// either a valid index we can resolve to the real name, or it isn't, so a model
// slip-up degrades to null (safe) instead of a fabricated-looking match.
function numberedList(names) {
  return names.map((n, i) => `${i + 1}. ${n}`).join('\n');
}

function resolveListIndex(list, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > list.length) return null;
  return list[n - 1];
}

// The model's own fallback estimate for a material that isn't in the reference
// catalog at all -- only used when "material" resolved to null. Sanity-bounded
// (finite, non-negative, capped) so a malformed/hallucinated response can't
// silently inject an absurd number, but otherwise trusted at face value: it's
// always shown to the user as an unverified AI estimate, never as reference data.
function sanitizeEstimate(estimate) {
  if (!estimate || typeof estimate !== 'object') return null;
  // Coerce each of the 4 fields independently rather than rejecting the whole estimate the
  // moment any single one is missing/malformed -- a model asked for 4 numbers per part, for
  // potentially several parts in one response, won't always get every single one in a clean
  // numeric format. Discarding 3 good numbers because a 4th was e.g. "~2.5" or omitted threw
  // away real, useful data for no reason. The caller (applyAiPartSuggestions, client-side)
  // already checks that at least one field is actually positive before using this at all, so
  // an estimate that's all zeros here still correctly gets treated as "no usable estimate".
  const out = {};
  for (const field of ['ecoCost', 'co2e', 'water', 'energyIn']) {
    const n = Number(estimate[field]);
    out[field] = Number.isFinite(n) && n >= 0 ? Math.min(n, 5000) : 0;
  }
  return out;
}

function resolvePartIndices(parts) {
  return parts.map((p) => {
    const material = resolveListIndex(MATERIAL_NAMES, p?.material);
    return {
      name: p?.name ?? null,
      material,
      weight: p?.weight ?? null,
      process: resolveListIndex(PROCESS_NAMES, p?.process),
      endOfLife: resolveListIndex(EOL_NAMES, p?.endOfLife),
      estimate: material ? null : sanitizeEstimate(p?.estimate),
    };
  });
}

// The JSON shape itself is now enforced structurally by Gemini's responseSchema (below,
// passed alongside this as generationConfig.responseSchema) rather than by prompt wording --
// so unlike the old NVIDIA prompt, this doesn't need to spell out or beg for the output
// format. It only needs to carry the business rules a schema can't express: which numbered
// list entry means what, when to prefer null over a guess, when to fall back to "estimate".
function buildExtractionPrompt() {
  return `You extract structured part data from a free-text product description for a Life Cycle Assessment calculator.

Rules:
- "material" is the NUMBER of the single best-matching entry in this numbered list, or null if nothing clearly matches. Never output a material's name as text -- only its number, or null:
${numberedList(MATERIAL_NAMES)}
- "process" is the NUMBER of the matching entry in this numbered list, or null if not mentioned:
${numberedList(PROCESS_NAMES)}
- "endOfLife" is the NUMBER of the matching entry in this numbered list, or null if not mentioned:
${numberedList(EOL_NAMES)}
- "weight" is in kilograms as a plain number (convert other units), or null if not stated.
- "estimate": whenever "material" is null (nothing in the list above fits), DEFAULT TO PROVIDING this rather than leaving it null too -- you almost always know enough in general terms (e.g. carbon-based electrode materials, common metals/plastics/ceramics, typical composite panels) to give a genuinely useful rough figure, and these are always shown to the user clearly labeled as an unverified AI estimate, not as certified reference data, so an approximate ballpark is exactly what's wanted here, not a precise number. Give your own best-guess PER-KILOGRAM figures: ecoCost in euros/kg, co2e in kgCO2e/kg, water in L/kg, energyIn in kWh/kg -- fill in every one of the 4 fields with your best number, never omit one partway through. Only leave the whole "estimate" null when the part is so vague (e.g. "miscellaneous hardware" with zero further detail) that you'd genuinely be inventing numbers with no basis at all. Always null when "material" is non-null.
- Create one entry in "parts" per distinct physical component described. A single simple product is one entry, and cap it at 10 entries even if more are described.
- Only give a material number when you're genuinely confident which one specific entry fits -- a wrong number is worse than null. When unsure, use null for "material" and fall back to "estimate" instead if you can.
- If research findings are provided below (from a prior web search pass), use them to fill in "weight"/"material"/"estimate" where relevant -- otherwise ignore them.
- If nothing usable is described, respond with an empty "parts" array -- never refuse, apologize, or ask a clarifying question instead.`;
}

// Gemini's structured-output schema (its own OpenAPI-subset dialect: uppercase type names,
// "nullable" instead of a union type) -- this is what actually constrains the model's output
// shape, not the prose above. Mirrors the same fields the rest of this file already expects
// from resolvePartIndices' input.
const PARTS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    parts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          material: { type: 'INTEGER', nullable: true },
          weight: { type: 'NUMBER', nullable: true },
          process: { type: 'INTEGER', nullable: true },
          endOfLife: { type: 'INTEGER', nullable: true },
          estimate: {
            type: 'OBJECT',
            nullable: true,
            properties: {
              ecoCost: { type: 'NUMBER' },
              co2e: { type: 'NUMBER' },
              water: { type: 'NUMBER' },
              energyIn: { type: 'NUMBER' },
            },
          },
        },
        required: ['name'],
      },
    },
  },
  required: ['parts'],
};

// Defensive fallback JSON extractor, kept from the old NVIDIA-based setup (where the model
// had no structural guarantee about its output shape and needed this to recover a
// {"parts":[...]} object out of whatever chatty text it wrapped it in). Gemini's
// responseSchema mode should make this unreachable in normal operation, but it's cheap
// insurance against JSON.parse ever failing on what's supposed to be guaranteed-clean JSON.
//
// Two earlier versions of this both broke on rambling responses in different ways: a
// greedy "first { ... last }" regex spans across ANY brace-like text before/after the
// real JSON; and just balancing braces from the very first "{" still picks the wrong
// span if there's earlier brace-like chatter (e.g. "my analysis {of the product}: {...}"
// -- "{of the product}" is itself perfectly balanced, just not valid/right JSON). This
// instead tries every "{" in the text as a candidate start, and for each, walks forward
// (string-aware, so braces inside quoted values don't confuse the depth count) to its
// true matching close brace, then actually attempts to parse *and* shape-check that
// span -- only accepting one that parses to an object with a "parts" array. Returns
// null if nothing in the whole text qualifies (e.g. the response got cut off mid-JSON,
// or the model never produced JSON shaped like what was asked for).
function extractPartsObject(text) {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, i + 1));
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.parts)) return parsed;
          } catch (e) { /* not valid JSON at this start position -- try the next "{" */ }
          break; // this span is closed; move on to the next candidate start
        }
      }
    }
  }
  return null;
}

// Low-level call to Gemini's generateContent endpoint. Throws on any transport/HTTP error
// (including AbortError from the shared timeout below) so callers can decide how to handle
// that per phase -- e.g. the research phase treats any failure as "no research available"
// rather than failing the whole request over an optional lookup.
async function geminiGenerateContent(requestBody, signal) {
  const res = await fetch(`${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || `AI service error (HTTP ${res.status}).`);
  }
  return data;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => p.text || '').join('');
}

// Optional pre-pass: lets Gemini use built-in Google Search grounding to look up a detail
// the given text/file doesn't state (a real product's typical weight, what a component is
// actually made of, etc.) before the structured extraction call below. This has to be a
// SEPARATE call rather than folded into the main one: Gemini doesn't support combining
// "tools" (grounding) with responseSchema/responseMimeType in a single request, so search
// and guaranteed-structured-output can't both apply to the same call. Returns a short text
// summary, or null if search is off, found nothing useful, or itself failed -- a failed or
// unhelpful research pass should never sink the whole extraction, since the main call still
// works fine without it (just without whatever the search would have filled in).
async function geminiResearch(userParts, signal) {
  if (!GEMINI_ENABLE_SEARCH) return null;
  try {
    const data = await geminiGenerateContent({
      contents: [{ role: 'user', parts: userParts }],
      systemInstruction: {
        parts: [{ text: 'Research any product details (typical weight, what a component is actually made of, etc.) that would help fill in a Life Cycle Assessment part list for the item(s) described below, using web search where genuinely useful. Only look up something that is actually missing from the text AND realistically answerable -- do not search speculatively for things already stated, or for details nobody could look up. Reply with a short plain-text summary of anything useful you found. If nothing further is needed, reply with exactly: Nothing further needed.' }],
      },
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
    }, signal);
    const text = extractGeminiText(data).trim();
    return text && text !== 'Nothing further needed.' ? text : null;
  } catch (e) {
    return null;
  }
}

// The main extraction call -- responseSchema (PARTS_RESPONSE_SCHEMA) makes this Gemini's
// structured-output mode, which constrains generation to the given shape rather than just
// asking nicely for it, so (unlike the old prompt-only approach) a malformed/off-schema
// response shouldn't be possible in the first place. extractPartsObject is still used as a
// defensive fallback in case JSON.parse ever fails on what should be guaranteed-clean JSON.
async function geminiExtractStructured(userParts, researchNote, signal) {
  const contents = [{ role: 'user', parts: userParts }];
  if (researchNote) {
    contents.push({ role: 'user', parts: [{ text: `Research findings from a prior web search pass, use where relevant:\n${researchNote}` }] });
  }
  const data = await geminiGenerateContent({
    contents,
    systemInstruction: { parts: [{ text: buildExtractionPrompt() }] },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: PARTS_RESPONSE_SCHEMA,
    },
  }, signal);

  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    throw new Error(`The AI declined to process this (reason: ${finishReason}). Try rephrasing the description.`);
  }

  const text = extractGeminiText(data);
  if (!text) throw new Error('AI response was missing the expected content.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = extractPartsObject(text);
  }
  if (!parsed || !Array.isArray(parsed.parts)) {
    throw new Error(`AI response didn't contain a usable parts list. Response started with: ${text.slice(0, 200)}`);
  }
  return parsed.parts;
}

const GEMINI_TIMEOUT_MS = 60000; // shared budget for the optional research pass + the structured extraction call

// Shared by both the text and file endpoints. userParts is Gemini's content format: an array
// of { text } and/or { inlineData: { mimeType, data } } objects (images included inline).
// Returns { status, body } -- status is the HTTP status the route should respond with.
async function callGeminiForParts(userParts) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const researchNote = await geminiResearch(userParts, controller.signal);

    let parts;
    try {
      parts = await geminiExtractStructured(userParts, researchNote, controller.signal);
    } catch (e) {
      if (e.name === 'AbortError') {
        return { status: 504, body: { error: `The AI service (including any web search it ran) took longer than ${GEMINI_TIMEOUT_MS / 1000} seconds to respond, so the request was cancelled. Please try again -- if it keeps happening, try a shorter or more specific description.` } };
      }
      return { status: 502, body: { error: e.message } };
    }

    // cap so a runaway response can't flood the page
    return { status: 200, body: { parts: resolvePartIndices(parts.slice(0, 30)) } };
  } finally {
    clearTimeout(timeoutId);
  }
}

app.post('/api/ai-extract-parts', aiLimiter, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'AI extraction is not configured on this server yet (GEMINI_API_KEY not set).' });
  }
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (!description) return res.status(400).json({ error: 'Describe the product first.' });
  if (description.length > 6000) return res.status(400).json({ error: 'Description is too long (max 6000 characters).' });

  const { status, body } = await callGeminiForParts([{ text: description }]);
  res.status(status).json(body);
});

// --- AI part extraction from an uploaded file (PDF, Word, Excel, or an image) ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

const DOCUMENT_EXTRACTORS = {
  '.pdf': async (buffer) => {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  },
  '.docx': async (buffer) => {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  },
  '.xlsx': (buffer) => spreadsheetToText(buffer),
  '.xls': (buffer) => spreadsheetToText(buffer),
};

function spreadsheetToText(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames
    .map((name) => `--- ${name} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
    .join('\n\n');
}

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

app.post('/api/ai-extract-parts-from-file', aiLimiter, upload.single('file'), async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'AI extraction is not configured on this server yet (GEMINI_API_KEY not set).' });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file was uploaded.' });

  const ext = path.extname(file.originalname || '').toLowerCase();

  // Images go straight to Gemini as inline image data -- no separate vision model needed,
  // unlike the old NVIDIA setup, since Gemini's Flash models are natively multimodal.
  if (IMAGE_MIME_TYPES.has(file.mimetype)) {
    const base64 = file.buffer.toString('base64');
    const { status, body } = await callGeminiForParts([
      { text: 'Extract the parts from this image (a product photo, spec sheet, or handwritten notes).' },
      { inlineData: { mimeType: file.mimetype, data: base64 } },
    ]);
    return res.status(status).json(body);
  }

  // Otherwise: extract text from the document, then reuse the same text-based flow.
  const extractor = DOCUMENT_EXTRACTORS[ext];
  if (!extractor) {
    return res.status(400).json({ error: `Unsupported file type "${ext || file.mimetype}". Supported: PDF, DOCX, XLS/XLSX, or an image.` });
  }

  let text;
  try {
    text = await extractor(file.buffer);
  } catch (e) {
    return res.status(400).json({ error: `Could not read that file: ${e.message}` });
  }
  text = (text || '').trim();
  if (!text) return res.status(400).json({ error: 'No readable text was found in that file.' });
  if (text.length > 12000) text = text.slice(0, 12000);

  const { status, body } = await callGeminiForParts([{ text }]);
  res.status(status).json(body);
});

// Multer errors (e.g. file too large) reach here instead of the route handler.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 15 MB).' : err.message });
  }
  next(err);
});

// --- Static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// Centralized error handler — catches thrown/rejected errors from the async
// route handlers above (Express 5 forwards these automatically) so a bug
// returns a clean 500 instead of crashing the process or leaking a stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Eco-Cost Calculator listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
