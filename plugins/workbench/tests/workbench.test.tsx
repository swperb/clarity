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
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const


/** Stands in for the app: answers Workbench's question with `choice`, or throws (nobody there). */
function app(choice: string | null, asked: string[], ran: string[]) {
  return (_: unknown, e: { tool: string; command?: string; questions?: { question: string }[] }) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions?.[0]?.question ?? ''
      asked.push(q)
      if (choice === null) {
        throw new Error('no one to ask')
      }
      return { result: { questions: e.questions, answers: { [q]: choice } } }
    }
    ran.push(String(e.command))
    return { result: {} }
  }
}

test('the guard asks before a force-push, and denying it stops the command', async ($, on) => {
  const asked: string[] = []
  const ran: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('tool.call', app("Don't run it", asked, ran))

  const result = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('force-pushes')
  expect(result.deny).toContain('force-pushes')
  expect(ran.includes('git push --force origin main')).toBe(false)
})

test('approving the guard runs the command; a safe command never asks', async ($, on) => {
  const asked: string[] = []
  const ran: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('tool.call', app('Run it anyway', asked, ran))

  await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(asked.length).toBe(1)
  expect(ran).toEqual(['git push --force origin main', 'git push origin main'])
})

test('with nobody to ask, the guard refuses', async ($, on) => {
  const ran: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('tool.call', app(null, [], ran))

  const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })
  expect(result.deny).toContain('nobody was available')
  expect(ran.length).toBe(0)
})

test('text inside a heredoc is data: describing risky commands does not ask', async ($, on) => {
  const asked: string[] = []
  const ran: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('tool.call', app('Run it anyway', asked, ran))

  await $.tool.call({ tool: 'Bash', command: "cat > README.md <<'EOF'\nThe guard covers git reset --hard.\nEOF" })
  expect(asked.length).toBe(0)
  expect(ran.length).toBe(1)
})

test('a risky command inside bash -c still asks', async ($, on) => {
  const asked: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('tool.call', app("Don't run it", asked, []))

  const result = await $.tool.call({ tool: 'Bash', command: 'bash -c "rm -rf ~"' })
  expect(asked.length).toBe(1)
  expect(result.deny).toContain('deletes')
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
  // The counts stay outside the Button so the surface keeps their diff colors.
  expect((await ui.find({ type: 'Button', key: 'file:src/main.ts' }))?.text.startsWith('src/main.ts')).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^\+2$/ }))?.props.color).toBe('diffAdded')
  expect((await ui.find({ type: 'Text', text: /^−1$/ }))?.props.color).toBe('diffRemoved')
  await ui.unmount()
})

test('a new file counts its lines as added', async ($, on) => {
  on('session.cwd', () => ({ value: '/work/app' }))
  on('clock.now', () => ({ value: 1000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: { type: 'create', structuredPatch: [], originalFile: null } }))

  await $.tool.call({ tool: 'Write', file_path: '/work/app/src/new.ts', content: 'a\nb\nc\n' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /\+3/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('the band carries a clickable usage chip, and the usage pane explains it', async ($, on) => {
  on('clock.now', () => ({ value: 18 * 60_000 }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, tokens: 56_000, percent: 28 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 34 }],
      cost: { usd: 8.49 },
    },
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.status', () => ({ value: undefined }))

  await $.session.measure({
    context: { window: 200_000, tokens: 56_000, percent: 28 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 34 }],
    cost: { usd: 8.49 },
    changed: ['cost'],
  })

  const band = await $.ui.mount(BAND)
  const chip = await band.find({ type: 'Button', key: 'usage' })
  expect(chip?.text).toContain('$8.49')
  expect(chip?.text).toContain('28% context')
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, requestId: 'workbench-usage', props: { ...PANE.props, title: 'Session usage' } })
  expect((await pane.find({ type: 'Text', text: /Context · 28%/ })) !== undefined).toBe(true)
  expect((await pane.find({ type: 'Text', text: /working memory/ })) !== undefined).toBe(true)
  expect((await pane.find({ type: 'Text', text: /5-hour window 34%/ })) !== undefined).toBe(true)
  await pane.unmount()
})

test('a failing run inside a compound command still reads as failing', async ($, on) => {
  on('clock.now', () => ({ value: 1000 }))
  on('ui.status', () => ({ value: undefined }))
  // `ls; npm test; echo` exits 0 from `echo`; the runner's own summary says it failed.
  on('tool.call', () => ({ result: {}, text: '# tests 1\n# pass 0\n# fail 1\n' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.tool.call({ tool: 'Bash', command: 'ls -R src; npm test; echo done' })

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /Tests failing/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('edits and checks through another MCP server are tracked too', async ($, on) => {
  on('session.cwd', () => ({ value: '/work/app' }))
  on('clock.now', () => ({ value: 1000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', () => ({ value: false }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', (_, e) => (e.tool === 'mcp__runner__run_checks' ? { result: {}, text: 'All 7 tests: 7 passed' } : { result: {} }))

  await $.tool.call({ tool: 'mcp__editor__edit', path: 'src/cart.js', old_string: 'a', new_string: 'b\nc' })
  await $.tool.call({ tool: 'mcp__editor__write', path: 'src/discounts.js', content: 'x\ny\nz\n' })
  await $.tool.call({ tool: 'mcp__runner__run_checks' })

  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Button', key: 'file:src/cart.js' })) !== undefined).toBe(true)
  expect((await pane.find({ type: 'Button', key: 'file:src/discounts.js' }))?.text).toContain('new')
  await pane.unmount()

  const band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /Tests passing/ })) !== undefined).toBe(true)
  await band.unmount()
})
