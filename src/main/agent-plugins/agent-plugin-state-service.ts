import type Database from 'better-sqlite3'
import { ensureAgentPluginStateSchema } from './agent-plugin-state-db.ts'

export type AgentPluginComponentType =
  | 'skills'
  | 'mcpServers'
  | 'tools'
  | 'extensions'
  | 'commands'
  | 'agents'
  | 'hooks'

export type AgentPluginStateSnapshot = {
  pluginId: string
  enabled: boolean
}

export type AgentPluginComponentStateSnapshot = {
  pluginId: string
  componentType: AgentPluginComponentType
  componentId: string
  enabled: boolean
}

type AgentPluginStateRow = {
  plugin_id: string
  enabled: number
}

type AgentPluginComponentStateRow = {
  plugin_id: string
  component_type: AgentPluginComponentType
  component_id: string
  enabled: number
}

const DEFAULT_ENABLED_COMPONENT_TYPES = new Set<AgentPluginComponentType>(['skills'])

const normalizePluginId = (pluginId: string): string => {
  const normalized = String(pluginId ?? '').trim()
  if (!normalized) throw new Error('pluginId is required')
  return normalized
}

const normalizeComponentId = (componentId: string): string => {
  const normalized = String(componentId ?? '').trim()
  if (!normalized) throw new Error('componentId is required')
  return normalized
}

const normalizeComponentType = (componentType: string): AgentPluginComponentType => {
  if (
    componentType !== 'skills' &&
    componentType !== 'mcpServers' &&
    componentType !== 'tools' &&
    componentType !== 'extensions' &&
    componentType !== 'commands' &&
    componentType !== 'agents' &&
    componentType !== 'hooks'
  ) {
    throw new Error(`Unsupported agent plugin component type: ${componentType}`)
  }
  return componentType
}

export class AgentPluginStateService {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    ensureAgentPluginStateSchema(this.db)
  }

  isPluginEnabled(pluginId: string): boolean {
    const normalizedPluginId = normalizePluginId(pluginId)
    const row = this.db
      .prepare('SELECT plugin_id, enabled FROM agent_plugins WHERE plugin_id = ?')
      .get(normalizedPluginId) as AgentPluginStateRow | undefined

    return row ? row.enabled === 1 : true
  }

  setPluginEnabled(pluginId: string, enabled: boolean): AgentPluginStateSnapshot {
    const normalizedPluginId = normalizePluginId(pluginId)
    this.db
      .prepare(
        `INSERT INTO agent_plugins (plugin_id, enabled, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(plugin_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(normalizedPluginId, enabled ? 1 : 0)

    return {
      pluginId: normalizedPluginId,
      enabled
    }
  }

  isComponentEnabled(
    pluginId: string,
    componentType: AgentPluginComponentType,
    componentId: string
  ): boolean {
    const normalizedPluginId = normalizePluginId(pluginId)
    if (!this.isPluginEnabled(normalizedPluginId)) return false

    const normalizedType = normalizeComponentType(componentType)
    const normalizedComponentId = normalizeComponentId(componentId)
    const row = this.db
      .prepare(
        `SELECT plugin_id, component_type, component_id, enabled
         FROM agent_plugin_components
         WHERE plugin_id = ? AND component_type = ? AND component_id = ?`
      )
      .get(normalizedPluginId, normalizedType, normalizedComponentId) as
      | AgentPluginComponentStateRow
      | undefined

    return row ? row.enabled === 1 : DEFAULT_ENABLED_COMPONENT_TYPES.has(normalizedType)
  }

  setComponentEnabled(
    pluginId: string,
    componentType: AgentPluginComponentType,
    componentId: string,
    enabled: boolean
  ): AgentPluginComponentStateSnapshot {
    const normalizedPluginId = normalizePluginId(pluginId)
    const normalizedType = normalizeComponentType(componentType)
    const normalizedComponentId = normalizeComponentId(componentId)
    this.db
      .prepare(
        `INSERT INTO agent_plugin_components
           (plugin_id, component_type, component_id, enabled, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(plugin_id, component_type, component_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(normalizedPluginId, normalizedType, normalizedComponentId, enabled ? 1 : 0)

    return {
      pluginId: normalizedPluginId,
      componentType: normalizedType,
      componentId: normalizedComponentId,
      enabled
    }
  }

  listComponentStates(pluginId: string): AgentPluginComponentStateSnapshot[] {
    const normalizedPluginId = normalizePluginId(pluginId)
    const rows = this.db
      .prepare(
        `SELECT plugin_id, component_type, component_id, enabled
         FROM agent_plugin_components
         WHERE plugin_id = ?
         ORDER BY component_type ASC, component_id ASC`
      )
      .all(normalizedPluginId) as AgentPluginComponentStateRow[]

    return rows.map((row) => ({
      pluginId: row.plugin_id,
      componentType: row.component_type,
      componentId: row.component_id,
      enabled: row.enabled === 1
    }))
  }
}
