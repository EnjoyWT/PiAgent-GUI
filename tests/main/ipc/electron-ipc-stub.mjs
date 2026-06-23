import { tmpdir } from 'node:os'

export const app = {
  getPath: () => tmpdir()
}

export const ipcMain = {
  handle() {
    return undefined
  }
}

export class BrowserWindow {
  static getAllWindows() {
    return []
  }
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (value) => Buffer.from(String(value), 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8')
}

export const shell = {
  openPath: async () => ''
}

export default {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell
}
