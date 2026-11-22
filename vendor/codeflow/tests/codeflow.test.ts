import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { applyGuard } from '../hooks/lib/guard'
import { resolveToggle } from '../hooks/lib/env'
import { newSessionTelemetry, observeThinkingBlock, newTurnTelemetry, sumUsage, totalInput } from '../hooks/lib/telemetry'

const usage = {
  model: 'test-model',
  input_tokens: 100,
  output_tokens: 20,
  cache_read_input_tokens: 70,
  cache_creation_input_tokens: 5,
}

const completion = {
  turnId: 't1',
  answer: 'Original answer',
  durationMs: 1000,
  isAborted: false,
  reason: 'answer' as const,
  usage,
}

const start = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const command = { command: 'codeflow', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
const nativeSection = { id: 'intro', text: 'Native prompt', scope: 'shared' as const }
const compose = {
  model: 'test-model', promptModel: 'test-model', surfaces: ['terminal'] as const,
  tools: [], outputStyle: null, traits: [],
}

function mockSession(on: On, variables: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, variables)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 12_000, window: 200_000, percent: 6 }, rateLimits: [], cost: { usd: 0.0123 } },
  }))
  on('prompt.compose', () => ({ sections: [nativeSection] }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  mock.session(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  return clock
}

test('toggle is passive by default, active only with opt-in', () => {
  expect(resolveToggle(undefined)).toEqual({ enabled: false, invalid: false })
  expect(resolveToggle('0')).toEqual({ enabled: false, invalid: false })
  expect(resolveToggle('1')).toEqual({ enabled: true, invalid: false })
  expect(resolveToggle('invalid')).toEqual({ enabled: false, invalid: true })
})

test('passive mode preserves native sections and counts tools', async ($, on) => {
  mockSession(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(start)
  expect((await $.prompt.compose(compose)).sections).toEqual([nativeSection])
  await $.turn.start({ text: 'query', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'printf ok' })
  await $.turn.start({ text: 'subagent', turnId: 'child', agentId: 'a1' })
  await $.turn.complete({ ...completion, turnId: 'child', agentId: 'a1' })
  const ended = await $.turn.complete(completion)
  expect(ended.text).toContain('1 call(s)')
  expect(ended.text).toContain('new input 100')
  expect(ended.text).toContain('total input 175')
  expect(ended.text).toContain('context 6%')
})

test('active mode adds a session section to the prompt', async ($, on) => {
  mockSession(on, { CLAUDE_CODEFLOW_ENABLED: '1' })
  await $.session.start(start)
  const composed = await $.prompt.compose(compose)
  expect(composed.sections[0]).toEqual(nativeSection)
  expect(composed.sections[1]?.id).toBe('codeflow:operations')
  expect(composed.sections[1]?.scope).toBe('session')
  expect(composed.sections).toHaveLength(2)
})

test('guard keeps the original deny and ask decision and reason', () => {
  for (const decision of ['deny', 'ask'] as const) {
    const native = { decision, reason: 'native rule' }
    expect(applyGuard(native, { command: 'flagger' }, ['flagger'])).toEqual(native)
  }
})

test('guard via tool.check reads the input and preserves deny', { options: { guardPatterns: 'flagger' } }, async ($, on) => {
  mockSession(on, { CLAUDE_CODEFLOW_ENABLED: '1' })
  on('tool.check', ($, e) => {
    const input = e.input as { command?: string }
    return input.command?.includes('blocked')
      ? { decision: 'deny', reason: 'native rule' }
      : { decision: 'allow' }
  })
  await $.session.start(start)
  const denied = await $.tool.check({ tool: 'Bash', input: { command: 'printf "flagger blocked"' } })
  expect(denied.decision).toBe('deny')
  expect(denied.reason).toBe('native rule')
  const flagged = await $.tool.check({ tool: 'Bash', input: { command: 'printf flagger' } })
  expect(flagged.decision).toBe('ask')
  const plain = await $.tool.check({ tool: 'Bash', input: { command: 'printf ok' } })
  expect(plain.decision).toBe('allow')
  const script = await $.tool.check({ tool: 'REPL', input: { code: '"flagger"' } })
  expect(script.decision).toBe('ask')
})

test('guard is passive when active mode is off', { options: { guardPatterns: 'flagger' } }, async ($, on) => {
  mockSession(on)
  on('tool.check', () => ({ decision: 'allow' }))
  await $.session.start(start)
  const result = await $.tool.check({ tool: 'Bash', input: { command: 'printf flagger' } })
  expect(result.decision).toBe('allow')
})

test('output goes whole to the tool and only eligible read text in the transcript is reduced',
  { options: { maxFileLines: 2, maxToolResultChars: 120 } }, async ($, on) => {
    mockSession(on, { CLAUDE_CODEFLOW_ENABLED: '1' })
    const raw = ['line 1', 'line 2', 'fixture text '.repeat(100)].join('\n')
    on('tool.call', ($, e) => e.tool_use_id === 'failed1' ? { result: raw, isError: true } : { result: raw })
    await $.session.start(start)
    await $.turn.start({ text: 'read', turnId: 't1' })
    const read = await $.tool.call({ tool: 'Read', file_path: '/work/example.txt', tool_use_id: 'read1' })
    expect(read.result).toBe(raw)
    const readRow = await $.session.append({
      door: 'tool-result', uuid: 'row1', origin: { kind: 'tool', tool: 'Read' },
      message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read1', content: raw }] },
    })
    const shortened = readRow.message?.content[0]?.content
    expect(typeof shortened).toBe('string')
    expect((shortened as string).length).toBeLessThan(raw.length)
    const bash = await $.tool.call({ tool: 'Bash', command: 'printf ok', tool_use_id: 'bash1' })
    expect(bash.result).toBe(raw)
    const row = await $.session.append({
      door: 'tool-result', uuid: 'row2', origin: { kind: 'tool', tool: 'Bash' },
      message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bash1', content: raw }] },
    })
    expect(row.message?.content[0]?.content).toBe(raw)
    await $.tool.call({ tool: 'Read', file_path: '/work/missing.txt', tool_use_id: 'failed1' })
    const failed = await $.session.append({
      door: 'tool-result', uuid: 'row3', origin: { kind: 'tool', tool: 'Read' },
      message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'failed1', is_error: true, content: raw }] },
    })
    expect(failed.message?.content[0]?.content).toBe(raw)
    await $.tool.call({ tool: 'Read', file_path: '/work/example.txt', tool_use_id: 'read2' })
    const parts = await $.session.append({
      door: 'tool-result', uuid: 'row4', origin: { kind: 'tool', tool: 'Read' },
      message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read2', content: [{ type: 'text', text: raw }] }] },
    })
    expect(parts.message?.content[0]?.content).toEqual([{ type: 'text', text: shortened }])
  })

test('thinking count keeps only counters', () => {
  const session = newSessionTelemetry()
  session.current = newTurnTelemetry('t1', 0)
  observeThinkingBlock(session, 'private fixture for counting only')
  expect(session.current?.thinking).toEqual({ blocks: 1, words: 5 })
  expect(JSON.stringify(session)).not.toContain('private fixture')
})

test('stash requires an explicit value and expires in the session', async ($, on) => {
  const clock = mockSession(on, { CLAUDE_CODEFLOW_ENABLED: '1' })
  await $.session.start(start)
  expect((await $.command.run({ ...command, args: 'stash counter' })).text).toContain('up to 2,000')
  await $.command.run({ ...command, args: 'stash counter 42 lines' })
  expect((await $.command.run({ ...command, args: 'recall counter' })).text).toBe('42 lines')
  await clock.advance(30 * 60 * 1000)
  expect((await $.command.run({ ...command, args: 'recall counter' })).text).toContain('expired')
})

test('registry and disk stay off the default path', async ($, on) => {
  mockSession(on)
  let writes = 0
  on('store.set', () => { writes += 1; return { value: undefined } })
  on('fs.write', () => { writes += 1; return { value: undefined } })
  await $.session.start(start)
  await $.turn.start({ text: 'query', turnId: 't1' })
  await $.turn.complete(completion)
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  expect(writes).toBe(0)
})

test('report reads only the chosen experiment and clears when the session changes', async ($, on) => {
  mockSession(on, { CLAUDE_CODEFLOW_RUN: 'slice-a' })
  const seed = { sessionId: 'unrelated', savedAtMs: 0, enabled: true, turns: [], peakContextPercent: null }
  const keys: string[] = []
  const values = new Map<string, unknown>([['codeflow:v2:slice-b:unrelated', seed]])
  on('store.keys', () => ({ value: [...values.keys()] }))
  on('store.get', ($, e) => { keys.push(e.key); return { value: values.get(e.key) } })
  on('store.set', ($, e) => { values.set(e.key, e.value); return { value: undefined } })
  await $.session.start(start)
  await $.turn.start({ text: 'query', turnId: 't1' })
  await $.turn.complete(completion)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  const report = await $.command.run({ ...command, args: 'report' })
  expect(keys.some(key => key.startsWith('codeflow:v2:slice-b:'))).toBe(false)
  expect(report.text).toContain('Experiment slice-a')
  expect(report.text).toContain('Passive (1 session(s))')
  expect(report.text).toContain('Current session · 0/0')
})

test('missing tokens stay unavailable', () => {
  const first = newTurnTelemetry('t1', 0)
  first.usage = { input: 100, cacheRead: 70, cacheCreation: 5, output: 20 }
  const second = newTurnTelemetry('t2', 0)
  expect(totalInput(first.usage)).toBe(175)
  expect(sumUsage([first, second])?.input).toBe(null)
})

test('counts grouping from the tools proposed in the step', async ($, on) => {
  mockSession(on)
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId, index: e.index, answer: '', stopReason: 'tool_use', usage: null,
      toolUses: [{ name: 'Read', input: {} }, { name: 'Glob', input: {} }],
    }
  })
  await $.session.start(start)
  await $.turn.start({ text: 'query', turnId: 't1' })
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'test-model', messageCount: 1 })) {
    void chunk
  }
  const ended = await $.turn.complete(completion)
  expect(ended.text).toContain('1 request(s) with multiple tools')
})
