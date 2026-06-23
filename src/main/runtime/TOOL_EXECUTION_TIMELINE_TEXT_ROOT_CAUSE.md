# ToolExecutionTimeline 文本切分问题：根因与修复方向

## 目标（期望 UI）

在对话中，工具调用过程的展示顺序应稳定为：

1. 「解释文字」（工具调用前）
2. 换行
3. 「工具调用/工具步骤」（可展开/可见详情）
4. 换行
5. 「解释文字」（工具调用后；或下一段工具前后解释，取决于模型输出）
6. 最终「正文」（在消息正文区域单独显示）

同时：中间过程不应出现“解释文字 X 被重复显示两次”，也不应出现“中间过程错、最终正文看起来又被替换”的错位现象。

## 现象（当前观测到的 bug）

复现后会出现如下状态：

- 中间过程显示为：`解释文字1 -> 换行 -> 工具调用 -> 换行 -> 解释文字1`
- 但最终正文区域呈现为：最后一个“解释文字1”会被其他文字替换掉
- 即：**中间过程与最终正文的内容边界不一致**，并且出现重复前缀/错位。

## 关键链路（数据如何走到 UI）

1. 运行时投影（runtime）构建 `run.turns[*].text` 与 `run.turns[*].toolCalls`
2. 结束时将 `run.turns` 写入数据库 `agent_runs.turns_json`
3. 历史加载时从 `agent_runs.turns_json` 反序列化为 `run.turns`
4. `ToolExecutionTimeline.vue` 按 `run.turns` 渲染：
   - `turn.text` -> 时间线里的“解释文字段”
   - `turn.toolCalls` -> 工具步骤（可展开）
5. 正文（正文区域）由 `run.text` / `assistant.content` 流式更新展示

## 根本原因（推测并已定位到的投影语义不一致）

`run-projector.ts` 中，`turn.text` 的语义并不等价于“该 turn 的增量片段”。它更像是**可能包含累计前缀的聚合文本**，并且会在不同事件时被覆盖/回填，导致：

- 时间线按 turn 顺序渲染时，把“累计文本里复述的前缀”当成了新片段重复展示；
- 后续流式事件/覆盖逻辑又会把正文更新为最终正确内容；
- 因此出现“中间态显示错 + 最终正文被替换”的错位。

### 证据点 A：流式增量追加到 turn.text（可能形成累计态）

文件：`src/main/runtime/run-projector.ts`

位置：`onMessageDelta`（类似 281-300）

逻辑要点（摘要）：

- `delta` 会追加到 `message.text`
- 若存在 `turn`，也会追加到 `turn.text`
- 同时 `run.text` 会指向 `turn?.text` 或 `message.text`

影响：

- 若某些 turn 的生成/关联是 inferred/回填型，`turn.text` 可能并非稳定的“增量段”。

### 证据点 B：onTurnFinished 在 turn.text 为空时回填 assistantText（可能把累计文本塞回 turn）

文件：`src/main/runtime/run-projector.ts`

位置：`onTurnFinished`（类似 397-424）

逻辑要点（摘要）：

- `assistantText = extractAssistantTextFromAgentMessage(...)`
- 若 `assistantText` 存在且 `!turn.text.trim()`：
  - `turn.text = assistantText`
  - `run.text = assistantText`
  - 并可能同步更新 `run.messages.at(-1).text`

影响：

- `assistantText` 在很多 runtime 实现里更接近“完整累计 assistant 文本”；
- 一旦把它塞进某个 turn，就会导致该 turn 文本包含此前前缀；
- 当时间线渲染时，前缀会被认为是新的解释片段，从而出现重复展示。

## 已做的尝试（用于说明接手 AI 的上下文）

### 1) 前端 `ToolExecutionTimeline.vue` 的尝试（不稳定原因）

- 通过 `turn.text` 切片/去重（startsWith 剔除前缀）
- 仅渲染 `turn.status === done/error` 的文本
- 结果：仍然可能出现中间态重复/错位

原因（推测）：

- 问题并不只是“重复前缀字符串匹配”，而是投影层的 turn.text 边界语义不稳定（累计/回填/overlap）。

### 2) 后端根修复尝试（部分落地，但仍未完全证明正确）

- 在 `onTurnFinished` 中新增 `diffAppendText(prev, next)`：
  - 目的：当 turn.text 为空时，不再直接用 `assistantText` 覆盖 turn.text，
  - 而是从 `assistantText` 中剔除与 `prev run.text` 的重叠，尝试只保留增量。

目前用户反馈仍“还是显示不正确”，因此推断该增量剔除仍无法完全覆盖真实的 turn 语义边界问题。

## 建议的真正“根本修复方向”（给其他 AI 的 actionable points）

要从根本上修复，需要让 `turn.text` 在投影层具有**明确语义**：

### 方向 A（推荐）：给每个 turn 记录开始时 run.text 的基准长度

在 `onTurnStarted` 或首次收到该 turn 关联事件时记录：

- `turn.startRunTextLength = run.text.length`（或 run.text 的快照）

然后在：

- `onMessageDelta`：当 delta 属于某个 turn 时追加到该 turn 的 segment（而不是把累计 run.text 复写给 turn.text）
- `onTurnFinished`：若需要回填，应该只生成从 `startRunTextLength` 到最终文本末尾的 segment

最终：`turns_json` 持久化时保存的是“segment”，而不是累计文本。

### 方向 B：按工具边界切分“解释文本”

若模型遵循固定模式“工具前解释/工具调用/工具后解释”，可以：

- 用 `agent.tool.started/finished` 的时序确定文本段落边界；
- 将 `agentMessageDelta` 的累计文本切成多个 segment：工具前、工具后、下一个工具前等；
- segment 与工具调用一一关联（例如通过时间戳/相关字段 correlationId/traceId）。

### 验证手段（强烈建议加日志/断言）

建议在 projector 层临时打印或记录（可加入 dev-only）：

- 每次 `onTurnStarted/onMessageDelta/onTurnFinished` 时：
  - `turn.agentTurnId`
  - `turn.status`
  - `turn.text.length`（以及截断的 text 前 80 字符）
  - `run.text.length`
- 对比时间线渲染的段落与正文的段落是否对应同一切分点。

## 测试用例（建议用于回归验证）

1. 使用规则：模型先输出“解释文字”（工具前），再调用工具，再输出后续解释
2. 至少触发一次工具调用
3. 复现“解释文字1 -> 工具调用 -> 解释文字1”的具体场景
4. 验证：
   - 时间线中解释片段不应出现重复同一段前缀
   - 最终正文与时间线顺序/内容边界一致
   - 历史回放也一致（使用同一线程/同一 run）
