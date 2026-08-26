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

// AI part extraction (optional — Groq's OpenAI-compatible API, https://console.groq.com).
// Switched here from Google Gemini because Gemini's free tier turned out to require a
// billing account on file for this account/region -- not a code problem, just not usable
// without adding payment info. Groq's free tier doesn't require that. GROQ_API_KEY is a
// secret and must only ever live here as a server env var, never in any file served to the
// browser.
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
// llama-3.3-70b-versatile (this project's first guess, based on training-data knowledge of
// Groq's catalog) turned out to no longer exist on Groq -- model catalogs change faster than
// any hardcoded default can track. This one was confirmed live, straight from Groq's own
// console with a real API key, not guessed: if it ever stops working, check
// console.groq.com's Playground for a current model name rather than assuming this file's
// default is still accurate.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
// Groq currently hosts NO vision-capable model at all -- confirmed by reading the full live
// model catalog from the Groq console (Alibaba Cloud, Canopy Labs, Groq, Meta, OpenAI groups):
// text-only reasoning models (gpt-oss-120b/20b, qwen3.6-27b), Whisper (speech-to-text),
// Orpheus (text-to-speech), and Llama Prompt Guard (a safety classifier, not general chat).
// No image-input model anywhere in it. So unlike GROQ_MODEL above, this intentionally has NO
// default -- guessing one that turns out not to exist just reproduces the same decommissioned-
// model error every time someone tries to upload an image. Leave GROQ_VISION_MODEL unset until
// Groq actually hosts a vision-capable model (or a different provider is used for just this
// path); the image-upload route below fails clearly and immediately when it's unset, rather
// than attempting a request that's guaranteed to fail.
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || '';
if (!GROQ_API_KEY) {
  console.warn('GROQ_API_KEY not set — AI part extraction is disabled (everything else still works).');
}

// Web search (optional — Tavily, https://tavily.com). Groq has no built-in search-grounding
// tool the way some other providers do, so this is a separate service/key -- without it,
// extraction still works exactly as before, just without the ability to look up a detail
// (a component's typical weight, what it's actually made of) that the given text doesn't
// state; the model is never even told search exists in that case (no "tools" sent).
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
if (GROQ_API_KEY && !TAVILY_API_KEY) {
  console.warn('TAVILY_API_KEY not set — AI part extraction will work from the given text/file only, without web search.');
}

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

// Groq's JSON mode (response_format below) only guarantees the response is syntactically
// valid JSON -- unlike Gemini's responseSchema, it doesn't constrain which fields or types
// appear, so unlike that version, this prompt still has to spell out the exact shape rather
// than relying on the API to enforce it. Combined with the numbered-index approach (a model
// that isn't confident which list entry fits can output null; it's much harder to
// almost-get-right a number than to invent a plausible-sounding string) and the defensive
// extractPartsObject fallback below, this is the next-best reliability layer available
// without Gemini's structural guarantee.
function buildExtractionPrompt() {
  return `You extract structured part data from a free-text product description for a Life Cycle Assessment calculator.

Output ONLY the JSON object below and absolutely nothing else: no markdown code fences, no "Here is the JSON:", no reasoning, no explanation, no follow-up questions, before or after it. Your entire response must be parseable as JSON on its own. Keep it short -- do not add extra fields, comments, or repeated/padded text.
{"parts":[{"name":string,"material":number|null,"weight":number|null,"process":number|null,"endOfLife":number|null,"estimate":{"ecoCost":number,"co2e":number,"water":number,"energyIn":number}|null}]}

Rules:
- "material" is the NUMBER of the single best-matching entry in this numbered list, or null if nothing clearly matches. Never output a material's name as text -- only its number, or null:
${numberedList(MATERIAL_NAMES)}
- "process" is the NUMBER of the matching entry in this numbered list, or null if not mentioned:
${numberedList(PROCESS_NAMES)}
- "endOfLife" is the NUMBER of the matching entry in this numbered list, or null if not mentioned:
${numberedList(EOL_NAMES)}
- "weight" is in kilograms as a plain number (convert other units), or null if not stated. If the text gives an OVERALL weight for the whole product but doesn't break it down per component, don't just leave every component's weight null -- apportion the total across the parts using genuinely reasonable typical mass proportions for that kind of product (e.g. in a battery/capacitor, electrodes typically account for more mass than the separator). The apportioned figures should still sum to roughly the stated total.${TAVILY_API_KEY ? ' If there is no total to apportion either, and the text names a specific real product, use the search_web tool to look up its typical weight rather than immediately defaulting to null.' : ''} Only leave "weight" null when there's truly nothing -- no stated total, no per-part figure${TAVILY_API_KEY ? ', and no answerable search query' : ''} -- to work from at all.
- "estimate": whenever "material" is null (nothing in the list above fits), DEFAULT TO PROVIDING this rather than leaving it null too -- you almost always know enough in general terms (e.g. carbon-based electrode materials, common metals/plastics/ceramics, typical composite panels) to give a genuinely useful rough figure, and these are always shown to the user clearly labeled as an unverified AI estimate, not as certified reference data, so an approximate ballpark is exactly what's wanted here, not a precise number. Give your own best-guess PER-KILOGRAM figures: ecoCost in euros/kg, co2e in kgCO2e/kg, water in L/kg, energyIn in kWh/kg -- fill in every one of the 4 fields with your best number, never omit one partway through. Only leave the whole "estimate" null when the part is so vague (e.g. "miscellaneous hardware" with zero further detail) that you'd genuinely be inventing numbers with no basis at all. Always null when "material" is non-null.
  Example: description mentions "a gasket made of a proprietary rubber-silicone blend" (not in the list) -> {"name":"Gasket","material":null,"weight":0.02,"process":null,"endOfLife":null,"estimate":{"ecoCost":2.1,"co2e":3.8,"water":22,"energyIn":18}} -- general knowledge of rubber/silicone production impact is enough for a reasonable estimate even without knowing the exact proprietary blend. This is the expected default, not a rare exception.
- Create one entry in "parts" per distinct physical component described. A single simple product is one entry, and cap it at 10 entries even if more are described.
- Only give a material number when you're genuinely confident which one specific entry fits -- a wrong number is worse than null. When unsure, use null for "material" and fall back to "estimate" instead if you can.
${TAVILY_API_KEY ? '- If the text names a specific real product but leaves out a detail you need (its typical weight, what a component is actually made of, etc.), use the search_web tool to look it up rather than immediately defaulting to null -- but only search when you have a genuinely specific, answerable question; don\'t search speculatively for every part, and don\'t search more than necessary to fill the gaps that actually matter for this product.' : ''}
- If nothing usable is described, respond with {"parts":[]} -- never refuse, apologize, or ask a clarifying question instead.`;
}

// Deliberately lightweight -- this is ONLY for the search-decision phase (phase 1 in
// groqChatOnce below), which just decides whether to call search_web, not the actual
// extraction. It must NOT include the numbered material/process/end-of-life lists: those
// dominate the token cost of buildExtractionPrompt() above, and since this phase runs as its
// own separate API call (Groq rejects combining tools with JSON mode, so it can't be folded
// into the main extraction call), paying that cost twice per "turn" bought nothing -- this
// phase doesn't do any matching, phase 2 does. A real Groq TPM rate-limit error on this
// project's free tier is what surfaced how much the duplicated prompt was actually costing.
function buildSearchDecisionPrompt() {
  return `You're about to extract structured part data from a product description for a Life Cycle Assessment calculator (a separate step handles the actual extraction). First: decide whether you need to look up a detail the text doesn't state -- a specific real product's typical weight, or what a component is actually made of. If so, call search_web with one concise, specific query. If the text already has enough detail, or nothing about it is realistically answerable by search, don't call any tool. Your reply text here is discarded either way -- only whether you call the tool matters.`;
}

// Fallback JSON extractor for when the model's JSON-mode response isn't directly
// JSON.parse-able as-is (Groq's JSON mode guarantees syntactically valid JSON, not that it's
// the ONLY thing in the response -- a model can still wrap it in chatty text despite being
// told not to). Scans for a recoverable {"parts":[...]} object rather than trusting the
// whole reply is clean JSON.
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

const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'search_web',
    description: 'Search the web to fill in a product detail (typical weight, material composition, etc.) that the given text doesn\'t state. Only call this when you actually need it -- not for every part, and not when the text already tells you what you need.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A concise, specific web search query.' } },
      required: ['query'],
    },
  },
};

// Runs a Tavily search (https://tavily.com) -- returns a small, model-readable result set,
// or a graceful { error } string on any failure so a search hiccup degrades the loop instead
// of crashing it. Shares the caller's AbortSignal so a search can never outlive the overall
// call budget below.
async function searchWeb(query, signal) {
  if (!TAVILY_API_KEY) return { error: 'Web search is not configured.' };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'basic', max_results: 5, include_answer: true }),
      signal,
    });
    if (!res.ok) return { error: `Search failed (HTTP ${res.status}).` };
    const data = await res.json().catch(() => null);
    if (!data) return { error: 'Search returned an unreadable response.' };
    const results = Array.isArray(data.results)
      ? data.results.slice(0, 5).map((r) => ({ title: r.title, url: r.url, snippet: String(r.content || '').slice(0, 500) }))
      : [];
    return { answer: data.answer || null, results };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'Search timed out.' : `Search error: ${e.message}` };
  }
}

const MAX_TOOL_ROUNDS = 1; // caps how many search rounds the search phase below can do
const GROQ_TIMEOUT_MS = 40000; // hard cap per groqChatOnce call (covers both phases) -- never hang indefinitely

// Waits ms milliseconds, but rejects immediately (AbortError) if signal fires first -- so a
// rate-limit backoff wait can never outlive the caller's overall timeout budget.
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

const MAX_429_RETRIES = 3; // retry attempts on rate-limit, not counting the original request

// Low-level single HTTP call to Groq's chat/completions. Throws on transport/HTTP error so
// both phases below can share one error-handling path.
//
// Exponential backoff on 429 (rate limit), up to MAX_429_RETRIES retries -- real usage on
// this project's Groq free tier hit its per-minute token cap (8000 TPM for this model) more
// than once, sometimes by a small enough margin that a short wait clears it. Groq's own
// Retry-After header is honored exactly when present (capped at 15s, since it tells us
// precisely how long the server wants us to wait); when it's absent, the wait doubles each
// attempt (2s, 4s, 8s, capped at 15s) rather than reusing one fixed guess for every retry.
// This does NOT raise the underlying cap -- a request that's genuinely far over budget still
// fails after all retries are exhausted, with a message telling the user to wait rather than
// a raw Groq error. The shared AbortController this is called under (see groqChatOnce) bounds
// the total wait regardless, so a long backoff sequence can't outlive the per-call timeout.
//
// Also retries exactly once, WITHOUT response_format, on Groq's json_validate_failed error --
// Groq runs its own server-side check that a JSON-mode generation is actually valid JSON, and
// when it isn't (real example: an empty generation), it rejects the whole request with a 400
// instead of just returning the (invalid) text -- meaning extractPartsObject, this project's
// own more forgiving fallback parser, never even gets a chance to run on it. Dropping
// response_format and relying on the prompt's own "output only JSON" instruction plus that
// fallback parser gives the model a second chance that isn't gated by Groq's stricter check.
//
// Also retries exactly once, with the SAME request, on Groq's tool_use_failed error -- a real
// production failure where the model hallucinated a call to a nonexistent tool ("web.run",
// not anything this app defines) on a request that offered no tools at all, which Groq
// rejects outright. The primary fix for this is in groqChatOnce (phase 2 no longer carries
// phase 1's raw tool-call-shaped messages, which is what was likely priming the model to
// keep "calling tools"); this retry is a defensive backstop in case the hallucination still
// happens occasionally even without that priming.
async function groqRequest(body, signal, retryState = {}) {
  const { retries429 = 0, retriedWithoutJsonMode = false, retriedAfterToolUseFailed = false } = retryState;
  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 429 && retries429 < MAX_429_RETRIES) {
    const retryAfterSeconds = Number(res.headers.get('retry-after'));
    const waitSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds, 15)
      : Math.min(2 ** (retries429 + 1), 15); // no header given -- exponential backoff: 2s, 4s, 8s...
    await sleep(waitSeconds * 1000, signal);
    return groqRequest(body, signal, { retries429: retries429 + 1, retriedWithoutJsonMode, retriedAfterToolUseFailed });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let errBody = null;
    try { errBody = JSON.parse(errText); } catch (e) { /* not JSON -- errBody stays null, handled below */ }

    if (res.status === 400 && errBody?.error?.code === 'json_validate_failed' && !retriedWithoutJsonMode && body.response_format) {
      const { response_format, ...bodyWithoutJsonMode } = body;
      return groqRequest(bodyWithoutJsonMode, signal, { retries429, retriedWithoutJsonMode: true, retriedAfterToolUseFailed });
    }

    if (res.status === 400 && errBody?.error?.code === 'tool_use_failed' && !retriedAfterToolUseFailed) {
      return groqRequest(body, signal, { retries429, retriedWithoutJsonMode, retriedAfterToolUseFailed: true });
    }

    const err = new Error(
      res.status === 429
        ? `Groq's rate limit is still active after ${MAX_429_RETRIES} retries -- please wait about a minute and try again. (${errText.slice(0, 150)})`
        : `AI service error (${res.status}): ${errText.slice(0, 200)}`
    );
    err.httpStatus = res.status === 429 ? 429 : 502;
    throw err;
  }
  const data = await res.json().catch(() => null);
  const message = data?.choices?.[0]?.message;
  if (!message) {
    const err = new Error('AI response was missing the expected content.');
    err.httpStatus = 502;
    throw err;
  }
  return message;
}

// One logical "turn". Two phases, run as SEPARATE requests, never combined in one: Groq
// rejects response_format: json_object together with tools in the same request ("json mode
// cannot be combined with tool/function calling") -- a real constraint discovered the hard
// way when search was first wired in here, not something documented up front. So:
//
// Phase 1 (only when TAVILY_API_KEY is set): up to MAX_TOOL_ROUNDS rounds where the model can
// call the search_web tool, no JSON mode -- if it never calls a tool, this phase contributes
// nothing but costs one call; its output text (if any) is discarded either way, since without
// JSON mode it isn't reliably parseable and phase 2 always produces the real answer.
//
// Phase 2 (always runs): one call with response_format: json_object and no tools, given
// whatever search results phase 1 gathered as extra context, to produce the actual
// {"parts":[...]} answer with the same baseline JSON-syntax guarantee as before search
// existed. extractPartsObject is a defensive fallback for the rare case content isn't
// parseable on its own despite JSON mode.
//
// One AbortController covers both phases, not a fresh timeout per phase -- an unbounded
// per-phase timeout is the same class of bug this app has already been burned by once
// before. callGroqForParts (below) can call this function itself up to twice (once
// normally, once as a corrective retry), so worst-case total latency is roughly double
// GROQ_TIMEOUT_MS.
async function groqChatOnce(messages, model) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  try {
    // messages[0] is always the heavy extraction system prompt (built by the caller); the
    // rest is the actual description/file/image content, identical for both phases.
    const [extractionSystemMessage, ...userMessages] = messages;
    const allowTools = Boolean(TAVILY_API_KEY);
    const searchFindings = []; // plain-text summaries of what phase 1's searches found, if any

    try {
      if (allowTools) {
        // Phase 1 uses its OWN lightweight system prompt, not the heavy extraction one --
        // this phase only decides whether to search, so paying for the full numbered
        // material/process/end-of-life lists here bought nothing and doubled the token cost
        // of every "turn" for no benefit (see buildSearchDecisionPrompt's comment).
        const phase1Messages = [{ role: 'system', content: buildSearchDecisionPrompt() }, ...userMessages];
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const message = await groqRequest({
            model,
            messages: phase1Messages,
            temperature: 0.1,
            max_tokens: 256,
            tools: [SEARCH_TOOL],
            tool_choice: 'auto',
          }, controller.signal);

          const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
          if (!toolCalls.length) break; // model didn't need to search -- move straight to phase 2

          phase1Messages.push(message); // the assistant's tool-call request, required context for the follow-up
          // Run every search the model asked for in this round concurrently, not one-by-one --
          // a round that needs 2-3 lookups shouldn't pay for their latency serially.
          const toolResults = await Promise.all(toolCalls.map(async (call) => {
            let query = '';
            try { query = JSON.parse(call.function?.arguments || '{}').query || ''; } catch (e) { /* malformed args -- proceed with empty query below */ }
            const result = query ? await searchWeb(query, controller.signal) : { error: 'No search query was provided.' };
            const summary = result.error
              ? `Search failed: ${result.error}`
              : result.answer || (result.results || []).map((r) => r.snippet).filter(Boolean).join(' | ') || 'No useful results.';
            searchFindings.push(`Query: "${query || '(none given)'}" -> ${summary}`);
            return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) };
          }));
          phase1Messages.push(...toolResults);
        }
      }

      // Phase 2: the real extraction prompt, the original user content, plus a PLAIN-TEXT
      // summary of anything phase 1 found -- deliberately NOT phase 1's raw tool-call/
      // tool-result message shape. A real production failure showed the model
      // pattern-matching on "I was just calling tools" and hallucinating a tool call (a
      // nonexistent "web.run") in phase 2, where no tools are offered at all -- Groq's API
      // correctly rejects that outright ("Tool choice is none, but model called a tool").
      // A plain informational message carries the same content without a tool-call shape
      // for the model to imitate.
      const phase2Messages = [...userMessages];
      if (searchFindings.length) {
        phase2Messages.push({
          role: 'user',
          content: `Web search findings (already gathered -- no further searching is possible right now, just use this information directly if it's relevant):\n${searchFindings.join('\n')}`,
        });
      }

      // (phase 2 is the only call that pays for the numbered lists)
      const message = await groqRequest({
        model,
        messages: [extractionSystemMessage, ...phase2Messages],
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      }, controller.signal);

      const content = message.content;
      if (typeof content !== 'string') {
        return { status: 502, body: { error: 'AI response was missing the expected content.' } };
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        parsed = extractPartsObject(content);
      }
      if (!parsed || !Array.isArray(parsed.parts)) {
        return {
          status: 502,
          body: { error: `AI response didn't contain a usable {"parts":[...]} object (it may have rambled, been cut off, or refused). Response started with: ${content.slice(0, 200)}` },
        };
      }

      // cap so a runaway response can't flood the page
      return { status: 200, body: { parts: resolvePartIndices(parsed.parts.slice(0, 30)) } };
    } catch (e) {
      if (e.name === 'AbortError') {
        return { status: 504, body: { error: `The AI service (including any web search it ran) took longer than ${GROQ_TIMEOUT_MS / 1000} seconds to respond, so the request was cancelled. Please try again -- if it keeps happening, the model may be overloaded; try a shorter description or a different GROQ_MODEL.` } };
      }
      if (e.httpStatus) {
        return { status: e.httpStatus, body: { error: e.message } };
      }
      return { status: 502, body: { error: 'Could not reach the AI service: ' + e.message } };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// True if at least one part has SOMETHING the user can act on -- a catalog match, or an
// estimate with at least one non-zero field -- AND a usable weight, mirroring exactly what
// the client requires before a part can actually be added (see hasWeight/applyAiPartSuggestions
// in app.js): a material match with no weight is just as useless to the user as no material
// at all, since neither can turn into a real line item. False means the model found named
// parts but gave literally nothing usable for any of them, which is functionally the same as
// not extracting anything even though the call technically "succeeded".
function hasAnyUsableData(parts) {
  return parts.some((p) => {
    const weight = Number(p.weight);
    const hasWeight = Number.isFinite(weight) && weight > 0;
    return hasWeight && (p.material || (p.estimate && Object.values(p.estimate).some((v) => v > 0)));
  });
}

function buildRetryNudge() {
  return `Your previous response above left every single part unusable -- either "material" and "estimate" were both null, or "weight" was null even where a material matched. That combination only makes sense if you genuinely have zero information to work with, which is unlikely here. Try again: for every part where "material" stays null, fill in "estimate" with your best-guess figures based on general knowledge of similar materials/components. For every part missing "weight", check whether the text gives an overall/total weight you can apportion across components using reasonable typical mass proportions${TAVILY_API_KEY ? ', or use the search_web tool to look up a typical weight if the product is a specific real one' : ''}, rather than leaving it null. Only leave a field null when there truly is nothing to base a value on.`;
}

// Deliberately generic, deliberately modest per-kilogram figures -- not a claim about any
// real material, just enough to make a part's total nonzero and reviewable rather than
// invisible. Always shown to the user with an unmistakable "generic placeholder, please
// correct" label (see genericFallback handling in app.js), never presented as an estimate of
// anything in particular.
const GENERIC_FALLBACK_ESTIMATE = { ecoCost: 1.0, co2e: 3.0, water: 30, energyIn: 20 };

// Last-resort guarantee: a part with a real weight but still no catalog material AND no
// usable AI estimate (even after the retry above) gets the generic placeholder attached
// instead of being left to fall through to "add this yourself". This is a deliberate policy
// choice, not a data-quality claim -- every part the AI actually found and could weigh
// becomes a reviewable line item in the product, full stop; a weight-less part still can't
// be invented a number for (weight is product-specific in a way generic material class
// impact isn't), so that's the one case that still requires the user to fill in manually.
function applyGenericFallback(parts) {
  return parts.map((p) => {
    const weight = Number(p.weight);
    const hasWeight = Number.isFinite(weight) && weight > 0;
    const hasEstimate = p.estimate && Object.values(p.estimate).some((v) => v > 0);
    if (!hasWeight || p.material || hasEstimate) return p;
    return { ...p, estimate: { ...GENERIC_FALLBACK_ESTIMATE }, genericFallback: true };
  });
}

// Shared by both the text and file endpoints. Retries once, with a pointed correction, if the
// model's response found named parts but provided zero genuinely usable data for any of them
// (no catalog match + estimate combo, or no weight to attach it to) -- a response like that
// is functionally the same as not extracting anything, and this was a real observed failure
// mode worth actively pushing back on rather than silently accepting. Only retries in that
// specific case: a normal response (even a partial one) or a hard error both return
// immediately, so this doesn't add latency to the common case. After the retry settles (or is
// skipped), applyGenericFallback makes a final pass so nothing with a real weight is ever
// left completely unusable.
async function callGroqForParts(messages, model) {
  const result = await groqChatOnce(messages, model);
  if (result.status !== 200) return result;

  let finalParts = result.body.parts;
  if (finalParts.length && !hasAnyUsableData(finalParts)) {
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: JSON.stringify({ parts: finalParts }) },
      { role: 'user', content: buildRetryNudge() },
    ];
    const retryResult = await groqChatOnce(retryMessages, model);
    if (retryResult.status === 200) finalParts = retryResult.body.parts;
  }

  return { status: 200, body: { parts: applyGenericFallback(finalParts) } };
}

app.post('/api/ai-extract-parts', aiLimiter, async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(503).json({ error: 'AI extraction is not configured on this server yet (GROQ_API_KEY not set).' });
  }
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (!description) return res.status(400).json({ error: 'Describe the product first.' });
  if (description.length > 6000) return res.status(400).json({ error: 'Description is too long (max 6000 characters).' });

  const { status, body } = await callGroqForParts(
    [
      { role: 'system', content: buildExtractionPrompt() },
      { role: 'user', content: description },
    ],
    GROQ_MODEL
  );
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
  if (!GROQ_API_KEY) {
    return res.status(503).json({ error: 'AI extraction is not configured on this server yet (GROQ_API_KEY not set).' });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file was uploaded.' });

  const ext = path.extname(file.originalname || '').toLowerCase();

  // Images go to a separate vision-capable model as an image + instructions, not extracted text.
  if (IMAGE_MIME_TYPES.has(file.mimetype)) {
    if (!GROQ_VISION_MODEL) {
      return res.status(503).json({ error: 'Image-based extraction isn\'t currently supported (no vision-capable AI model is configured) -- try describing the product in text instead, or attach a PDF/Word/Excel document.' });
    }
    const base64 = file.buffer.toString('base64');
    const { status, body } = await callGroqForParts(
      [
        { role: 'system', content: buildExtractionPrompt() },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the parts from this image (a product photo, spec sheet, or handwritten notes).' },
            { type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${base64}` } },
          ],
        },
      ],
      GROQ_VISION_MODEL
    );
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

  const { status, body } = await callGroqForParts(
    [
      { role: 'system', content: buildExtractionPrompt() },
      { role: 'user', content: text },
    ],
    GROQ_MODEL
  );
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
    app.listen(PORT, () => console.log(`Life Cycle Calculator listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
