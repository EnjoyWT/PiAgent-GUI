import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const workspaceRoot = process.cwd()
const pkgName = 'yl-animated-caret'

const repoUrl = 'https://github.com/EnjoyWT/YLAnimatedCaret.git'

const moduleDir = path.join(workspaceRoot, 'node_modules', pkgName)
const distDir = path.join(moduleDir, 'dist')
const distJs = path.join(distDir, 'yl-animated-caret.js')
const distCss = path.join(distDir, 'yl-animated-caret.css')

const log = (...args) => console.log(`[prepare:${pkgName}]`, ...args)

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
}

const run = (cmd, args, opts = {}) => {
  log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

if (!fs.existsSync(moduleDir)) {
  log(`Skip: ${moduleDir} not found (dependency not installed).`)
  process.exit(0)
}

if (fs.existsSync(distJs) && fs.existsSync(distCss)) {
  log('OK: dist artifacts already present.')
  process.exit(0)
}

log('dist artifacts missing; building from GitHub repo...')

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'yl-animated-caret-'))
const cloneDir = path.join(tmpBase, 'repo')

try {
  run('git', ['clone', '--depth', '1', repoUrl, cloneDir])

  // Install deps + build (repo uses Vite)
  run('pnpm', ['install'], { cwd: cloneDir })
  run('pnpm', ['run', 'build'], { cwd: cloneDir })

  const builtDistDir = path.join(cloneDir, 'dist')
  const builtJs = path.join(builtDistDir, 'yl-animated-caret.js')
  const builtCss = path.join(builtDistDir, 'yl-animated-caret.css')

  if (!fs.existsSync(builtJs) || !fs.existsSync(builtCss)) {
    throw new Error('Build finished but dist artifacts not found.')
  }

  ensureDir(distDir)
  fs.copyFileSync(builtJs, distJs)
  fs.copyFileSync(builtCss, distCss)

  // Optional UMD build output
  const builtUmd = path.join(builtDistDir, 'yl-animated-caret.umd.cjs')
  if (fs.existsSync(builtUmd)) {
    fs.copyFileSync(builtUmd, path.join(distDir, 'yl-animated-caret.umd.cjs'))
  }

  log('Done: dist artifacts copied into node_modules.')
} finally {
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  } catch {
    // ignore cleanup failures
  }
}
