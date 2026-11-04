# pii-airlock-extension — Agent Context

## What this project is

A **standalone WXT browser extension** (Chrome/Edge MV3 + Firefox MV2) that automatically detects and obfuscates PII in any AI chat interface before the user sends a message.

- **No backend required.** Zero install friction — installs from browser store, works immediately.
- **Pure JS detection engine** bundled inside the extension (compromise.js NER + regex).
- Targets: ChatGPT, Claude, Gemini, Copilot, Perplexity, Poe, and more via heuristic fallback.
- Optional enhanced mode: if `pii-airlock` Python proxy runs on localhost:8745, the extension upgrades to Presidio+spaCy quality automatically.

## Related project

`../pii-airlock/` — Python CLI + proxy that this extension can optionally delegate to.
See `../pii-airlock/pii_scrub/` for the reference detection/mapping/payload logic.
Token format `<ENTITY_TYPE_N>` is shared between both projects.

## Tech stack

- **WXT** `0.20.26` — cross-browser extension framework (Vite-powered)
- **React 19** — popup + options UI
- **Bun** — package manager and test runner (`bun test`)
- **TypeScript** strict mode
- **compromise** — lightweight English NLP for person/place/org detection
- **franc-min** — language detection, routes to language-specific regex variants

## Project structure

```
entrypoints/
  background.ts      Service worker: tab registry, alarm cleanup, settings sync
  content.ts         Per-page: adapter loader, send intercept, detection, inline UI
  popup/App.tsx      Status toggle (active/paused), stats, panic-clear mapping
  options/App.tsx    Per-entity policy config, strict/permissive mode, language

lib/
  detection/
    types.ts         Shared types: Detection, Entity, RiskTier, Decision
    regex.ts         Layer 1: structured PII patterns (email, phone, card+Luhn, etc.)
    nlp.ts           Layer 2: compromise.js wrapper → Detection[]
    lang.ts          franc-min: detect text language → select regex variant
    engine.ts        Combines L1+L2, deduplicates overlapping spans
  mapping.ts         BrowserMapping: tokenFor(), restore(), clear() — in-memory only
  policy.ts          Risk-tier decision matrix → allow/warn/auto_scrub/block
  intercept.ts       keydown/click/paste/drop send pipeline, fail-closed
  adapters/
    types.ts         Adapter interface
    chatgpt.ts       chat.openai.com / chatgpt.com
    claude.ts        claude.ai
    gemini.ts        gemini.google.com
    copilot.ts       copilot.microsoft.com
    perplexity.ts    perplexity.ai
    poe.ts           poe.com
    generic.ts       Heuristic fallback for any chat UI
  ui/
    banner.ts        Inline warning banner (warn decisions)
    modal.ts         Block modal (block decisions, must act)
    pill.ts          "N items scrubbed" status pill (auto_scrub)

tests/
  detection/         Regex correctness, NLP, overlap dedup
  adapters/          Selector + intercept tests (JSDOM)
  policy/            Decision matrix unit tests
  safety/            No-leak regressions: known PII must never reach fetch/XHR
```

## Detection layers

### Layer 1 — Regex (synchronous, ~0ms)
Covers structured PII: EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD (+ Luhn),
IBAN_CODE, SSN, IP_ADDRESS, CRYPTO, SECRET_KEY (Bearer/sk-/ghp_ prefixes).

### Layer 2 — NLP via compromise.js (~10–20ms)
Covers unstructured PII: PERSON, LOCATION, ORG.
Lexicon + capitalisation based — misses novel surnames and non-English given
names ("Jean", "Élodie"). Instant fallback when Layer 3 is unavailable.

### Layer 3 — Transformer NER via @huggingface/transformers (~150–300ms)
ONNX/WASM `Xenova/bert-base-multilingual-cased-ner-hrl`. Multilingual; reads
grammatical context (not a name list) so it catches novel surnames + non-English
names. Scores PERSON ~0.9 > compromise 0.75 → wins the overlap dedupe.

- **Where it runs:** NOT the content script (would bloat content.js ~60MB +
  block the page). Chrome/Edge MV3 → **offscreen document** (`entrypoints/offscreen/`).
  Firefox MV2 → persistent **background** page. Routing seam: `lib/detection/ner-client.ts`
  (swappable transport, no static `./ner` import) → content wires a
  `browser.runtime.sendMessage` transport → `background.ts` dispatches to
  offscreen (`NER_DETECT` → `NER_DETECT_OFFSCREEN`, two types so the broadcast
  doesn't loop).
- **No-network (invariant #3):** `configureNerEnv()` sets `allowRemoteModels=false`
  AND pins `backends.onnx.wasm.wasmPaths` — transformers otherwise fetches model
  AND the ORT WASM from a CDN. Model + WASM ship in `public/` (see below).
- **Fail-open:** load/inference errors → `[]`; L1+L2 still run. NER also no-ops
  until `configureNerEnv` is called (guards against any accidental remote load).
- **Model assets are NOT committed.** Run `bun run fetch:ner` once before
  building to populate `public/models/` (~107MB int8) + `public/wasm/`. Until
  then Layer 3 silently no-ops.
- **Bundle isolation:** MV3 background is `type: module` + the Firefox-direct
  path is gated on `import.meta.env.MANIFEST_VERSION !== 2`, so transformers is
  dead-code-eliminated from the Chrome/Edge `background.js` (~3.6KB — it only
  forwards to offscreen). The transformers + ORT runtime (~63MB, mostly
  base64-inlined WASM) lands only in: the Chrome **offscreen** chunk, and the
  **Firefox MV2 background** (which hosts the model itself).
- **Expected build warning (Firefox only):** `[EMPTY_IMPORT_META] import.meta …
  iife`. transformers' `import.meta.url` self-location is neutered in the MV2
  iife background — harmless because `configureNerEnv` overrides both
  `localModelPath` and `wasmPaths`, so that resolution path is never used.
- **Tests:** `lib/detection/ner.ts` exposes `__setNerRunner()` to inject a fake
  runner — unit tests never load the real model (`tests/detection/ner.test.ts`).

## Policy (default)

```
Entity risk tier    strict mode     permissive mode
HIGH (email/card)   block           auto_scrub
MEDIUM (names)      auto_scrub      warn
LOW (DOB)           warn            notify
NONE                allow           allow
```

High-risk entities: EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD, IBAN_CODE,
SSN, IP_ADDRESS, CRYPTO, SECRET_KEY.

## Token format

`<ENTITY_TYPE_N>` — e.g. `<EMAIL_ADDRESS_1>`, `<PERSON_2>`.
Identical to pii-airlock Python format. BrowserMapping holds token↔value in
memory only, cleared on page unload. Never written to chrome.storage.

## Key invariants (never break these)

1. **Fail-closed**: if detection throws, send is BLOCKED in strict mode, never silently allowed.
2. **No raw PII in storage**: BrowserMapping is memory-only. chrome.storage holds settings only.
3. **No network calls**: extension never sends text to any remote service (only to localhost if pii-airlock enhanced mode is explicitly enabled by user).
4. **Adapters are fragile**: provider UI changes break selectors. MutationObserver re-attaches on DOM changes. Adapter version strings must be bumped on selector updates.

## Commands

```bash
bun run dev          # Chrome dev mode with HMR
bun run dev:firefox  # Firefox dev mode
bun run dev:edge     # Edge dev mode
bun run build        # Chrome production build → .output/chrome-mv3/
bun run build:firefox  # → .output/firefox-mv2/
bun run build:edge     # → .output/edge-mv3/
bun run build:all      # Chrome + Firefox + Edge
bun run zip          # Package Chrome for store submission
bun run zip:firefox  # Package Firefox (AMO)
bun run zip:edge     # Package Edge (Edge Add-ons)
bun run zip:all      # Package all three
bun run fetch:ner    # Download NER model + WASM into public/ (run once, ~107MB)
bun test             # Run test suite (bun built-in runner)
bun run compile      # tsc --noEmit type check
```

## Adding a new AI chat site

1. Create `lib/adapters/<sitename>.ts` implementing `ChatAdapter`.
2. Add `host_permissions` entry in `wxt.config.ts` manifest.
3. Add `matches` entry in content script definition.
4. Register adapter in `lib/adapters/index.ts`.
5. Add frozen HTML snapshot + tests in `tests/adapters/<sitename>.test.ts`.

## Open questions / decisions already made

| Question | Decision |
|---|---|
| UI framework | React 19 (already installed) |
| Test runner | bun test. DOM-level tests (`tests/adapters/`) use `happy-dom` via `@happy-dom/global-registrator`. |
| DOM emulator caveat | happy-dom AND jsdom both mis-model **at-target listener order** (they fire capture-before-bubble on the target; real browsers fire in *registration order*). This is the exact quirk behind the claude.ai keydown leak, so it CANNOT be regression-tested in an emulator — that test would pass on the broken code. Such tests belong in a real-browser harness (Playwright). happy-dom also has no `execCommand`, so `replaceContentEditable`'s native path is untestable there. |
| Options storage | browser.storage.sync (no raw PII stored) |
| Restore tokens in AI response | Off by default for MVP |
| Detection language | navigator.language → fallback en |
