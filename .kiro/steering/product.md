---
inclusion: always
---

# Product

Lab Switch is a local A/B lab for Claude Code. It runs two real Claude Code terminals side by side on one web page and sends the same prompt to both, so a developer can measure what a mod, skill, hook, MCP server or agent definition actually changes.

## Users

- Developers who build Claude Code extensions and need evidence that an extension helps before shipping it.
- Teams comparing models, Code Mode or permission modes on the same task.

## Core value

- Same prompt, same project, two isolated sessions: the only difference is the item under test.
- Side-by-side numbers from Claude's native transcripts: effective mode, model, time, fresh input, cache read and created, output tokens, requests, tool calls and tool errors.
- Live previews of what each side built, with a label that says which terminal is serving the page, plus screenshots saved with every round.
- A local history of rounds that can be reopened and compared later.

## Principles

- Real sessions, not simulations. Both sides run the actual `claude` binary.
- Isolation by default: separate HOME, CLAUDE_CONFIG_DIR and project copy per side.
- Secrets never reach files or the browser. Login tokens go only to the Claude processes.
- Loopback only unless the user opts into `--listen`, which then requires a token cookie.
