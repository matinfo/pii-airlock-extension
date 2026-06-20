# PII Airlock Extension

A standalone browser extension that automatically detects and scrubs personally identifiable information (PII) from AI chat inputs — before you accidentally send it.

Works on **Claude, ChatGPT, Gemini, Copilot, Perplexity, Poe, and more.**  
Zero setup. Install and it just works.

---

## What it does

1. You type a message in any AI chat
2. When you press Send (or Enter), the extension intercepts it
3. PII is detected using a two-layer engine (regex + NLP)
4. Based on your policy, it either:
   - **Blocks** and asks you what to do
   - **Auto-scrubs** PII and replaces it with tokens like `<EMAIL_ADDRESS_1>`
   - **Warns** you with a banner you can dismiss
   - **Notifies** you passively (green pill)
5. The scrubbed message is sent; your raw values stay only in memory

---

## Detected PII

| Type | Example |
|---|---|
| Email address | `alice@corp.com` |
| Phone number | `+1 555 867-5309`, `+33 6 12 34 56 78` |
| Credit/debit card | `4111 1111 1111 1111` (Luhn validated) |
| IBAN | `FR76 3000 6000 0112 3456 7890 189` |
| US SSN | `123-45-6789` |
| IP address | `192.168.1.1`, `2001:db8::1` |
| Crypto address | `0x742d35Cc...`, `1A1zP1eP5...` |
| Secret keys/tokens | `Bearer eyJ...`, `sk-...`, `ghp_...`, `password: ...` |
| Person name | `Alice Johnson` (NLP, English) |
| Location | `San Francisco, CA` (NLP, English) |
| Organisation | `Acme Corp` (NLP, English) |
| Date of birth | `DOB: 01/15/1985` (contextual only) |

---

## Supported AI chat sites

- chatgpt.com / chat.openai.com
- claude.ai
- gemini.google.com
- copilot.microsoft.com
- perplexity.ai
- poe.com
- character.ai
- mistral.ai
- huggingface.co/chat
- you.com
- Any other AI chat site (heuristic fallback)

---

## Detection mode

| Mode | High-risk PII | Medium (names/places) | Low |
|---|---|---|---|
| **Strict** (default) | Block | Auto-scrub | Warn |
| **Permissive** | Auto-scrub | Warn | Notify |

Switch modes in the popup or configure per-entity overrides in Options.

---

## Privacy guarantees

- **No data leaves your browser.** Detection runs 100% locally in JS.
- **No network requests.** The extension makes zero outbound calls.
- **No persistent storage of raw PII.** Token mappings live in JS memory only and are cleared when you close the tab.
- **Minimal permissions.** Only `storage` and the AI chat site host patterns. No `<all_urls>`.

---

## Development

```bash
# Install dependencies
bun install

# Dev mode (Chrome)
bun run dev

# Build for production
bun run build

# Build for Firefox
bun run build:firefox

# Type-check
bun run compile

# Tests
bun run test

# Package for store submission
bun run zip
```

### Architecture

```
lib/
  detection/
    types.ts      — shared Detection, RiskTier, Decision types
    regex.ts      — Layer 1: structured PII patterns + Luhn
    nlp.ts        — Layer 2: compromise.js (names, places, orgs)
    lang.ts       — franc-min language detection
    engine.ts     — combines L1+L2, deduplicates spans
  adapters/
    chatgpt.ts    — ChatGPT / OpenAI
    claude.ts     — claude.ai (ProseMirror)
    gemini.ts     — gemini.google.com (Quill)
    copilot.ts    — copilot.microsoft.com
    perplexity.ts — perplexity.ai
    generic.ts    — heuristic fallback for any site
    index.ts      — resolveAdapter() registry
  mapping.ts      — BrowserMapping: tokenFor / restore / scrub / clear
  policy.ts       — risk tiers, decision matrix, per-entity overrides
  intercept.ts    — SendInterceptor: keydown/click/paste pipeline
  ui/
    components.ts — shadow DOM banner, modal, pill

entrypoints/
  content.ts      — main content script (all AI chat sites)
  background.ts   — service worker: settings init, tab cleanup
  popup/          — status UI, mode toggle, panic clear
  options/        — full settings: per-entity policy, mode

tests/
  detection/regex.test.ts   — all entity types (true/false positives)
  mapping.test.ts           — tokenFor, restore, scrub, clear, round-trip
  policy.test.ts            — risk tiers, decision matrix, overrides
  safety/no-leak.test.ts    — PII must never appear in scrubbed output
```

### Key invariants

- **Fail-closed:** if detection throws, send is blocked in strict mode — never silently passed through.
- **No raw PII in storage:** `browser.storage.sync` holds only settings (mode, overrides). Never raw values.
- **Shadow DOM UI:** injected banner/modal/pill use `attachShadow({ mode: 'closed' })` — page CSS cannot bleed in.
- **Token format:** `<ENTITY_TYPE_N>` — compatible with [pii-airlock](../pii-airlock/) Python proxy if you run it locally.

---

## Known limitations

- NLP (names/places/orgs) is English-only (compromise.js)
- File attachments, voice input, and screenshots are not covered
- Streaming AI responses: token restore is off by default
- Statistical NLP cannot guarantee 100% recall; the extension reduces risk, not eliminates it

---

## Optional: Enhanced mode with pii-airlock

If you also run the [pii-airlock proxy](../pii-airlock/) locally (`pii-airlock serve`), the extension can detect its healthcheck at `http://127.0.0.1:8745/healthz` and route detection through Presidio + spaCy for higher recall. Normal users never see this — the bundled JS engine is the default.
