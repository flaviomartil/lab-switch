# Requirements

## Introduction

Lab Switch lets a developer run the same prompt in two isolated Claude Code sessions, one with an item under test and one without, and compare the results with real numbers and previews.

## Requirement 1: Paired isolated sessions

**User story:** As an extension developer, I want two Claude Code sessions that differ only by the item under test, so that any difference I see comes from that item.

### Acceptance criteria

1. WHEN the server starts THEN the system SHALL spawn two Claude processes, each with its own HOME, CLAUDE_CONFIG_DIR and copy of the project.
2. WHEN `--kind` is `mod`, `skill`, `hook`, `mcp` or `agent` THEN the system SHALL load the item only on the experimental side.
3. WHEN the user clicks New pair THEN the system SHALL create fresh project copies and restart both processes.
4. WHEN the server stops with Ctrl+C THEN the system SHALL delete the lab profiles.
5. WHEN a profile is created THEN the system SHALL preset theme, onboarding and project trust so the terminal opens at the prompt.

## Requirement 2: Shared prompt

**User story:** As a developer, I want to type one prompt and send it to both sides at the same time.

### Acceptance criteria

1. WHEN the user sends from the shared field THEN the system SHALL wait until both prompt editors are ready and deliver the text to both.
2. WHEN the text has multiple lines THEN the system SHALL deliver it as a single prompt on each side.
3. WHILE a send or transition is in progress THE system SHALL reject terminal input and stop requests.
4. The system SHALL still accept keyboard input and confirmations in each terminal individually.

## Requirement 3: Round metrics

**User story:** As a developer, I want each shared send recorded as a round with comparable metrics.

### Acceptance criteria

1. WHEN a shared send happens THEN the system SHALL create a round and select it live in the Rounds panel.
2. The system SHALL read metrics from each side's native transcript: effective mode, model, duration, fresh input, cache read, cache created, output tokens, requests, tool calls and tool errors.
3. IF a metric is missing for any request in a turn THEN the system SHALL report it as unknown instead of a partial sum.
4. The Comparison tab SHALL show the prompt, both sides' metrics, the difference between them and both visible answers.

## Requirement 4: Preview and screenshots

**User story:** As a developer, I want to see what each side built without leaving the lab.

### Acceptance criteria

1. WHEN a terminal prints a local URL with a port THEN the system SHALL show it in the Preview tab next to the other side's page.
2. The system SHALL label each preview as served by this terminal, served by the other terminal, or port owned by another process.
3. WHEN both sides finish a round THEN the system SHALL capture a screenshot of each preview with a headless browser and store it with the round.
4. IF no compatible browser is found THEN the system SHALL save the round without screenshots.

## Requirement 5: History

**User story:** As a developer, I want to reopen past rounds.

### Acceptance criteria

1. The system SHALL store rounds as JSON in the platform state directory or in `--history-dir`, with private file modes.
2. WHEN the user opens an older round THEN the system SHALL show its saved screenshots instead of reopening live pages.
3. The system SHALL list at most the 100 most recent rounds.

## Requirement 6: Security and network access

**User story:** As a developer, I want to run the lab on another machine without exposing a shell with permission bypass.

### Acceptance criteria

1. WHEN `--listen` is not set THEN the system SHALL accept only loopback connections from the expected local origin.
2. WHEN `--listen` is set THEN the system SHALL require a token, exchange it for an `HttpOnly` cookie and answer 401 without it.
3. The preview proxies SHALL accept only addresses that already signed in with the token.
4. The system SHALL pass the host Claude login token only to the Claude processes, never to files or the browser.
5. The system SHALL pass the host git configuration and credentials to both sides.
