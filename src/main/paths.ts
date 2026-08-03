import os from 'node:os'
import path from 'node:path'
import { getAgentDir as getPiCodingAgentDir } from '@earendil-works/pi-coding-agent'

const APP_DIRNAME = 'piagent'

export const getConfigHome = (): string => {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  if (xdg) return xdg

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim()
    if (appData) return appData
    return path.join(os.homedir(), 'AppData', 'Roaming')
  }

  return path.join(os.homedir(), '.config')
}

export const getDefaultAppConfigDir = (): string => path.join(getConfigHome(), APP_DIRNAME)

export const getLegacyAppConfigDir = (): string => path.join(os.homedir(), '.piagent')

export const getDefaultSkillsDir = (): string => path.join(getDefaultAppConfigDir(), 'skills')

export const getLegacySkillsDir = (): string => path.join(getLegacyAppConfigDir(), 'skills')

export const getDefaultPluginsDir = (): string => path.join(getDefaultAppConfigDir(), 'plugins')

export const getDefaultPluginDataDir = (): string =>
  path.join(getDefaultAppConfigDir(), 'plugin-data')

export const getDefaultSharedSkillsDir = (): string => path.join(os.homedir(), '.agents', 'skills')

/** PiAgent app-owned agent dir (auth/models for GUI ModelRuntime). */
export const getDefaultAgentDir = (): string => path.join(getDefaultAppConfigDir(), 'agent')

export const getLegacyAgentDir = (): string => path.join(getLegacyAppConfigDir(), 'agent')

/**
 * pi-mono coding-agent config dir (default ~/.pi/agent, overridable via PI_CODING_AGENT_DIR).
 * Used for SettingsManager, DefaultResourceLoader, and createAgentSession resource discovery.
 */
export const getPiMonoAgentDir = (): string => getPiCodingAgentDir()

export const getPreferredAppConfigDir = (): string => {
  // This app only uses the XDG config location.
  return getDefaultAppConfigDir()
}
