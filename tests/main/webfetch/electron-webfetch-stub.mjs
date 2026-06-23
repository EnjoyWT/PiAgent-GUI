export const windows = []
export const sessions = []

let nextJavaScriptResult = null

export const reset = () => {
  windows.length = 0
  sessions.length = 0
  nextJavaScriptResult = null
}

export const setNextJavaScriptResult = (value) => {
  nextJavaScriptResult = value
}

export const session = {
  fromPartition(partition) {
    const item = {
      partition,
      permissionHandler: null,
      setPermissionRequestHandler(handler) {
        this.permissionHandler = handler
      }
    }
    sessions.push(item)
    return item
  }
}

export class BrowserWindow {
  constructor(options) {
    this.options = options
    this.destroyed = false
    this.visible = false
    this.currentUrl = ''
    this.openHandler = null
    this.webContents = {
      setWindowOpenHandler: (handler) => {
        this.openHandler = handler
      },
      executeJavaScript: async () => nextJavaScriptResult,
      getURL: () => this.currentUrl,
      on: () => {},
      once: () => {}
    }
    windows.push(this)
  }

  async loadURL(url) {
    this.currentUrl = url
  }

  show() {
    this.visible = true
  }

  focus() {}

  isVisible() {
    return this.visible
  }

  isDestroyed() {
    return this.destroyed
  }

  destroy() {
    this.destroyed = true
  }

  on() {}
}

export default {
  BrowserWindow,
  session
}
