# Privacy policy

*PII Airlock Extension, version 0.2.0*

**Short version: the extension does not collect, transmit or sell your data. Your messages are checked on your device and never sent to us or to any third party by the extension.**

## What the extension does with your text

When you send a message on a supported AI chat site, the extension reads the text in the message box, finds personal data (emails, phone numbers, names, card numbers and so on) and replaces it with placeholders such as `<EMAIL_ADDRESS_1>` before the site receives it. All of this happens locally in your browser. There is no server, account, analytics or tracking.

## What is stored, and where

| Data | Where | Notes |
|---|---|---|
| Placeholder to real-value mapping | Memory, plus a per-tab copy in the browser's session storage | Used to show your real values in the chat's answers. RAM only: removed when the tab or the browser closes. Never written to disk or synced. |
| Settings (mode, per-kind overrides, sites switched off) | Browser sync storage | Synced by your browser through your own browser account (Google, Microsoft or Mozilla), under that provider's privacy policy. Contains settings and site host names only, never message text. |
| Your "Never replace" and "Always replace" lists, the replaced-items counter, pause time | Local storage on this device | Never synced. "Clear session data" in the popup deletes them. |
| The optional names model | Browser cache on this device | Only if you turn on "Better name detection". Removable from Settings. |

## The one network request

If you turn on **Better name detection**, the extension downloads a language model file (about 181 MB) once from `huggingface.co`, from a fixed, pinned version, and verifies its checksum before using it. This request contains no text from you. Like any download, Hugging Face can see your IP address and that the file was requested; see their privacy policy. If you never turn the option on, the extension makes no network requests of its own.

## Permissions

- **Access to the supported chat sites** (ChatGPT, Claude, Gemini, Copilot, Perplexity, Mistral): needed to read the message box and replace data before sending. No other sites.
- **storage**: to keep your settings and lists.
- **scripting** (Chrome and Edge): to start protection in chat tabs that were already open when the extension was installed or updated, so you do not have to reload them. It only injects the extension's own packaged script into the supported sites above.
- **offscreen** (Chrome and Edge): to run the optional names model off the page.

## Limits you should know

- Detection reduces risk but cannot guarantee that every piece of personal data is found.
- Real values shown in the chat's answers are display only, but they appear in the page, so the chat site's own scripts could read them there. The message that was sent contained only placeholders.

## Children, changes, contact

The extension is not directed at children and collects nothing from anyone. If this policy changes, the change will be listed in this file and in the release notes. Questions or concerns: open an issue on this repository. For security problems, see [SECURITY.md](SECURITY.md).
