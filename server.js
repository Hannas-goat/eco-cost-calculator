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

// AI part extraction (optional — NVIDIA's OpenAI-compatible API, https://build.nvidia.com).
// Reverted here from Groq after a long run of Groq-specific quirks (a deprecated default
// model, tools being incompatible with JSON mode, an 8000 TPM free-tier rate cap, a
// server-side JSON validator that rejects rather than returns malformed output, and a
// hallucinated tool call Groq's API rejected outright) -- NVIDIA was this project's original,
// more stable provider before any of that. NVIDIA_API_KEY is a secret and must only ever live
// here as a server env var, never in any file served to the browser.
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct';
const NVIDIA_VISION_MODEL = process.env.NVIDIA_VISION_MODEL || 'meta/llama-3.2-90b-vision-instruct';
if (!NVIDIA_API_KEY) {
  console.warn('NVIDIA_API_KEY not set — AI part extraction is disabled (everything else still works).');
}

// Web search (optional — Tavily, https://tavily.com). Without it, extraction still works
// exactly as before, just without the ability to look up a detail (a component's typical
// weight, what it's actually made of) that the given text doesn't state; the model is never
// even told search exists in that case (no "tools" sent).
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
if (NVIDIA_API_KEY && !TAVILY_API_KEY) {
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

// NVIDIA's API has no JSON-mode/schema enforcement to lean on, so this prompt has to spell
// out the exact output shape itself rather than relying on the API to constrain it. The
// numbered-index approach for material/process/endOfLife (a model that isn't confident which
// list entry fits can output null; it's much harder to almost-get-right a number than to
// invent a plausible-sounding string) plus the defensive extractPartsObject fallback below
// are the reliability layers doing the real work here.
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

// Fallback JSON extractor for when the model doesn't reply with clean JSON on its own (models
// often wrap JSON in chatty text despite being told not to, and NVIDIA's API doesn't offer a
// JSON-mode server-side guarantee the way some other providers do). Scans for a recoverable
// {"parts":[...]} object rather than trusting the whole reply is clean JSON.
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

const MAX_TOOL_ROUNDS = 1; // caps how many search-then-reask cycles a single request can do
const NVIDIA_TIMEOUT_MS = 45000; // hard cap -- covers every round -- never hang indefinitely
const MAX_429_RETRIES = 3; // retry attempts on rate-limit, not counting the original request

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

// Low-level single HTTP call to NVIDIA's chat/completions. Throws on transport/HTTP error so
// the caller can handle it in one place.
//
// Exponential backoff on 429 (rate limit), up to MAX_429_RETRIES retries: the exact provider
// changes (this project has used NVIDIA, then briefly Gemini and Groq, now back to NVIDIA),
// but "a paid external API can rate-limit you" doesn't, so this stays regardless of which one
// is active. Retry-After is honored exactly when present (capped at 15s, since it tells us
// precisely how long the server wants us to wait); when it's absent, the wait doubles each
// attempt (2s, 4s, 8s, capped at 15s) rather than reusing one fixed guess for every retry.
// The shared AbortController this is called under (see callNvidiaForParts) bounds the total
// wait regardless, so a long backoff sequence can't outlive the per-call timeout.
async function nvidiaRequest(body, signal, retryState = {}) {
  const { retries429 = 0 } = retryState;
  const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 429 && retries429 < MAX_429_RETRIES) {
    const retryAfterSeconds = Number(res.headers.get('retry-after'));
    const waitSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds, 15)
      : Math.min(2 ** (retries429 + 1), 15); // no header given -- exponential backoff: 2s, 4s, 8s...
    await sleep(waitSeconds * 1000, signal);
    return nvidiaRequest(body, signal, { retries429: retries429 + 1 });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(
      res.status === 429
        ? `The AI service's rate limit is still active after ${MAX_429_RETRIES} retries -- please wait about a minute and try again. (${errText.slice(0, 150)})`
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

// One logical "turn": a single round-based loop that optionally lets the model call the
// search_web tool (only when TAVILY_API_KEY is set -- otherwise "tools" is never sent, so the
// model doesn't even know search exists) before producing its final answer. NVIDIA's API
// doesn't reject combining tool definitions with a plain "output only JSON" prompt
// instruction the way Groq's did (no response_format/JSON-mode is used at all here --
// extractPartsObject's brace-scanning is the real safety net for malformed output), so this
// can stay a single unified loop rather than needing the two-call phase split Groq's stricter
// API required.
//
// One AbortController covers every round, not a fresh timeout per round -- an unbounded
// per-round timeout is the same class of bug this app has already been burned by once before.
// callNvidiaForParts (below) can call this function itself up to twice (once normally, once
// as a corrective retry), so worst-case total latency is roughly double NVIDIA_TIMEOUT_MS.
async function nvidiaChatOnce(messages, model) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NVIDIA_TIMEOUT_MS);
  try {
    const workingMessages = [...messages];
    const allowTools = Boolean(TAVILY_API_KEY);

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      let message;
      try {
        message = await nvidiaRequest({
          model,
          messages: workingMessages,
          temperature: 0.1,
          max_tokens: 1024,
          ...(allowTools && round < MAX_TOOL_ROUNDS ? { tools: [SEARCH_TOOL], tool_choice: 'auto' } : {}),
        }, controller.signal);
      } catch (e) {
        if (e.name === 'AbortError') {
          return { status: 504, body: { error: `The AI service (including any web search it ran) took longer than ${NVIDIA_TIMEOUT_MS / 1000} seconds to respond, so the request was cancelled. Please try again -- if it keeps happening, the model may be overloaded; try a shorter description or a different NVIDIA_MODEL.` } };
        }
        if (e.httpStatus) {
          return { status: e.httpStatus, body: { error: e.message } };
        }
        return { status: 502, body: { error: 'Could not reach the AI service: ' + e.message } };
      }

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length && round < MAX_TOOL_ROUNDS) {
        workingMessages.push(message); // the assistant's tool-call request, required context for the follow-up
        // Run every search the model asked for in this round concurrently, not one-by-one --
        // a round that needs 2-3 lookups shouldn't pay for their latency serially.
        const toolResults = await Promise.all(toolCalls.map(async (call) => {
          let query = '';
          try { query = JSON.parse(call.function?.arguments || '{}').query || ''; } catch (e) { /* malformed args -- proceed with empty query below */ }
          const result = query ? await searchWeb(query, controller.signal) : { error: 'No search query was provided.' };
          return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) };
        }));
        workingMessages.push(...toolResults);
        continue; // ask the model again, now with search results in context
      }
      if (toolCalls.length) {
        // Reached the final round (tools weren't even offered this time) and the model
        // still tried to call one -- treat it the same as never settling, rather than
        // falling through to a confusing "missing content" error below.
        return { status: 502, body: { error: 'The AI ran multiple searches without settling on a final answer. Try a more specific description.' } };
      }

      const content = message.content;
      if (typeof content !== 'string') {
        return { status: 502, body: { error: 'AI response was missing the expected content.' } };
      }

      const parsed = extractPartsObject(content);
      if (!parsed) {
        return {
          status: 502,
          body: { error: `AI response didn't contain a usable {"parts":[...]} object (it may have rambled, been cut off, or refused). Response started with: ${content.slice(0, 200)}` },
        };
      }

      // cap so a runaway response can't flood the page
      return { status: 200, body: { parts: resolvePartIndices(parsed.parts.slice(0, 30)) } };
    }
    // Unreachable in practice: every loop iteration above returns or continues, and
    // continuing is only allowed while round < MAX_TOOL_ROUNDS, so the final iteration
    // always hits a return -- kept as a defensive fallback in case that invariant changes.
    return { status: 502, body: { error: 'The AI ran multiple searches without settling on a final answer. Try a more specific description.' } };
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
async function callNvidiaForParts(messages, model) {
  const result = await nvidiaChatOnce(messages, model);
  if (result.status !== 200) return result;

  let finalParts = result.body.parts;
  if (finalParts.length && !hasAnyUsableData(finalParts)) {
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: JSON.stringify({ parts: finalParts }) },
      { role: 'user', content: buildRetryNudge() },
    ];
    const retryResult = await nvidiaChatOnce(retryMessages, model);
    if (retryResult.status === 200) finalParts = retryResult.body.parts;
  }

  return { status: 200, body: { parts: applyGenericFallback(finalParts) } };
}

app.post('/api/ai-extract-parts', aiLimiter, async (req, res) => {
  if (!NVIDIA_API_KEY) {
    return res.status(503).json({ error: 'AI extraction is not configured on this server yet (NVIDIA_API_KEY not set).' });
  }
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (!description) return res.status(400).json({ error: 'Describe the product first.' });
  if (description.length > 6000) return res.status(400).json({ error: 'Description is too long (max 6000 characters).' });

  const { status, body } = await callNvidiaForParts(
    [
      { role: 'system', content: buildExtractionPrompt() },
      { role: 'user', content: description },
    ],
    NVIDIA_MODEL
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
  if (!NVIDIA_API_KEY) {
    return res.status(503).json({ error: 'AI extraction is not configured on this server yet (NVIDIA_API_KEY not set).' });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file was uploaded.' });

  const ext = path.extname(file.originalname || '').toLowerCase();

  // Images go to a separate vision-capable model as an image + instructions, not extracted text.
  if (IMAGE_MIME_TYPES.has(file.mimetype)) {
    const base64 = file.buffer.toString('base64');
    const { status, body } = await callNvidiaForParts(
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
      NVIDIA_VISION_MODEL
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

  const { status, body } = await callNvidiaForParts(
    [
      { role: 'system', content: buildExtractionPrompt() },
      { role: 'user', content: text },
    ],
    NVIDIA_MODEL
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
