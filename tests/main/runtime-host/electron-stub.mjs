import { tmpdir } from 'node:os'

export const app = {
  getPath: () => tmpdir(),
  getAppPath: () => tmpdir()
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (value) => Buffer.from(String(value), 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8')
}

export const BrowserWindow = {
  getAllWindows: () => []
}

export const ipcMain = {
  handle: () => undefined
}

export default {
  app,
  safeStorage,
  BrowserWindow,
  ipcMain
}
