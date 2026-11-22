# Test scenario: landing page

Create a throwaway folder, open a session with `CLAUDE_CODEFLOW_ENABLED=1` and load the mod as described in the README. In another pair, run the same task in passive mode from the same state.

> Create a responsive page for the fictional app Bolso. Use index.html, styles.css and app.js. Include a main call to action, a benefits section, a footer and an email form with validation. Run a local server and confirm that the page opens.

In separate turns, ask for a link check and a change to the primary color. If you want to test the stash, use `/codeflow stash links 3 valid internal links` and `/codeflow recall links`. The chosen text stays in memory during the session.

## Criteria

- The page opens, the form responds and the diff shows the expected changes.
- `/codeflow report` shows time and calls for the completed turns. Context, tokens and cost appear when Claude reports them.
- Whether a read gets reduced depends on the volume and on the tool representation. Do a targeted read to check for omitted data.
- In passive mode the same collection continues, and the original read output reaches the transcript.
