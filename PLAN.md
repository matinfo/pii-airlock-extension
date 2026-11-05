# pii-airlock-extension: review and step-by-step guidance

## Context

pii-airlock (Python) is stabilised. The extension now has to be strong, usable, less intrusive, more capable and up to date. Current state: `main`, version `0.0.0`, 133 tests pass, `tsc` clean, 543 lines plus the whole NER/offscreen layer uncommitted, no CI, no LICENSE, never run in an automated real browser.

**Verdict: good skeleton, not shippable.** Tests are green because they test units with fakes. In real use the extension leaks on several send paths, blocks ordinary sentences, ships 178 MB of model that detects nothing, and leaves tokens in replies.

Decisions taken:
- **Default UX:** quiet scrub + chip.
- **NER:** opt-in download.
- **Restore:** real values shown on page.

**Evidence labels:** [ran] = reproduced by running code. [read] = clear from source, not executed. [verify] = needs a real browser or external check.

---

## Review findings

### A. Leaks and false safety (critical)

| # | Finding | Where | Evidence |
|---|---|---|---|
| A1 | Fail-closed bypass: engine error returns `block` with `detections: []`; clicking "Auto-scrub & send" scrubs nothing, passes the leak check and **sends raw text** | `engine.ts` catch + `intercept.ts` `block` case + `doScrubAndSend` | [read] |
| A2 | Ctrl/Cmd+Enter ignored by interceptor, so it **sends raw** on sites where it submits | `intercept.ts` `handleKeydown` | [read] |
| A3 | Edit-previous-message boxes, form `submit` events and suggested prompts are not intercepted | `intercept.ts` | [read], sites [verify] |
| A4 | Interceptor is bound to one composer. Observer debounce restarts on every mutation, so during a streaming reply a remounted composer can stay unprotected and Enter passes raw | `content.ts` observer | [read] |
| A5 | Broken selectors fail silently: no composer means no protection, while popup still says "Active" | `content.ts`, `popup/App.tsx` | [read] |
| A6 | `notify` pill says "N items scrubbed" although raw text was sent | `intercept.ts`, `showPill` | [read] |
| A7 | Paste banner applies offsets from pasted text to whole composer: wrong splice, PII remains. "Drop" is documented but no handler exists | `handlePaste` | [read] |
| A8 | Double send: no in-flight guard during `await analyze`. Stale text: text typed while a dialog is open is overwritten by the old snapshot | `evaluate` | [read] |
| A9 | IME: Enter confirming CJK composition triggers send (no `isComposing` check) | `handleKeydown` | [read] |
| A10 | Secondary dialog: `showModal` stacks on repeat Enter. In the "scrub failed" modal, the scrub button does nothing | `components.ts`, `doScrubAndSend` | [read] |
| A11 | Per-entity overrides not honoured: one email makes an `allow`-listed ORG get scrubbed too | `doScrubAndSend` scrubs all | [read] |
| A12 | Overbroad send-button selectors (`[aria-label*="Send" i]`, `button[type=submit]`, document-wide) can pick the wrong button, so a click on the real one passes raw | copilot, perplexity adapters | [read] |

### B. Layer 3 NER is dead

| # | Finding | Evidence |
|---|---|---|
| B1 | Real transformers output is `{entity:'B-PER', score, index, word}`. Code reads `entity_group/start/end`, so **every entity is dropped**. The `aggregation_strategy` option is not honoured (the `@ts-expect-error` hid this). Test passes only because it injects a fake runner shaped like the wrong API | [ran] with real model |
| B2 | `public/wasm/` has no `.wasm` binary, only `.mjs`, so `wasmPaths` should fail in browser, then fail open silently | file listing [ran], browser [verify] |
| B3 | Firefox MV2 manifest has no `wasm-unsafe-eval` CSP | manifest [ran], effect [verify] |
| B4 | No chunking: truncation past the token limit makes NER blind on long text | [verify] |
| B5 | No timeout on the send path: cold start delays Enter with no feedback | [read] |
| B6 | Docs say 107 MB and 63 MB of inlined runtime; actual model is 178 MB, runtime chunk 516 KB | [ran] |

### C. Detection accuracy (default strict) [ran]

| Input | Result | Problem |
|---|---|---|
| `What is the capital of France?` | auto-scrub LOCATION | message destroyed |
| `Meeting at 12:30:45 tomorrow` | **block** IP_ADDRESS | IPv6 regex matches times |
| `version 1.2.3.4` | **block** IP_ADDRESS | versions |
| `the token limit of the API`, `secret santa` | **block** SECRET_KEY | keyword + any word |
| `Order number 1234567890` | **block** PHONE | any 10 digits |
| `AB12 THIS IS SOME UPPER CASE TEXT` | **block** IBAN | no mod-97 |
| `Compare ... Google ... Microsoft` | auto-scrub ORG | tech talk rewritten |
| `Jean Dupont` | ORG | wrong type |
| `sk-ant-…`, `sk-proj-…`, `AKIA…` | **missed** | secrets |
| `079 123 45 67`, AVS `756.1234.5678.97` | **missed** | Swiss, exists in Python |
| `call me on 06 12 34 56 78` (English sentence) | **missed** | phone format picked by text language |

Also [read]: `gb` phone pattern is unreachable (franc returns `en`); `text.indexOf(term)` matches inside words, so a short name can corrupt other words.

### D. UX and intrusiveness

- No way to see values, reject a false positive, or allow a value. Modal has no "send anyway", Esc, focus handling or dark theme.
- **Protection cannot be paused**: `active` in popup is hard-coded true. No per-site off switch.
- Raw labels (`EMAIL_ADDRESS`). Popup text contradicts policy ("allows names" vs `warn`; "session" vs "all sessions").
- Enter gives no feedback while analysing.

### E. Coverage and correctness of claims

- **Wrong hosts** [ran]: `*://perplexity.ai/*` skips `www.perplexity.ai`; `*://mistral.ai/*` skips `chat.mistral.ai`; `huggingface.co/*` runs on the whole site. Live hosts [verify].
- Host lists exist in 4 places (`wxt.config.ts`, `content.ts`, `adapters/index.ts`, popup `AI_SITES`). Popup shows 4 supported sites as "Not an AI chat site".
- **"Any other AI site" fallback is false**: `genericAdapter` can never run off the match list. 10 adapters are ~50 lines of near-copy.
- No Grok, DeepSeek, AI Studio, Meta AI, M365 Copilot.
- `restore()` never called. Mapping is cleared on composer remount, so `<PERSON_1>` can mean two people in one chat.
- Docs claim token format "identical" to Python; Python now also has stable `<PERSON_482913>`.

### F. Lifecycle, permissions, project health

- **`onInstalled` resets settings on every update** and on browser update [read].
- `tabs` permission is not needed for the popup's use and triggers a scary store warning; README says only `storage`.
- `scrubCount` in `storage.sync`: pointless sync, racy get+set, options page overwrites it from stale state.
- **`public/models/` and `public/wasm/` are not gitignored**: `git add .` would commit 178 MB.
- No `gecko.id` / `data_collection_permissions` for AMO [verify current rule]. No LICENSE, privacy policy or CI. Scaffold leftovers (`react.svg`, `wxt.svg`).
- Docs drift: README `pii-airlock serve` (real command is `proxy`); "enhanced mode" not implemented, and the proxy has no detect endpoint; `CLAUDE.md` lists non-existent `ui/banner.ts` etc.
- Deps: patch/minor available (transformers 4.3.2, compromise 14.19, react 19.3, wxt 0.20.27). Handle wxt 0.21 separately, skip TypeScript 7 for now.

---

## Step-by-step plan

One commit per logical step, bugs first. Each phase is independently shippable. **S** < half day, **M** ~1 day, **L** 2+ days.

### Phase 0: Safe baseline (S)
1. Branch from `main`. Add `public/models/`, `public/wasm/` to `.gitignore`. Commit WIP in logical commits (adapter `dom.ts` fix, NER layer, tests). Check diff first.
2. CI: `tsc`, `bun test`, `wxt build` (chrome + firefox), **size budget** (fails if package > 5 MB after Phase 3).
3. Playwright harness loading the built extension against **local fixture pages** using real ProseMirror and textarea composers. `CLAUDE.md` already records that emulators cannot test listener order, so leak regressions must live here.
4. Patch/minor dep bumps, delete scaffold files.

**Done when:** CI green; one Playwright test proves Enter is intercepted before ProseMirror.

### Phase 1: Close leaks (M), findings A + lifecycle
1. **Replace bound interceptor with stateless event-time guard** in `lib/intercept.ts`: one document capture listener for keydown, click and submit that resolves composer and button from the event (`composedPath()`), so remounts cannot create gaps. Removes `_piiAttached` and most observer logic in `content.ts`.
2. Handle Ctrl/Cmd+Enter; skip when `e.isComposing`; in-flight guard; re-read composer before scrub and re-analyse if text changed.
3. Adapters: scope send button to composer's form/container; treat edit-message boxes as composers.
4. Fail-closed for real: on engine error, no scrub button; only "Edit" or an explicit, labelled "Send unscanned".
5. Scrub only entities whose decision requires it (A11). Tighten post-check to word-aware match. Honest `notify` wording.
6. Health signal: composer not found on a known site → toolbar badge + popup "Not protected here".
7. `onInstalled`: defaults only when `reason === 'install'`, without clobbering. `scrubCount` → `storage.local`. Remove `tabs` [verify `tab.url` works through host permissions].

Reuse: `replaceContentEditable` (`lib/adapters/dom.ts`), existing post-condition check.

**Done when:** a Playwright test exists for every A-row path; raw PII never reaches a fixture's fake send endpoint.

### Phase 2: Detection accuracy (M), findings C
1. **Evaluation corpus first:** `tests/fixtures/corpus.ts` with the table above as seed (benign prose, code, EN/FR/DE/IT, Swiss cases), plus a test gate on precision and recall. Every later change is measured.
2. Port rules and validators from Python `pii_scrub/recognizers.py` as one rule table: real secret formats (AKIA, `sk-ant/proj`, `github_pat_`, `xox`, `AIza`, Stripe, PEM, JWT, URL passwords), IBAN mod-97, AVS EAN-13, FR NIR, SIRET, DE tax, IT VAT.
3. Remove keyword-plus-any-word secret; require assignment shape and value entropy.
4. IPv6: proper parser, reject times. IPv4: skip when preceded by `version`/`v`; lower tier for private ranges.
5. Phones: replace language routing with `libphonenumber-js` (`findPhoneNumbersInText`, regions from `navigator.languages` + CH/FR/DE); bare digit runs need phone context. Check bundle cost.
6. NLP: word-boundary matching. `LOCATION`/`ORG` from compromise never trigger scrubbing, notify only.
7. Regex stays synchronous and always on.

**Done when:** all seed false positives pass with no action, all seed misses caught, precision/recall gate in CI.

### Phase 3: Repair NER, opt-in download (M/L), findings B
1. Fix adapter in `lib/detection/ner.ts`: merge BIO tokens and `##` pieces, align to text with a cursor for offsets. Add a test built from **captured real model output**, replacing the wrong-shape fake.
2. Sliding-window chunking with offset remap.
3. Copy `ort-wasm-*.wasm` from `onnxruntime-web` in `scripts/fetch-ner-assets.ts`, and fail the build if missing. Package the runtime, never the model. Firefox CSP.
4. Opt-in in Options: "Better name detection (178 MB)". Download from a **pinned HF revision with SHA-256 check** into Cache API/OPFS; progress, remove, size display. No request until user clicks. Reword invariant #3: "your text never leaves; only the model file is fetched, once, by choice". Add the host permission as optional, or use a permitted fetch [verify store rules for data vs code].
5. Time budget on send (~400 ms): regex + compromise always decide; NER result is merged if ready. Warm model on composer focus, not page load. Chip shows if names model was skipped.
6. Keep `__setNerRunner`, `configureNerEnv`. Fix figures in docs.

**Done when:** in real Chrome and Firefox `Jean Dupont-Lachapelle` becomes PERSON with correct offsets; base package ≤ 5 MB; network log shows no request before opt-in.

### Phase 4: Quiet UX (L), findings D
Replace `lib/ui/components.ts` banner/modal flow:
1. **Chip** docked near composer: shield + count, updated on debounced input (regex + compromise), also covers paste and drop. Replaces paste banner.
2. **Review panel** on chip click: real values (local, closed shadow DOM, `textContent` only), friendly labels, tick/untick, "Always allow", "Always scrub".
3. **Modes:**
   - **Auto** (default): scrubs high-confidence structured data + NER PERSON. Location/org notify only.
   - **Review:** panel opens before send.
   - **Off**, plus **per-site toggle** and **pause 1 h**.
   Replaces strict/permissive in `lib/policy.ts`; keep per-entity overrides, simplified.
4. Toast after send: "3 items scrubbed · Review". **Note: a sent message cannot be undone.** The real "undo" is pre-send unticking in the panel; the toast offers "Don't scrub this next time".
5. Modal stays only for real failures (scrub not committed, engine error), with keyboard, Esc and focus handling.
6. Allow/deny lists in `storage.local` (user-entered, may be sensitive), never `sync`. Reword invariant #2. Panic clear wipes them on request.
7. Popup rebuilt: real status per site, on/off, mode, panic clear. Dark mode. i18n `_locales` en, fr, de. Keyboard and ARIA.

**Done when:** seed sentences show no interruption; a real email is scrubbed with one toast and no click.

### Phase 5: Restore on page (M/L), findings E
1. **Spike first (S):** on ChatGPT, Claude, Gemini and Mistral, check that markdown renderers do not eat `<PERSON_1>` as HTML. Python's `ANY_TOKEN_RE` shows echoed tokens get escaped. Decide final token shape from this before writing code.
2. Stable tokens: HMAC with random session key (see `pii_scrub/token_key.py`), same `<PERSON_482913>` shape, so remounts and tabs stay consistent. `BrowserMapping` scrub becomes async for WebCrypto.
3. Mapping in `storage.session` (memory only), accessed through background messages. Survives reload, gone on browser restart. Panic clear wipes it.
4. Add `findMessageRoots` to adapters. Observer rewrites text nodes for raw and escaped tokens, including in user bubbles, without adding wrapper elements (React and streaming re-renders). Subtle marking through CSS Custom Highlight API [verify from content script].
5. Document limits: native Copy buttons copy tokens; reopened old chats after restart show tokens.

**Done when:** on fixture + 2 live sites, a streamed reply shows real values while the fake endpoint only received tokens.

### Phase 6: Coverage (M), findings E
1. **`lib/sites.ts` single registry** (hosts, composer and send selectors, message roots), consumed by `wxt.config.ts`, `content.ts`, popup and resolver. Replace 10 adapters with `defineSiteAdapter` + overrides.
2. Correct hosts; `huggingface.co/chat/*` only; add Grok, DeepSeek, AI Studio, Meta AI, M365 Copilot [verify each host].
3. **"Protect this site" button:** `optional_host_permissions` + `scripting.registerContentScripts`, makes `genericAdapter` real and removes the false README claim.
4. Nightly Playwright smoke against live public pages where no login is needed; saved HTML snapshots otherwise, so selector breaks are found before users report them.

### Phase 7: Release (S/M)
Version sync, LICENSE, privacy policy page, store listings and permission justification, `gecko.id`, `data_collection_permissions`, Firefox MV2 vs MV3 decision, README and `CLAUDE.md` rewritten to match reality, link from pii-airlock docs. Submit Chrome first, then Edge, then Firefox. Check current store rules at submission.

### Later backlog (not in v1)
- Attachments: scan text files, warn on binaries.
- Optional MAIN-world `fetch` guard as last line of defence (fragile, needs store review check).
- Enhanced mode through local proxy: needs new `/detect` endpoint in `pii_scrub/proxy.py`. Remove from docs until built.
- Shared test corpus between Python and extension.

---

## Priority if time is short

Phases 0 → 1 → 2 give the largest gain: safe and no longer annoying. Phase 4 chip is the most visible change. Phase 3 can ship after 4, with regex + compromise only.

## Critical files

`lib/intercept.ts`, `entrypoints/content.ts`, `entrypoints/background.ts`, `lib/detection/regex.ts`, `nlp.ts`, `ner.ts`, `lib/policy.ts`, `lib/mapping.ts`, `lib/ui/components.ts`, `lib/adapters/*` → `lib/sites.ts`, `entrypoints/popup/App.tsx`, `entrypoints/options/App.tsx`, `wxt.config.ts`, `scripts/fetch-ner-assets.ts`, `.gitignore`.

## Verification

- Every phase: `bun run compile`, `bun test`, `bun run build:all`, size budget.
- Leaks: Playwright on built extension with a fake send endpoint recording request bodies. **Assert on what was sent, not on the DOM.**
- Detection: corpus precision/recall gate.
- NER: real model in real Chrome and Firefox, network log empty before opt-in.
- Manual before each release: ChatGPT, Claude, Gemini, Mistral, with fake PII, checking the browser network panel.

## Execution

Start with Phase 0 + 1 on approval, stop for review after each phase. Commit locally per step; push or open PRs only when asked.
