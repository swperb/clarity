import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'workbench',
  component: 'Pane',
  requestId: 'workbench-changes',
  surface: 'desktop',
  props: {
    title: 'Changed files',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'workbench',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 } },
} as const

test('the guard asks before a force-push and leaves a plain push alone', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))

  const risky = await $.tool.check({ tool: 'Bash', input: { command: 'git push --force origin main' } })
  expect(risky.decision).toBe('ask')
  expect(risky.reason).toContain('force-pushes')

  const safe = await $.tool.check({ tool: 'Bash', input: { command: 'git push origin main' } })
  expect(safe.decision).toBe('allow')
})

test('the guard never loosens a deny from beneath', async ($, on) => {
  on('tool.check', () => ({ decision: 'deny', reason: 'blocked by rule' }))

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf ~' } })
  expect(verdict.decision).toBe('deny')
})

test('the band shows a failing test run, and nothing when all is quiet', async ($, on) => {
  on('clock.now', () => ({ value: 1000 }))
  on('tool.call', () => ({ result: {}, isError: true }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const quiet = await $.ui.mount(BAND)
  expect((await quiet.find({ type: 'Text' }))?.text).toBe('engine')
  await quiet.unmount()

  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /Tests failing/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('the pane lists an edited file with its line counts', async ($, on) => {
  on('session.cwd', () => ({ value: '/work/app' }))
  on('clock.now', () => ({ value: 1000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({
    result: { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c'] }] },
  }))

  await $.tool.call({ tool: 'Edit', file_path: '/work/app/src/main.ts', old_string: 'a', new_string: 'b\nc' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /1 file/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'file:src/main.ts' })) !== undefined).toBe(true)
  await ui.unmount()
})
