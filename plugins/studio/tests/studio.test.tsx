import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { branchOf, flattenTree, languageOf, modelName, patchToDiff, searchFiles, tidyListing } from '../hooks/lib'

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
  expect(line?.text).toBe('Edited src/cart.js +2 −1')
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
