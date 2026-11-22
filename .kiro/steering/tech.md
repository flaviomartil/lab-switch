---
inclusion: always
---

# Tech

- Runtime: Node.js 22 or later, ESM (`"type": "module"`), no build step.
- Server: `node:http` plus `ws` for the terminal and control WebSocket.
- Terminals: `node-pty` spawns each Claude process; `@xterm/headless` mirrors the screen on the server to detect readiness, answers and preview URLs.
- Front end: plain HTML, CSS and JavaScript in `public/`, rendered with `@xterm/xterm` and `@xterm/addon-fit`. Fonts come from `@fontsource`.
- Telemetry: parsed from each profile's `.claude/projects/**/<session>.jsonl` transcript, never from the terminal output.
- Screenshots: an installed Chrome, Chromium, Edge or Brave in headless mode, overridable with `LAB_BROWSER`.
- Port ownership: `ss` and `/proc` on Linux, `lsof` on macOS.
- Tests: `node --test test/lab.test.mjs` against a deterministic PTY fixture and a fake browser. No network or real Claude login needed.

## Commands

```bash
npm ci
npm start
npm start -- --demo
npm test
```

## Conventions

- No code comments. Names carry the intent.
- Keep dependencies minimal and pinned to exact versions.
- Write files atomically (temp file plus rename) with private modes (`0o600` files, `0o700` directories).
- All user-facing text, docs and commit messages in English.
