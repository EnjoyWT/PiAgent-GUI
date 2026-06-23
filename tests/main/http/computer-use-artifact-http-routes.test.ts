import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerComputerUseArtifactHttpRoutes } from '../../../src/main/http/computer-use-artifact-http-routes.ts'

test('serves computer use screenshot artifacts from the helper temp directory', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-computer-use-test-'))
  const app = Fastify({ logger: false })
  try {
    await writeFile(path.join(rootDir, 'screen-abc.png'), Buffer.from('png-bytes'))
    registerComputerUseArtifactHttpRoutes(app, { artifactDir: rootDir })

    const response = await app.inject({
      method: 'GET',
      url: '/assets/computer-use/screen-abc.png'
    })

    assert.equal(response.statusCode, 200)
    assert.match(response.headers['content-type'] as string, /^image\/png\b/)
    assert.equal(response.body, 'png-bytes')
  } finally {
    await app.close()
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('rejects invalid computer use artifact names', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-computer-use-test-invalid-'))
  const app = Fastify({ logger: false })
  try {
    registerComputerUseArtifactHttpRoutes(app, { artifactDir: rootDir })

    const response = await app.inject({
      method: 'GET',
      url: '/assets/computer-use/not-an-image.txt'
    })

    assert.equal(response.statusCode, 400)
  } finally {
    await app.close()
    await rm(rootDir, { recursive: true, force: true })
  }
})
