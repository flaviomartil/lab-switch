# Codeflow 1.1.1

Claude Code mod that measures the main turn and offers an option to reduce the output of reads and searches that reaches the context. It works in normal sessions and can run alongside the [native Code Mode](https://code.claude.com/docs/en/code-mode).

## Open a session

```bash
claude --plugin-dir ./codeflow
CLAUDE_CODEFLOW_ENABLED=1 claude --plugin-dir ./codeflow
```

The first command opens in **passive mode**, which collects telemetry. The second opens in **active mode**, which adds guidance to the prompt, reduces eligible `Read`, `Grep` and `Glob` results and flags sensitive patterns in `Bash` and `REPL`. The variable is read from the environment at startup. A missing value, an invalid value or `0` keeps passive mode.

The reduction applies to the text representation of successful results in the transcript. The response delivered to the executor stays whole. Shell output, tests, write effects and results that contain media are excluded from this reduction. If you need omitted content, repeat the read with a range or refine the search.

The guard flags operations by literal patterns and preserves existing refusals and approval requests. Use the native `ask` and `deny` rules for the operations that need control. Check the native executor code with `Ctrl+O`. [Permissions in Code Mode](https://code.claude.com/docs/en/code-mode#permission-checks)

## Commands

| Command | Result |
| --- | --- |
| `/codeflow` | Mode status |
| `/codeflow report` | Requests, calls, tokens, time, context and estimated cost when available |
| `/codeflow thinking` | Block and word counts for the last turn, with the `thinking` option enabled |
| `/codeflow stash <name> <text>` | Keeps text chosen in the terminal in memory for up to 30 minutes, in active mode |
| `/codeflow recall <name>` | Shows the stored value |
| `/codeflow forget <name>` | Removes the entry |

The stash accepts up to 20 entries of up to 2,000 characters each. It is cleared when the session ends or is cleared. Text typed in commands may appear in the Claude session history.

## Measurement and storage

Event counting is the same in both modes. Total input adds uncached input, cache read and cache created. The request count for requests with multiple tools uses the model step response. Reports show the duration of completed turns and the total number of turns observed. Unavailable fields appear as such.

By default, collection stays in memory. Set `CLAUDE_CODEFLOW_RUN` if you want to group sessions for a comparison. The record uses one key per session and includes only telemetry data. The report uses sessions that ended in the last 24 hours with the same experiment ID. See the [A/B procedure](docs/hybrid-ab-test.md).

The options below live in the plugin configuration.

| Option | Default |
| --- | --- |
| `maxFileLines` | 200 |
| `maxToolResultChars` | 2,000. Values below 64 use the default. |
| `maxListItems` | 20 |
| `guardPatterns` | Empty. Additional comma-separated patterns. |
| `turnSummary` | On |
| `thinking` | Off. When on, it keeps counts. |
| `sessionLog` | Off. When on, it writes a summary to `.codeflow/session-<id>.ndjson` on exit. |

## Validate the local package

```bash
claude plugin validate ./codeflow
claude plugin test ./codeflow
```

The tests use the simulated Claude Code environment. To measure a real task, use the same test project and check the result in each mode. There is an [example scenario](docs/landing-page-scenario.md).
