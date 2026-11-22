# Codeflow A/B comparison

Use the same package on both sides to keep collection equivalent. Passive mode measures the same events and leaves the optimizations inactive.

## Rounds

Choose a new ID and use the same Claude Code version, model, effort, policy, prompt and file snapshot in each round. Alternate the order. Pass the ID only to sessions of the same experiment.

```bash
CLAUDE_CODEFLOW_RUN=search-01 CLAUDE_CODEFLOW_ENABLED=0 claude --plugin-dir /path/to/codeflow
CLAUDE_CODEFLOW_RUN=search-01 CLAUDE_CODEFLOW_ENABLED=1 claude --plugin-dir /path/to/codeflow
```

End each session normally to record the metrics. Open another session with the same ID and run `/codeflow report`. To also measure the gain from native Code Mode, keep a separate experiment and change only the state of the native executor.

## Reading

- Compare the median and range of time together with the quality of the result. To publish numbers, use at least five pairs and document the conditions.
- Compare total input tokens, new input, cache read, cache created and output.
- Compare observed requests and calls. Requests with several tools are counted separately.
- Check the Git diff and the final answer. Reports summarize sessions that ended in the last 24 hours with that ID.
