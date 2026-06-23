import path from 'node:path'

export const repoRoot = process.cwd()
export const builtMainEntry = path.join(repoRoot, 'out', 'main', 'index.js')
