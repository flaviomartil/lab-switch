# Implementation plan

- [x] 1. Server and lanes
  - [x] 1.1 HTTP server serving `public/` and a WebSocket upgrade with origin checks
  - [x] 1.2 Spawn two `node-pty` lanes with isolated HOME, CLAUDE_CONFIG_DIR and project copies
  - [x] 1.3 Headless xterm mirror per lane to detect prompt readiness
  - _Requirements: 1.1, 1.5, 6.1_

- [x] 2. Item loading
  - [x] 2.1 Support `mod`, `skill`, `hook`, `mcp` and `agent` kinds on the experimental side only
  - [x] 2.2 Bundle Codeflow as the default item, with passive and active modes
  - _Requirements: 1.2_

- [x] 3. Shared prompt
  - [x] 3.1 Wait for both editors, then send single and multi-line prompts to both lanes
  - [x] 3.2 Block input and stop while sending or transitioning
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Telemetry and rounds
  - [x] 4.1 `ClaudeJournal` incremental transcript reader
  - [x] 4.2 `turnSummary` with unknown values for partial usage
  - [x] 4.3 Rounds panel and Comparison tab with per-side metrics and deltas
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. Preview and screenshots
  - [x] 5.1 Detect local URLs in terminal output, including ANSI-colored vite output
  - [x] 5.2 Port ownership labels via `ss`/`/proc` or `lsof`
  - [x] 5.3 Headless browser screenshots at the end of each round
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 6. History
  - [x] 6.1 Atomic JSON store with private modes and a 100-round list
  - [x] 6.2 Reopen old rounds with saved screenshots
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 7. Login, git and network access
  - [x] 7.1 Reuse the host Claude login, re-read on New pair
  - [x] 7.2 Pass host git config and credentials to both sides
  - [x] 7.3 `--listen` with token cookie gate and preview proxies
  - _Requirements: 6.2, 6.3, 6.4, 6.5_

- [x] 8. Tests
  - [x] 8.1 Deterministic PTY fixture and fake browser
  - [x] 8.2 End-to-end suite over WebSocket
  - _Requirements: all_

- [x] 9. English localization of UI, docs and tests

- [ ] 10. Hackathon submission (Kiroween 2026)
  - [ ] 10.1 Demo video script and recording (under 3 minutes, shows a full round end to end)
  - [ ] 10.2 README polish for judges (quickstart, screenshots, what to compare first)
  - [ ] 10.3 Kiro usage write-up for the Devpost submission
  - [x] 10.4 Add an open-source license file (Devpost requires a detectable license on the repo)
