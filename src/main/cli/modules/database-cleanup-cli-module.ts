import { createCliFailureResult } from '../cli-errors'
import type { CliExecuteRequest, CliExecuteResult } from '../cli-types'
import type { CliRegistry } from '../cli-registry'
import { getCoreV2Service, getCoreV2Db } from '../../core-v2/sqlite-db'
import { getContextDb } from '../../context/context-storage-db'
import { getLocalThreadHostService } from '../../core-v2/local-thread-host'
import { listLocalThreadRows } from '../../core-v2/local-thread-query'

// ============================================================
// 工具函数
// ============================================================

const parseNumberFlag = (request: CliExecuteRequest, key: string, defaultValue: number): number => {
  const value = request.flags?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return defaultValue
}

const parseBooleanFlag = (request: CliExecuteRequest, key: string): boolean => {
  const value = request.flags?.[key]
  return value === true || value === 'true' || value === 1
}

const asJsonResult = (data: unknown): CliExecuteResult => ({
  ok: true,
  exitCode: 0,
  stdout: JSON.stringify(data, null, 2),
  stderr: '',
  data
})

const asTextResult = (stdout: string, data?: unknown): CliExecuteResult => ({
  ok: true,
  exitCode: 0,
  stdout,
  stderr: '',
  data
})

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// ============================================================
// 核心功能
// ============================================================

const getEventLogStats = () => {
  const core = getCoreV2Service()
  return core.getEventLogStats()
}

const getContextStats = () => {
  const db = getContextDb()

  const entries = db.prepare('SELECT COUNT(*) as count FROM context_entries').get() as { count: number }
  const compactions = db.prepare('SELECT COUNT(*) as count FROM context_compactions').get() as { count: number }
  const threads = db.prepare('SELECT COUNT(*) as count FROM thread_context_heads').get() as { count: number }

  const dateRange = db.prepare(`
    SELECT MIN(created_at) as oldest, MAX(created_at) as newest
    FROM context_entries
  `).get() as { oldest: string | null; newest: string | null }

  return {
    entryCount: entries.count,
    compactionCount: compactions.count,
    threadCount: threads.count,
    oldestEntry: dateRange.oldest,
    newestEntry: dateRange.newest
  }
}

const cleanEventLog = (retentionDays: number, dryRun: boolean) => {
  const core = getCoreV2Service()

  if (dryRun) {
    const stats = core.getEventLogStats()
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoff = cutoffDate.toISOString()

    // 估算将删除的记录数（简化处理）
    return {
      deleted: 0,
      wouldDelete: stats.totalCount, // 实际应该查询 cutoff 之前的数量
      cutoff,
      dryRun: true
    }
  }

  const deleted = core.pruneOldEventLog(retentionDays)
  return {
    deleted,
    wouldDelete: 0,
    dryRun: false
  }
}

const cleanContextDb = (retentionDays: number, dryRun: boolean) => {
  const db = getContextDb()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
  const cutoff = cutoffDate.toISOString().replace('T', ' ').replace('Z', '')

  const entriesToDelete = db.prepare('SELECT COUNT(*) as count FROM context_entries WHERE created_at < ?').get(cutoff) as { count: number }
  const compactionsToDelete = db.prepare('SELECT COUNT(*) as count FROM context_compactions WHERE created_at < ?').get(cutoff) as { count: number }

  if (dryRun) {
    return {
      entriesDeleted: 0,
      compactionsDeleted: 0,
      wouldDeleteEntries: entriesToDelete.count,
      wouldDeleteCompactions: compactionsToDelete.count,
      dryRun: true
    }
  }

  let entriesDeleted = 0
  let compactionsDeleted = 0

  if (entriesToDelete.count > 0) {
    const result = db.prepare('DELETE FROM context_entries WHERE created_at < ?').run(cutoff)
    entriesDeleted = result.changes
  }

  if (compactionsToDelete.count > 0) {
    const result = db.prepare('DELETE FROM context_compactions WHERE created_at < ?').run(cutoff)
    compactionsDeleted = result.changes
  }

  return {
    entriesDeleted,
    compactionsDeleted,
    wouldDeleteEntries: entriesToDelete.count,
    wouldDeleteCompactions: compactionsToDelete.count,
    dryRun: false
  }
}

// ============================================================
// 命令处理
// ============================================================

const handleStats = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const isJson = parseBooleanFlag(request, 'json')

  try {
    const eventLogStats = getEventLogStats()
    const contextStats = getContextStats()

    const data = {
      eventLog: eventLogStats,
      context: contextStats
    }

    if (isJson) {
      return asJsonResult(data)
    }

    const lines: string[] = []
    lines.push('=== core-v2.db event_log 统计 ===')
    lines.push(`总记录数: ${eventLogStats.totalCount}`)
    lines.push(`最早记录: ${eventLogStats.oldestEntry || '无'}`)
    lines.push(`最新记录: ${eventLogStats.newestEntry || '无'}`)
    lines.push('')
    lines.push('=== context.db 统计 ===')
    lines.push(`context_entries: ${contextStats.entryCount} 条`)
    lines.push(`context_compactions: ${contextStats.compactionCount} 条`)
    lines.push(`活跃线程: ${contextStats.threadCount} 个`)
    lines.push(`最早记录: ${contextStats.oldestEntry || '无'}`)
    lines.push(`最新记录: ${contextStats.newestEntry || '无'}`)

    return asTextResult(lines.join('\n'), data)
  } catch (error) {
    return createCliFailureResult(5, `获取统计信息失败: ${getErrorMessage(error)}`)
  }
}

const handleClean = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const days = parseNumberFlag(request, 'days', 30)
  const dryRun = parseBooleanFlag(request, 'dry-run')
  const eventOnly = parseBooleanFlag(request, 'event-only')
  const contextOnly = parseBooleanFlag(request, 'context-only')
  const isJson = parseBooleanFlag(request, 'json')

  try {
    const result: Record<string, unknown> = {
      retentionDays: days,
      dryRun
    }

    if (!contextOnly) {
      result.eventLog = cleanEventLog(days, dryRun)
    }

    if (!eventOnly) {
      result.context = cleanContextDb(days, dryRun)
    }

    if (isJson) {
      return asJsonResult(result)
    }

    const lines: string[] = []
    lines.push(`保留天数: ${days}`)
    lines.push(`模式: ${dryRun ? '预览 (dry-run)' : '实际清理'}`)
    lines.push('')

    if (result.eventLog) {
      const el = result.eventLog as Record<string, unknown>
      lines.push('=== event_log 清理 ===')
      if (dryRun) {
        lines.push(`将删除约 ${el.wouldDelete} 条记录`)
      } else {
        lines.push(`已删除 ${el.deleted} 条记录`)
      }
      lines.push('')
    }

    if (result.context) {
      const ctx = result.context as Record<string, unknown>
      lines.push('=== context.db 清理 ===')
      if (dryRun) {
        lines.push(`将删除 context_entries: ${ctx.wouldDeleteEntries} 条`)
        lines.push(`将删除 context_compactions: ${ctx.wouldDeleteCompactions} 条`)
      } else {
        lines.push(`已删除 context_entries: ${ctx.entriesDeleted} 条`)
        lines.push(`已删除 context_compactions: ${ctx.compactionsDeleted} 条`)
      }
    }

    lines.push('')
    lines.push('清理完成！')

    return asTextResult(lines.join('\n'), result)
  } catch (error) {
    return createCliFailureResult(5, `清理失败: ${getErrorMessage(error)}`)
  }
}

const handleVacuum = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const eventOnly = parseBooleanFlag(request, 'event-only')
  const contextOnly = parseBooleanFlag(request, 'context-only')
  const isJson = parseBooleanFlag(request, 'json')

  try {
    const result: Record<string, unknown> = {}

    // VACUUM core-v2.db (event_log)
    if (!contextOnly) {
      const coreDb = getCoreV2Db()
      const sizeBefore = (coreDb.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as { size: number }).size
      coreDb.exec('VACUUM')
      const sizeAfter = (coreDb.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as { size: number }).size

      result.coreV2 = {
        sizeBefore,
        sizeAfter,
        freed: sizeBefore - sizeAfter
      }
    }

    // VACUUM context.db
    if (!eventOnly) {
      const db = getContextDb()
      const sizeBefore = (db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as { size: number }).size
      db.exec('VACUUM')
      const sizeAfter = (db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as { size: number }).size

      result.context = {
        sizeBefore,
        sizeAfter,
        freed: sizeBefore - sizeAfter
      }
    }

    if (isJson) {
      return asJsonResult(result)
    }

    const lines: string[] = []
    lines.push('数据库压缩完成！')
    lines.push('')

    if (result.coreV2) {
      const el = result.coreV2 as Record<string, number>
      lines.push(`core-v2.db: ${formatBytes(el.sizeBefore)} -> ${formatBytes(el.sizeAfter)} (释放 ${formatBytes(el.freed)})`)
    }

    if (result.context) {
      const ctx = result.context as Record<string, number>
      lines.push(`context.db: ${formatBytes(ctx.sizeBefore)} -> ${formatBytes(ctx.sizeAfter)} (释放 ${formatBytes(ctx.freed)})`)
    }

    return asTextResult(lines.join('\n'), result)
  } catch (error) {
    return createCliFailureResult(5, `压缩失败: ${getErrorMessage(error)}`)
  }
}

// ============================================================
// 线程管理命令
// ============================================================

const handleListThreads = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const isJson = parseBooleanFlag(request, 'json')
  const workspace = request.flags?.workspace as string | undefined

  try {
    let threads = listLocalThreadRows()

    if (workspace) {
      const normalizedWorkspace = workspace.trim()
      threads = threads.filter((t) => t.workspace_path === normalizedWorkspace)
    }

    const data = threads.map((t) => ({
      id: t.id,
      title: t.title,
      workspace: t.workspace_path,
      model: t.model,
      created_at: t.created_at,
      started_at: t.started_at
    }))

    if (isJson) {
      return asJsonResult(data)
    }

    if (data.length === 0) {
      return asTextResult('没有找到线程', data)
    }

    const lines: string[] = []
    lines.push(`共 ${data.length} 个线程:`)
    lines.push('')

    for (const thread of data) {
      lines.push(`ID: ${thread.id}`)
      lines.push(`  标题: ${thread.title || '无标题'}`)
      lines.push(`  工作区: ${thread.workspace || '无'}`)
      lines.push(`  模型: ${thread.model || '默认'}`)
      lines.push(`  创建时间: ${thread.created_at || '未知'}`)
      lines.push('')
    }

    return asTextResult(lines.join('\n'), data)
  } catch (error) {
    return createCliFailureResult(5, `获取线程列表失败: ${getErrorMessage(error)}`)
  }
}

const handleDeleteThread = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const threadId = request.flags?.thread as string | undefined
  const isJson = parseBooleanFlag(request, 'json')
  const dryRun = parseBooleanFlag(request, 'dry-run')

  if (!threadId) {
    return createCliFailureResult(2, '缺少必需参数: --thread <threadId>')
  }

  try {
    const threads = listLocalThreadRows()
    const thread = threads.find((t) => t.id === threadId)

    if (!thread) {
      return createCliFailureResult(4, `线程不存在: ${threadId}`)
    }

    const data = {
      threadId: thread.id,
      title: thread.title,
      workspace: thread.workspace_path,
      deleted: false,
      dryRun
    }

    if (dryRun) {
      if (isJson) {
        return asJsonResult(data)
      }

      const lines: string[] = []
      lines.push('[DRY RUN] 将删除以下线程:')
      lines.push(`  ID: ${thread.id}`)
      lines.push(`  标题: ${thread.title || '无标题'}`)
      lines.push(`  工作区: ${thread.workspace_path || '无'}`)
      return asTextResult(lines.join('\n'), data)
    }

    const host = await getLocalThreadHostService()
    host.deleteThread(threadId)
    data.deleted = true

    if (isJson) {
      return asJsonResult(data)
    }

    return asTextResult(`已删除线程: ${threadId} (${thread.title || '无标题'})`, data)
  } catch (error) {
    return createCliFailureResult(5, `删除线程失败: ${getErrorMessage(error)}`)
  }
}

const handleDeleteWorkspace = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const workspace = request.flags?.path as string | undefined
  const isJson = parseBooleanFlag(request, 'json')
  const dryRun = parseBooleanFlag(request, 'dry-run')

  if (!workspace) {
    return createCliFailureResult(2, '缺少必需参数: --path <workspacePath>')
  }

  try {
    const normalizedWorkspace = workspace.trim()
    const threads = listLocalThreadRows().filter(
      (t) => t.workspace_path === normalizedWorkspace
    )

    if (threads.length === 0) {
      return createCliFailureResult(4, `工作区下没有找到线程: ${normalizedWorkspace}`)
    }

    const data = {
      workspace: normalizedWorkspace,
      threadCount: threads.length,
      threads: threads.map((t) => ({ id: t.id, title: t.title })),
      deleted: false,
      dryRun
    }

    if (dryRun) {
      if (isJson) {
        return asJsonResult(data)
      }

      const lines: string[] = []
      lines.push(`[DRY RUN] 将删除工作区下的 ${threads.length} 个线程:`)
      lines.push(`  工作区: ${normalizedWorkspace}`)
      lines.push('')
      for (const thread of threads) {
        lines.push(`  - ${thread.id} (${thread.title || '无标题'})`)
      }
      return asTextResult(lines.join('\n'), data)
    }

    const host = await getLocalThreadHostService()
    for (const thread of threads) {
      host.deleteThread(thread.id)
    }
    data.deleted = true

    if (isJson) {
      return asJsonResult(data)
    }

    const lines: string[] = []
    lines.push(`已删除工作区下的 ${threads.length} 个线程:`)
    lines.push(`  工作区: ${normalizedWorkspace}`)
    for (const thread of threads) {
      lines.push(`  - ${thread.id} (${thread.title || '无标题'})`)
    }
    return asTextResult(lines.join('\n'), data)
  } catch (error) {
    return createCliFailureResult(5, `删除工作区线程失败: ${getErrorMessage(error)}`)
  }
}

// ============================================================
// 辅助函数
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// ============================================================
// 模块注册
// ============================================================

export const registerDatabaseCleanupCliModule = (registry: CliRegistry): void => {
  // 数据库清理
  registry.register('db', 'stats', handleStats)
  registry.register('db', 'clean', handleClean)
  registry.register('db', 'vacuum', handleVacuum)

  // 线程管理
  registry.register('db', 'threads', handleListThreads)
  registry.register('db', 'delete-thread', handleDeleteThread)
  registry.register('db', 'delete-workspace', handleDeleteWorkspace)
}
