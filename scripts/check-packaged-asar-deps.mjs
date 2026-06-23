import { extractAll } from '@electron/asar'
import { builtinModules, createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const asarPath = args[0] ? resolve(args[0]) : findDefaultAsar()

if (!asarPath) {
  console.error('No packaged app.asar found. Pass a path or build under dist first.')
  process.exit(1)
}

const tempRoot = mkdtempSync(join(tmpdir(), 'piagent-asar-deps.'))
const extractedRoot = join(tempRoot, 'app')

try {
  extractAll(asarPath, extractedRoot)
  const result = scanReachableRequires(extractedRoot)
  if (result.missing.length > 0) {
    console.error(`Packaged dependency check failed for ${asarPath}`)
    for (const item of result.missing) {
      console.error(`- ${item.pkg}`)
      for (const from of item.from) console.error(`  required from ${from}`)
    }
    process.exit(1)
  }
  console.log(`Packaged dependency check passed for ${asarPath}`)
  console.log(`Scanned ${result.scannedFiles} reachable files from out/main/index.js`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

function findDefaultAsar() {
  const distDir = join(repoRoot, 'dist')
  if (!existsSync(distDir)) return null
  const matches = []
  walk(distDir, (file) => {
    if (file.endsWith('/Contents/Resources/app.asar') || file.endsWith('\\Contents\\Resources\\app.asar')) {
      matches.push(file)
    }
  })
  return matches.sort()[0] ?? null
}

function scanReachableRequires(root) {
  const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
  const requireFromApp = createRequire(join(root, 'out/main/index.js'))
  const visited = new Set()
  const missing = new Map()

  scan(join(root, 'out/main/index.js'))

  return {
    scannedFiles: visited.size,
    missing: Array.from(missing.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pkg, from]) => ({ pkg, from: Array.from(from).sort().slice(0, 10) }))
  }

  function scan(file) {
    if (visited.has(file)) return
    visited.add(file)
    if (!/\.(?:js|cjs)$/.test(file)) return

    const source = stripJavaScriptComments(readFileSync(file, 'utf8'))
    for (const match of source.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const resolved = resolveRequire(match[1], file)
      if (resolved.kind === 'file') scan(resolved.file)
      if (resolved.kind === 'missing-package') {
        if (!missing.has(resolved.pkg)) missing.set(resolved.pkg, new Set())
        missing.get(resolved.pkg).add(relative(root, file))
      }
    }
  }

  function resolveRequire(specifier, fromFile) {
    if (specifier.startsWith('node:') || builtins.has(specifier) || specifier === 'electron') {
      return { kind: 'builtin' }
    }

    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const base = specifier.startsWith('/')
        ? join(root, specifier)
        : resolve(dirname(fromFile), specifier)
      const file = resolveFileCandidate(base)
      return file ? { kind: 'file', file } : { kind: 'missing-file' }
    }

    const resolvedByNode = resolveWithNode(specifier, fromFile)
    if (resolvedByNode) return { kind: 'file', file: resolvedByNode }

    const resolvedByFallback = resolvePackageFallback(specifier)
    if (resolvedByFallback) return { kind: 'file', file: resolvedByFallback }

    return { kind: 'missing-package', pkg: packageName(specifier) }
  }

  function resolveWithNode(specifier, fromFile) {
    try {
      const resolved = requireFromApp.resolve(specifier, { paths: [dirname(fromFile), root] })
      if (resolved.startsWith(root) && existsSync(resolved)) return resolved
    } catch {
      return null
    }
    return null
  }

  function resolvePackageFallback(specifier) {
    const pkg = packageName(specifier)
    const rest = specifier === pkg ? '' : specifier.slice(pkg.length + 1)
    const packageDir = join(root, 'node_modules', ...pkg.split('/'))
    if (!existsSync(packageDir)) return null

    if (pkg === '@modelcontextprotocol/sdk' && rest.endsWith('.js')) {
      const sdkFile = resolveFileCandidate(join(packageDir, 'dist/cjs', rest))
      if (sdkFile) return sdkFile
    }

    if (rest) return resolveFileCandidate(join(packageDir, rest))

    let main = 'index.js'
    const packageJsonPath = join(packageDir, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        main = resolvePackageMain(packageJson) ?? main
      } catch {
        main = 'index.js'
      }
    }
    return resolveFileCandidate(join(packageDir, main))
  }
}

function resolvePackageMain(packageJson) {
  if (typeof packageJson.main === 'string') return packageJson.main
  if (typeof packageJson.exports === 'string') return packageJson.exports
  if (packageJson.exports && typeof packageJson.exports.require === 'string') {
    return packageJson.exports.require
  }
  const rootExport = packageJson.exports?.['.']
  if (rootExport && typeof rootExport.require === 'string') return rootExport.require
  if (rootExport && typeof rootExport.default === 'string') return rootExport.default
  return null
}

function resolveFileCandidate(base) {
  const candidates = [base, `${base}.js`, `${base}.cjs`, join(base, 'index.js'), join(base, 'index.cjs')]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

function packageName(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
}

function stripJavaScriptComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) walk(file, visit)
    else visit(file)
  }
}
