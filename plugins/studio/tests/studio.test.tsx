import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { branchOf, classifyMcpTool, flattenTree, languageOf, modelName, patchToDiff, replacementDiff, searchFiles, tidyListing } from '../hooks/lib'

const CWD = '/work/shop'

const pane = (bodyColumns: number, placement: 'dock' | 'widget' = 'dock') =>
  ({
    plugin: 'studio',
    component: 'Pane',
    requestId: 'studio',
    surface: 'desktop',
    props: {
      title: 'Studio',
      isFocused: false,
      bodyColumns,
      placement,
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const

const FILES: Record<string, { name: string; kind: 'file' | 'dir' | 'other'; size: number }[]> = {
  [CWD]: [
    { name: 'src', kind: 'dir', size: 0 },
    { name: 'node_modules', kind: 'dir', size: 0 },
    { name: '.git', kind: 'dir', size: 0 },
    { name: 'README.md', kind: 'file', size: 10 },
  ],
  [`${CWD}/src`]: [{ name: 'cart.js', kind: 'file', size: 40 }],
}

/** The engine beneath the plugin: a folder, a clock, a git repo, a model. */
function engine(on: On, opened: string[] = [], filled: string[] = []): void {
  on('session.cwd', () => ({ value: CWD }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: 1000 }))
  on('store.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'studio' } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '## main...origin/main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.list', (_, e) => ({ value: (FILES[e.path] ?? []).map(f => ({ ...f, mtimeMs: 0, isLink: false })) }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 40, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'export const total = items => 0\n' }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const READ_RESULT = {
  result: {
    type: 'text',
    file: { filePath: `${CWD}/src/cart.js`, content: 'const a = 1\nconst b = 2', numLines: 2, startLine: 10, totalLines: 40 },
  },
}

test('following a Read shows the file at its range, with the tree and session header', async ($, on) => {
  const opened: string[] = []
  engine(on, opened)
  on('tool.call', () => READ_RESULT)

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/cart.js`, offset: 10, limit: 2, tool_use_id: 't1' })

  expect(opened).toEqual(['studio']) // desktop docks panes, so it opened itself on the first touch

  const ui = await $.ui.mount(pane(120))
  expect((await ui.find({ type: 'Text', text: 'shop' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /⎇ main/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /Opus 5\.5/ })) !== undefined).toBe(true)

  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toBe('const a = 1\nconst b = 2')
  expect(code?.props.startLine).toBe(10)
  expect(code?.props.language).toBe('javascript')

  // Hidden folders stay out of the tree.
  expect((await ui.find({ type: 'Button', key: 'tree:src' })) !== undefined).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'tree:node_modules' })).toBe(undefined)
  expect(await ui.find({ type: 'Button', key: 'tree:.git' })).toBe(undefined)

  // The activity strip names the read and its range.
  const row = await ui.find({ type: 'Button', key: 'touch:t1' })
  expect(row?.text).toContain('Read src/cart.js L10–11')
  await ui.unmount()
})

test('an Edit shows as a diff in the app diff colors, and the widget glances at it', async ($, on) => {
  engine(on)
  on('tool.call', () => ({
    result: {
      filePath: `${CWD}/src/cart.js`,
      structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: ['-a', '+b', '+c'] }],
    },
  }))

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: `${CWD}/src/cart.js`, old_string: 'a', new_string: 'b\nc', tool_use_id: 'e1' })

  const ui = await $.ui.mount(pane(120))
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(code?.props.source).toBe('@@ -3,1 +3,2 @@\n-a\n+b\n+c')
  const added = await ui.findAll({ type: 'Text', text: '+2' })
  expect(added.some(a => a.props.color === 'diffAdded')).toBe(true)
  await ui.unmount()

  const widget = await $.ui.mount(pane(40, 'widget'))
  const line = await widget.find({ type: 'Text', text: /Edited src\/cart\.js/ })
  expect(line?.text).toBe('Working · Edited src/cart.js +2 −1')
  await widget.unmount()
})

test('a created file shows its content', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { type: 'create', filePath: `${CWD}/src/new.py`, content: 'print(1)\nprint(2)\n', structuredPatch: [] } }))

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: `${CWD}/src/new.py`, content: 'print(1)\nprint(2)\n', tool_use_id: 'w1' })

  const ui = await $.ui.mount(pane(120))
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toBe('print(1)\nprint(2)\n')
  expect(code?.props.language).toBe('python')
  expect((await ui.find({ type: 'Button', key: 'touch:w1' }))?.text).toContain('Created src/new.py')
  await ui.unmount()
})

test('clicking a tree file pins the viewer and pauses Follow until Follow is pressed', async ($, on) => {
  engine(on)
  on('tool.call', () => READ_RESULT)

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/cart.js`, tool_use_id: 't1' })

  const ui = await $.ui.mount(pane(120))
  expect((await ui.find({ type: 'Text', text: /Following/ })) !== undefined).toBe(true)

  await ui.press({ key: 'tree:README.md' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('export const total = items => 0\n')
  expect((await ui.find({ type: 'Code' }))?.props.language).toBe('markdown')
  expect((await ui.find({ type: 'Button', key: 'follow' })) !== undefined).toBe(true)

  // While paused, a new touch is recorded but does not move the viewer.
  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/cart.js`, tool_use_id: 't2' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('export const total = items => 0\n')

  await ui.press({ key: 'follow' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('const a = 1\nconst b = 2')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBe(undefined)
  await ui.unmount()
})

test('folders expand on click, loading lazily, and marks show on files', async ($, on) => {
  engine(on)
  on('tool.call', () => READ_RESULT)

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane(120))
  expect(await ui.find({ type: 'Button', key: 'tree:src/cart.js' })).toBe(undefined)

  await ui.press({ key: 'tree:src' })
  expect((await ui.find({ type: 'Button', key: 'tree:src/cart.js' })) !== undefined).toBe(true)

  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/cart.js`, tool_use_id: 't1' })
  expect((await ui.find({ type: 'Button', key: 'tree:src/cart.js' }))?.text).toContain('cart.js ·')

  await ui.press({ key: 'tree:src' })
  expect(await ui.find({ type: 'Button', key: 'tree:src/cart.js' })).toBe(undefined)
  await ui.unmount()
})

test('Mention inserts @path into the prompt', async ($, on) => {
  const filled: string[] = []
  engine(on, [], filled)
  on('tool.call', () => READ_RESULT)

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/cart.js`, tool_use_id: 't1' })

  const ui = await $.ui.mount(pane(120))
  await ui.press({ key: 'mention' })
  expect(filled).toEqual(['@src/cart.js '])
  await ui.unmount()
})

test('a narrow pane stacks with tabs; a failed command shows ✗ and its status', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ isError: true, result: 'Exit code 1\nFAIL test/cart.test.js', text: 'Exit code 1\nFAIL test/cart.test.js' }))

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b1' })

  const ui = await $.ui.mount(pane(60))
  expect((await ui.find({ type: 'Button', key: 'tab:files' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'touch:b1' }))?.text).toContain('Ran npm test ✗')

  await ui.press({ key: 'tab:viewer' })
  expect((await ui.find({ type: 'Text', text: /exit 1/ }))?.props.color).toBe('error')
  await ui.unmount()
})

test('a search lists matched files as rows that open them', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { filenames: [`${CWD}/src/cart.js`, `${CWD}/README.md`], numFiles: 2 } }))

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Grep', pattern: 'total', tool_use_id: 'g1' } as never)

  const ui = await $.ui.mount(pane(120))
  expect((await ui.find({ type: 'Button', key: 'touch:g1' }))?.text).toContain('Searched “total” · 2 files')
  await ui.press({ key: 'hit:0:src/cart.js' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('export const total = items => 0\n')
  await ui.unmount()
})

test('it never opens itself on a surface that does not dock panes', async ($, on) => {
  const opened: string[] = []
  engine(on, opened)
  on('tool.call', () => READ_RESULT)

  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/cart.js`, tool_use_id: 't1' })
  expect(opened).toEqual([])

  const ran = await $.command.run({ command: 'studio', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(opened).toEqual(['studio'])
  expect(ran).toEqual({ text: 'Opened Studio.' })
})

// ── Pure helpers ────────────────────────────────────────────────────────────

test('helpers: languages, diffs, branches, models, search results, tree', async () => {
  expect(languageOf('src/cart.test.ts')).toBe('typescript')
  expect(languageOf('Dockerfile')).toBe('dockerfile')
  expect(languageOf('LICENSE')).toBe(undefined)

  expect(patchToDiff([{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' x', '-y', '+z'] }])).toBe('@@ -1,2 +1,2 @@\n x\n-y\n+z')

  expect(branchOf('## studio-ide...origin/studio-ide [ahead 1]\n M a')).toBe('studio-ide')
  expect(branchOf('## No commits yet on main')).toBe('main')
  expect(branchOf('## feature/v1.2')).toBe('feature/v1.2')
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-4-20250514')).toBe('Sonnet 4')

  expect(searchFiles(undefined, 'Found 2 files\nsrc/a.ts\nlib/b.js')).toEqual(['src/a.ts', 'lib/b.js'])

  const listings = {
    '.': tidyListing([
      { name: 'b.txt', kind: 'file', size: 1 },
      { name: 'dist', kind: 'dir', size: 0 },
      { name: 'a', kind: 'dir', size: 0 },
    ]),
    a: [{ name: 'x.ts', kind: 'file' as const, size: 1 }],
  }
  expect(flattenTree(listings, ['a']).map(r => `${r.depth}:${r.path}`)).toEqual(['0:a', '1:a/x.ts', '0:b.txt'])
})

// ── MCP tools ───────────────────────────────────────────────────────────────

test('an MCP edit shows as a diff rebuilt from its input, and the live line follows it', async ($, on) => {
  engine(on)
  let release = (): void => undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  on('tool.call', async () => {
    await gate
    return { result: { content: [{ type: 'text', text: 'edited · budget 90%' }] } }
  })

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane(120))
  expect((await ui.find({ type: 'Text', text: /Idle/ })) !== undefined).toBe(true)

  const call = $.tool.call({ tool: 'mcp__ndstrl__edit', path: 'src/cart.js', old_string: 'items => 1', new_string: 'items => 0', tool_use_id: 'm1' } as never)
  let line: string | undefined
  for (let i = 0; i < 50 && line === undefined; i++) {
    line = (await ui.find({ type: 'Text', text: /Claude is editing/ }))?.text
    if (line === undefined) {
      await Promise.resolve()
    }
  }
  expect(line).toContain('Claude is editing src/cart.js')
  release()
  await call

  const code = await ui.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(code?.props.source).toBe('@@ -1,1 +1,1 @@\n-items => 1\n+items => 0')
  expect((await ui.find({ type: 'Button', key: 'touch:m1' }))?.text).toContain('Edited src/cart.js +1 −1')
  expect((await ui.find({ type: 'Text', text: /Claude is working · last: Edited src\/cart\.js/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('an MCP write shows its content; an MCP read opens the file; failing checks show ✗', async ($, on) => {
  engine(on)
  on('tool.call', (_, e) =>
    String(e.tool) === 'mcp__ndstrl__run_checks'
      ? { isError: true, result: 'checks failed: 1 of 4', text: 'checks failed: 1 of 4' }
      : { result: { content: [{ type: 'text', text: 'ok' }] } },
  )

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__ndstrl__write', path: `${CWD}/src/tax.ts`, content: 'export const rate = 0.2\n', tool_use_id: 'w1' } as never)
  const ui = await $.ui.mount(pane(120))
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('export const rate = 0.2\n')
  expect((await ui.find({ type: 'Code' }))?.props.language).toBe('typescript')
  expect((await ui.find({ type: 'Button', key: 'touch:w1' }))?.text).toContain('Wrote src/tax.ts +1 −0')

  await $.tool.call({ tool: 'mcp__ndstrl__read', paths: ['README.md', 'src/cart.js'], tool_use_id: 'r1' } as never)
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('export const total = items => 0\n')
  expect((await ui.find({ type: 'Button', key: 'touch:r1' }))?.text).toContain('Read README.md +1 more')

  await $.tool.call({ tool: 'mcp__ndstrl__run_checks', tool_use_id: 'c1' } as never)
  expect((await ui.find({ type: 'Button', key: 'touch:c1' }))?.text).toContain('Ran checks')
  expect((await ui.find({ type: 'Text', text: /✗ failed/ }))?.props.color).toBe('error')
  await ui.unmount()
})

test('MCP tools it cannot place are left alone', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { content: [] } }))

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__ndstrl__ask', question: 'which file?', tool_use_id: 'q1' } as never)
  const ui = await $.ui.mount(pane(120))
  expect(await ui.find({ type: 'Button', key: 'touch:q1' })).toBe(undefined)
  await ui.unmount()
})

test('helpers: MCP tools by input shape, and replacement diffs', async () => {
  expect(classifyMcpTool('mcp__ndstrl__edit', { path: 'a.ts', old_string: 'x', new_string: 'y\nz' })).toEqual({
    kind: 'edit', path: 'a.ts', oldText: 'x', newText: 'y\nz', adds: 2, dels: 1,
  })
  expect(classifyMcpTool('mcp__fs__write_file', { path: 'a.ts', content: 'a\n' })?.kind).toBe('write')
  expect(classifyMcpTool('mcp__box__exec', { command: 'ls' })?.kind).toBe('shell')
  expect(classifyMcpTool('mcp__ndstrl__run_checks', {})?.kind).toBe('checks')
  expect(classifyMcpTool('mcp__fs__read_text_file', { path: 'a.ts' })).toEqual({ kind: 'read', path: 'a.ts', more: 0 })
  expect(classifyMcpTool('mcp__ndstrl__read', { paths: ['a', 'b', 'c'] })).toEqual({ kind: 'read', path: 'a', more: 2 })
  expect(classifyMcpTool('mcp__ndstrl__search', { query: 'x' })).toBe(undefined)
  expect(classifyMcpTool('Read', { file_path: 'a' })).toBe(undefined)
  expect(replacementDiff('a\nb\n', 'c\n', 7)).toBe('@@ -7,2 +7,1 @@\n-a\n-b\n+c')
})

// ── Working and idle ────────────────────────────────────────────────────────

test('the header says Claude is working for the whole turn, not only while a tool runs', async ($, on) => {
  engine(on)
  on('tool.call', () => READ_RESULT)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })

  // A tool call alone (a reload mid-turn misses turn.start) flips it to working.
  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/cart.js`, tool_use_id: 't1' })
  const ui = await $.ui.mount(pane(120))
  expect((await ui.find({ type: 'Text', text: /Claude is working/ }))?.text).toBe('● Claude is working · last: Read src/cart.js')
  expect(await ui.find({ type: 'Text', text: /Idle/ })).toBe(undefined)
  await ui.unmount()

  const widget = await $.ui.mount(pane(40, 'widget'))
  expect((await widget.find({ type: 'Text', text: /Working/ }))?.text).toBe('Working · Read src/cart.js')
  await widget.unmount()

  // The turn ends: idle. A new turn starts: working again, before any tool runs.
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  const idle = await $.ui.mount(pane(120))
  expect((await idle.find({ type: 'Text', text: /Idle/ })) !== undefined).toBe(true)

  await $.turn.start({ text: 'fix the cart', turnId: 'turn-2' })
  expect((await idle.find({ type: 'Text', text: /Claude is working/ })) !== undefined).toBe(true)

  // A subagent's turn ending leaves the main turn working.
  await $.turn.complete({ answer: 'sub', durationMs: 5, isAborted: false, turnId: 'turn-3', agentId: 'a1', reason: 'answer' })
  expect((await idle.find({ type: 'Text', text: /Claude is working/ })) !== undefined).toBe(true)
  await idle.unmount()
})
