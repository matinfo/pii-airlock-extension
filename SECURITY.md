# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for a leak or bypass. We aim to acknowledge reports within a few days.

Of particular interest: any path where text containing PII reaches the page, the network or persistent storage unreplaced (a "leak"), and any way for a web page to read or alter the extension's state.

## Design guarantees (and where they are tested)

- **Fail-closed.** If detection errors, or the editor does not accept the replaced text, the message is not sent (`lib/intercept.ts`, `tests/safety/`, `e2e/`).
- **No page text leaves the device.** No analytics, no remote detection service. The only network request is the opt-in, SHA-256 verified download of the names model from a pinned Hugging Face revision (`lib/ner-manifest.ts`, `lib/ner-model.ts`). Inside the model pipeline, network access is disabled.
- **No raw PII on disk.** Placeholder mappings live in memory and a RAM-only `storage.session` copy per tab. Your own allow/deny lists stay in `storage.local`, never synced.
- **Minimal permissions.** `storage`, `offscreen` (Chrome/Edge, to host the names model) and the host patterns of the supported chat sites. No `<all_urls>`.

## Known limits

See "Known limits" in the README. Notably: restoring real values in the chat's answers is display only but happens in the page's DOM, and detection reduces risk without guaranteeing full recall.
