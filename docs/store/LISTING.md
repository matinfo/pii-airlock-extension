# Store listing copy (Chrome Web Store + Firefox AMO)

Source of truth for what we paste into the dashboards. Keep it consistent with
README.md and PRIVACY.md. Never claim more than the code does.

Privacy policy URL: https://github.com/matinfo/pii-airlock-extension/blob/main/PRIVACY.md
Support URL: https://github.com/matinfo/pii-airlock-extension/issues
Homepage: https://github.com/matinfo/pii-airlock-extension
Category: Chrome "Productivity" (or "Privacy & Security" if offered) / AMO "Privacy & Security"
License (AMO): MIT

## Name
PII Airlock

## Summary (<= 132 chars for Chrome, <= 250 for AMO)
Replaces personal data in your AI chat messages with placeholders before they are sent. On-device, no account, no server.

## Description
<!-- Chrome rejected a version that listed product names (keyword spam, ref Yellow Argon). Do not list brand names in the store description; they live in README.md and the host-permission justification. -->
PII Airlock checks what you type in an AI chat and replaces personal data with placeholders before the message is sent. Everything runs in your browser. There is no account, no server and no analytics.

How it works
- Type or paste a message. A small chip near the message box shows how many items will be replaced.
- Press Enter or the send button. Emails, phone numbers, card numbers, IBANs, national IDs, IP addresses, crypto addresses, secrets and names are replaced with placeholders such as <EMAIL_ADDRESS_1>.
- The chat's answer is shown with your real values put back, for display only.
- If the check fails for any reason, the message is not sent. You can edit it or explicitly send it unchecked.

Works on
The most popular AI chat websites. The full list of supported sites is kept up to date on the project page (see Homepage link). No other site is touched.

Modes
- Auto (default): replaces sensitive data silently.
- Review: shows what will be replaced before sending.
- Off, per-site off, and a 1 hour pause.
- Allow and deny lists, and per-type overrides.

Optional better name detection
Turn it on in Settings to download an on-device model (about 181 MB, once, from a pinned Hugging Face version, checksum verified). It is multilingual and catches unusual surnames. Your text is never part of that download.

Privacy
- Your text never leaves your device.
- Placeholder mappings live in memory for the tab, never on disk.
- Permissions are limited to storage and the supported chat sites.

Limits
Detection reduces risk but cannot guarantee that everything is found. File attachments, voice input and screenshots are not covered.

Interface languages: English, French, German, Spanish, Italian.

## Chrome: single purpose
Detect personal data in messages typed into supported AI chat sites and replace it with placeholders before the message is sent.

## Chrome: permission justifications
- storage: keeps the user's settings, allow/deny lists and the per-tab placeholder mapping (session storage, RAM only).
- offscreen: hosts the optional on-device names model in an offscreen document so it never runs in the page or blocks it.
- Host permissions (chatgpt.com, chat.openai.com, claude.ai, gemini.google.com, copilot.microsoft.com, copilot.cloud.microsoft, *.perplexity.ai, *.mistral.ai): required to read the message box and replace personal data before the site receives it. No other sites, no <all_urls>.
- wasm-unsafe-eval (CSP): lets the packaged ONNX Runtime WebAssembly file compile. No remote code, no unsafe-eval.
- Remote code: none. All code is in the package. The only network request is the opt-in, checksum-verified model download (data file, not code).

## Chrome: data usage form
Collects nothing. Tick: no data sold, no data used outside the single purpose, no data used for creditworthiness. If a category list is mandatory, the extension handles "personal communications" locally only and transmits none of it.

## Firefox: reviewer notes
Build from source (output is byte-identical to the submitted package):
  bun 1.3.14 (pinned in package.json)
  bun install --frozen-lockfile
  bun run zip:firefox
Notes:
- public/wasm/ort-wasm-simd-threaded.{mjs,wasm} are copied unmodified from the pinned onnxruntime-web npm package by scripts/fetch-ner-assets.ts during the build.
- The names model is never packaged. It is an opt-in download from a pinned huggingface.co revision, SHA-256 verified (lib/ner-manifest.ts), stored in the Cache API. User text is never sent anywhere.
- data_collection_permissions is "none": the extension collects and transmits no user data.
- The background page embeds a hidden iframe (offscreen.html) to host the optional model, because MV2 has no offscreen API.
- Expected build warning: [EMPTY_IMPORT_META] from transformers' import.meta.url, neutralised by configureNerEnv.
