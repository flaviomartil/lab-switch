---
inclusion: always
---

# Structure

```
lab-switch.mjs        HTTP and WebSocket server, lane lifecycle, shared send, rounds
lib/config.mjs        CLI flags, item kinds, profile and project copy setup, host git environment
lib/auth.mjs          Reads the host Claude login (credentials file, Keychain, env vars)
lib/telemetry.mjs     ClaudeJournal: incremental transcript reader and per-turn summary
lib/history.mjs       Atomic JSON store for rounds and screenshot paths
lib/snapshot.mjs      Headless browser discovery and page capture
lib/remote.mjs        Token loading, cookie gate and preview proxies for --listen
public/               Single-page UI: terminals, shared prompt, Rounds, Comparison, Preview
sample/               Sample routine used in demos
test/                 node:test suite, PTY fixture and fake browser
vendor/codeflow/      Bundled Codeflow plugin, the default item under test
.kiro/                Steering and specs
```

## Lanes

The code calls the two sides `with` (experimental, item loaded) and `without` (control). Every per-side structure is keyed by those two ids.
