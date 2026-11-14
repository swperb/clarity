// Test helper: a stand-in `claude` that logs its arguments and answers the
// two list commands. On Windows it is a `claude.cmd` shim, the exact case
// the installer has to start through the shell; elsewhere an executable.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function fakeClaude({ installed = [], markets = [] } = {}) {
  // A folder name with a space, so quoting is exercised too.
  const dir = mkdtempSync(join(tmpdir(), 'clarity fake-'))
  const log = join(dir, 'calls.log')
  const script = join(dir, 'fake.cjs')
  writeFileSync(script, `
const fs = require('fs')
const args = process.argv.slice(2).join(' ')
fs.appendFileSync(${JSON.stringify(log)}, args + '\\n')
if (args === 'plugin list --json') process.stdout.write(${JSON.stringify(JSON.stringify(installed))})
if (args === 'plugin marketplace list --json') process.stdout.write(${JSON.stringify(JSON.stringify(markets))})
`)
  let bin
  if (process.platform === 'win32') {
    bin = join(dir, 'claude.cmd')
    writeFileSync(bin, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
  } else {
    bin = join(dir, 'claude')
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
    chmodSync(bin, 0o755)
  }
  return { bin, calls: () => readFileSync(log, 'utf8').trim().split(/\r?\n/) }
}
