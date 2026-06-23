---
name: database-cleanup
description: 清理 当前程序 数据库中的 event_log 和 context_entries 表，防止数据库无限膨胀。当用户提到数据库清理、event_log 太大、磁盘空间不足、数据库维护、清理日志时使用此 skill。删除指定会话时.
allowed-tools:
  - Bash
  - Read
---

# Database Cleanup

清理 PiAgent 的 `core-v2.db` (event_log) 和 `context.db` (context_entries) 数据库。

## 问题背景

PiAgent 有两个主要数据库：

- `core-v2.db` - 包含 `event_log` 表，记录所有运行时事件
- `context.db` - 包含 `context_entries` 表，记录上下文条目

这些表没有自动清理机制，会无限增长。

**数据库路径 (macOS)**:

- `~/Library/Application Support/piagent/core-v2.db`
- `~/Library/Application Support/piagent/context.db`

## CLI 命令

### 查看统计信息

```bash
piagent db stats [--json]
```

### 清理旧数据

```bash
piagent db clean [选项]
```

**选项**:

- `--days <n>` - 保留天数 (默认: 30)
- `--dry-run` - 仅预览，不实际删除
- `--event-only` - 仅清理 event_log
- `--context-only` - 仅清理 context.db
- `--json` - 输出 JSON 格式

**示例**:

```bash
# 预览将删除的内容
piagent db clean --days 7 --dry-run

# 清理 30 天前的数据
piagent db clean --days 30

# 仅清理 event_log
piagent db clean --event-only --days 14
```

### 压缩数据库

```bash
piagent db vacuum [选项]
```

**选项**:

- `--event-only` - 仅压缩 core-v2.db
- `--context-only` - 仅压缩 context.db
- `--json` - 输出 JSON 格式

### 列出线程

```bash
piagent db threads [--workspace <path>] [--json]
```

**示例**:
```bash
# 列出所有线程
piagent db threads

# 列出指定工作区的线程
piagent db threads --workspace /path/to/workspace

# JSON 格式输出
piagent db threads --json
```

### 删除线程

```bash
piagent db delete-thread --thread <threadId> [--dry-run] [--json]
```

**示例**:
```bash
# 预览将删除的线程
piagent db delete-thread --thread abc123 --dry-run

# 删除线程
piagent db delete-thread --thread abc123
```

**注意**: 删除线程会同时清理:
- core-v2.db 中的 conversation、event_log、agent_runs 等
- context.db 中的 context_entries、context_compactions 等

### 删除工作区下的所有线程

```bash
piagent db delete-workspace --path <workspacePath> [--dry-run] [--json]
```

**示例**:
```bash
# 预览将删除的线程
piagent db delete-workspace --path /path/to/workspace --dry-run

# 删除工作区下的所有线程
piagent db delete-workspace --path /path/to/workspace
```

## 快速诊断

### 1. 查看数据库统计

```bash
piagent db stats
```

输出示例：

```
=== core-v2.db event_log 统计 ===
总记录数: 15234
最早记录: 2026-01-15 08:30:00
最新记录: 2026-05-15 14:20:00

=== context.db 统计 ===
context_entries: 8923 条
context_compactions: 45 条
活跃线程: 12 个
```

### 2. 检查数据库文件大小

```bash
ls -lh ~/Library/Application\ Support/piagent/*.db
```

## 推荐清理策略

### 保守策略 (每周)

```bash
# 保留最近 30 天的数据
piagent db clean --days 30
```

### 激进策略 (磁盘空间不足时)

```bash
# 保留最近 7 天的数据
piagent db clean --days 7

# 压缩数据库释放空间
piagent db vacuum
```

### 仅清理 event_log (推荐)

event_log 通常占空间最大，可以频繁清理：

```bash
piagent db clean --event-only --days 14
```

## 定期维护

### 使用 cron 自动清理

```bash
# 编辑 crontab
crontab -e

# 添加：每周日凌晨 3 点清理 30 天前的数据
0 3 * * 0 piagent db clean --days 30 >> /tmp/piagent-cleanup.log 2>&1
```

### 使用 PiAgent scheduled task

```javascript
scheduledTaskTool({
  action: 'create_task',
  task: {
    name: 'database-cleanup',
    prompt: '执行数据库清理: piagent db clean --days 30',
    schedule: '0 3 * * 0',
    description: '定期清理 event_log 和 context_entries'
  }
})
```

## 删除项目时的自动清理

从代码更新后，删除项目/对话时会自动清理关联的：

- `event_log` 记录 (conversation + agent_run 类型)
- `context_entries` 记录
- `context_compactions` 记录

无需手动干预。

## 直接使用 SQLite

如果需要更精细的控制：

```bash
DB="$HOME/Library/Application Support/piagent/core-v2.db"

# 查看 event_log 按类型统计
sqlite3 "$DB" ".headers on" ".mode column" \
  "SELECT event_type, COUNT(*) as count
   FROM event_log
   GROUP BY event_type
   ORDER BY count DESC;"

# 手动删除 30 天前的记录
sqlite3 "$DB" \
  "DELETE FROM event_log WHERE created_at < datetime('now', '-30 days');"

# 压缩数据库
sqlite3 "$DB" "VACUUM;"
```

## 故障排除

### 问题: 清理后数据库大小没变

**原因**: SQLite 删除记录不会自动回收空间。

**解决**: 使用 `piagent db vacuum` 压缩数据库。

### 问题: 清理后应用变慢

**原因**: 首次查询需要重建索引。

**解决**: 等待几分钟，或重启应用。

### 问题: 误删了需要的数据

**预防**: 始终先使用 `--dry-run` 预览。

## 相关代码位置

- CLI 模块: `src/main/cli/modules/database-cleanup-cli-module.ts`
- CLI 注册: `src/main/cli/cli-registry.ts`
- 删除对话清理: `src/main/core-v2/sqlite-core-service.ts` - `deleteConversation()`
- 删除线程清理: `src/main/core-v2/local-thread-host.ts` - `deleteThread()`
- ContextStore: `src/main/context/context-store.ts` - `deleteThread()`
