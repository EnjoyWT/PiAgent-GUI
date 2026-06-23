import type { CliRegistry } from '../cli-registry'

export const registerTestCliModule = (registry: CliRegistry): void => {
  registry.register('test', 'hi', async () => ({
    ok: true,
    exitCode: 0,
    stdout: 'hi',
    stderr: '',
    data: {
      message: 'hi'
    }
  }))
}
