# Lab Switch

An A/B lab for Claude Code. Two real Claude Code terminals run side by side on one local page, each with its own isolated profile and its own copy of the project. You send the same prompt to both and compare tokens, time, model, tool calls, errors and a live preview of what each side built. The experimental side is on the left. The control side runs without the item under test.

## Run

Install the dependencies with Node.js 22 or later and start the CLI.

```bash
npm ci
npm start
```

Open http://127.0.0.1:4178. The default item is the bundled Codeflow 1.1.1. On the left it runs in passive mode and shows its telemetry. On the right, Claude runs without loading the package. The shared field sends as soon as both prompt editors are ready. Each terminal also accepts keyboard input and confirmations on its own.

Both Claude processes start with `--dangerously-skip-permissions`. Only use the Lab with projects and extensions you trust. The processes run with the privileges of the local account. The shared field sends as soon as both editors are ready, regardless of focus.

## Rounds

The **Rounds** panel sits below the prompt and lists every shared send. When you send, the new round is selected and followed live.

The **Comparison** tab shows the prompt, the metrics for each side with the difference between them, and both visible answers. Metrics come from each Claude's native transcript, including the side without Codeflow: effective mode, model, time, tokens (fresh input, cache read and created, output), requests, tool calls and tool errors. The effective mode can change during the session through Claude's shortcut.

Data lives in `~/Library/Application Support/Lab Switch/history` on macOS and in `${XDG_STATE_HOME:-~/.local/state}/lab-switch/history` on Linux. `--history-dir` points to another directory. The history stores the text of the shared field, the visible answers and the screenshots. Keep this directory private.

## Preview

When a terminal prints a local URL (`localhost`, `127.0.0.1`, `0.0.0.0` or `[::1]` with a port), the **Preview** tab opens that page next to the other terminal's page. The tab opens on its own for the first server that appears after a send. **Open** moves the page to another browser tab and **Reload** refreshes the frame.

Both terminals share the machine's ports. If both try the same port, one server fails and the Claude on that side may end up checking the other side's page. That is why each preview shows who is listening on the port, using `ss` and `/proc` on Linux or `lsof` on macOS:

| Label | Meaning |
|---|---|
| served by this terminal | The process on the port runs inside this side's copy |
| served by the other terminal | This side's server did not start and the page shown belongs to the other side |
| port owned by another process | The port belongs to something outside the Lab |

To avoid the conflict, ask for a different port on each side in the prompt.

## Screenshots

When both sides finish a round, the Lab takes a screenshot of each preview and stores it with the history. When you open an older round, the Comparison shows those screenshots with the label of whoever was serving the page, instead of reopening the live page. Clicking a screenshot opens it at full size.

Screenshots use an installed Chrome, Chromium, Edge or Brave in headless mode. `LAB_BROWSER` points to another compatible executable. Without a browser, the round is saved without screenshots.

## Host login and git

Each pair reuses the Claude Code login of the machine running the Lab: `~/.claude/.credentials.json` on Linux or the Keychain on macOS, plus `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` from the environment. The token is read again on every **New pair**, so a renewed login on the host applies to the next pair. It only goes to the Claude processes and never reaches files or the browser.

Both sides also inherit the host's git setup: `GIT_CONFIG_GLOBAL` points to `~/.gitconfig` (or `~/.config/git/config`), `GH_CONFIG_DIR` to the `gh` configuration, and `SSH_AUTH_SOCK`, `GH_TOKEN`, `GITHUB_TOKEN` and `GIT_SSH_COMMAND` are passed through when present. The project copy includes `.git`, so each side sees the history and can create commits. With the inherited credentials, a `git push` from either side reaches the real remote.

Each profile comes with a theme set, onboarding completed and the project copy marked as trusted, so the terminals open straight at the prompt.

On macOS, the Keychain is not reachable from processes started over SSH. The recommended setup is to run the Lab on a Linux machine and open it over the network.

## Network access

`--listen` binds the Lab to one of the machine's IPs instead of only `127.0.0.1`:

```bash
npm start -- --listen 192.168.1.50 --port 4178
```

On startup, the Lab prints a link with a token (`http://IP:4178/?token=...`). The first visit through that link sets an `HttpOnly` cookie, and the browser no longer needs the token. Without the cookie, the page answers 401 and the terminal refuses the connection. The token is saved next to the history, in the `token` file, and `LAB_TOKEN` sets a different value. The terminals run with permission bypass, so treat the link like a password and open the port only to the machines that will use the Lab.

The previews of both sides go through proxies on the next ports (`4179` for the side with the item, `4180` for the control), which only accept addresses that already signed in with the token. Open all three ports in the firewall:

```bash
sudo ufw allow from CLIENT_IP to any port 4178:4180 proto tcp
```

To keep the Lab always on under Linux, use a systemd user service:

```ini
[Unit]
Description=Lab Switch
After=network-online.target

[Service]
WorkingDirectory=/path/to/lab-switch/app
ExecStart=/usr/bin/node lab-switch.mjs --listen 192.168.1.50 --port 4178 --claude-bin /path/to/claude
Restart=on-failure

[Install]
WantedBy=default.target
```

Save it as `~/.config/systemd/user/lab-switch.service` and enable it:

```bash
systemctl --user enable --now lab-switch
journalctl --user -u lab-switch | grep token=
```

Run `loginctl enable-linger` so the service stays up without an open session. When `claude` comes from a version manager, point `--claude-bin` at the real executable.

## Other items

`--demo` lets you try the interface with demo processes. The page labels this mode. `--model` applies the same model to both sides.

```bash
npm start -- --demo
npm start -- --model sonnet --port 4180
npm start -- --kind mod --item /path/to/codeflow --project /path/to/project
```

`--kind` accepts `mod` (folder or ZIP), `skill` (folder with SKILL.md, or the file itself), `hook` (settings JSON with a `hooks` key), `mcp` (JSON with `mcpServers`) and `agent` (agents JSON for `--agents`). `--code-mode` requests native Code Mode on both sides. `--active-codeflow` also turns on filters and guards on the experimental side, for a separate test. `--claude-bin` points to a specific executable.

## Local data

Each side gets its own isolated HOME, CLAUDE_CONFIG_DIR and working directory. **New pair** creates fresh project copies and keeps the server's disposable profiles. **Stop** ends both processes. Stop the server with Ctrl+C to delete the lab profiles. Without `--listen`, the server only accepts loopback connections from the expected local origin. Use trusted extensions and projects, because the binaries run with the user's account and Claude's managed policies still apply.

`npm test` exercises both PTYs, multi-line sends, permission bypass, history recording, preview detection with vite's ANSI colors, screenshots with a fake browser, token-based network access, host git inheritance, shutdown and rejection of external origins. The tests use the deterministic demo.

## Kiro

The `.kiro/` folder holds the steering files (product, tech, structure) and the spec (requirements, design, tasks) used to build the Lab.
