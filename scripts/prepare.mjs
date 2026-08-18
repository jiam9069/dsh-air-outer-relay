// Build the plugin entry when installing from a source checkout (a `github:`
// install ships src/ only, because lib/ is generated and git-ignored).
//
// A published tarball already contains lib/, so this script is a no-op there.
// It also stays silent when the entry is present and newer than the sources,
// which keeps `npm install` in a working tree from rebuilding needlessly.
import { existsSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'lib', 'index.js')

/** Newest mtime under a directory, or 0 when it does not exist. */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0
  let newest = 0
  for (const item of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!item.isFile()) continue
    const stats = statSync(join(item.parentPath ?? item.path, item.name))
    if (stats.mtimeMs > newest) newest = stats.mtimeMs
  }
  return newest
}

if (!existsSync(join(root, 'src', 'index.ts'))) process.exit(0)
if (existsSync(entry) && statSync(entry).mtimeMs >= newestMtime(join(root, 'src'))) process.exit(0)

let tsc
try {
  tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc')
} catch {
  console.error(
    'dsh-air-outer-relay: cannot build lib/ because the TypeScript compiler is not installed.\n' +
    '  Run "npm install && npm run build" inside ' + root,
  )
  process.exit(1)
}

const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], {
  cwd: root,
  stdio: 'inherit',
})
if (result.status !== 0) {
  console.error('dsh-air-outer-relay: building lib/ failed; the plugin entry lib/index.js is missing.')
  process.exit(result.status ?? 1)
}
