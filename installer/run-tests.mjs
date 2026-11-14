// Runs every installer test file. A shell glob in package.json would not
// expand on Windows (cmd.exe) or older Node, so the files are listed here.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort().map(f => join(here, f))
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(run.status ?? 1)
