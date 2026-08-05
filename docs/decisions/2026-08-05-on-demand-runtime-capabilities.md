# 按需运行时能力架构

日期：2026-08-05
状态：已确认，待实施

## 背景

当前本地对话运行时会把大量内置工具、MCP 工具、插件工具和 Skill 元数据预先暴露给模型。一次仅包含 `hi` 的新会话仍出现约 16.6k 输入 token，其中主要不是对话历史，而是系统提示词、全量工具 schema 和 Skill 元数据。这会增加模型 prefill 和首 token 延迟。

对话框中的 MCP 选择入口当前也承担了“预加载并暴露 MCP 工具”的角色，使 UI 选择直接扩大每次模型请求的工具集。

## 决策

采用“能力目录 + 按需激活”架构：模型首轮只获得固定核心工具、能力搜索工具、能力激活工具和 Skill 读取工具；其他能力只在模型搜索并请求启用后，才进入当前运行时的 active tool allowlist。

对话框移除 MCP 选择入口。MCP 的安装、工作区绑定和授权继续在工作区/设置层管理；它们决定模型可发现的候选范围，但不再决定首轮 prompt 中出现的 schema。

## 约束与事实

- `pi-coding-agent` 的 `setActiveToolsByName(names)` 支持在 session 存活期间切换已注册工具。它更新 `agent.state.tools` 和系统提示词，并在下一次 agent step 生效。
- 该 API 只能激活已经注册到 session registry 的工具；不能在一个正在流式返回的模型请求中插入未知工具。
- 因此，内置工具、已加载插件和已获取 schema 的工作区 MCP 工具可预注册但保持 inactive。它们不进入初始模型工具列表。
- 对尚未加载 schema 的远程 MCP，首次激活需要受控连接、获取 schema、校验后才可使用；不能伪装为即时可用。
- 任何工具集变化只允许发生在 agent step 边界，禁止在流式输出中修改 active tool 集合。

## 能力模型

### 能力注册表

注册表是运行时内部的完整能力目录，不直接注入模型 prompt。每个条目至少包含：

- `id`、`name`、`kind`（tool、skill、mcp、plugin）
- `label`、简短描述、tags、来源、适用 surface
- 可用状态（active、discoverable、blocked、provisioning）与不可用原因
- 权限等级、依赖能力、版本和 schema token 估算
- 完整工具定义或 Skill 内容的本地引用

搜索结果只返回必要的轻量元数据，默认不返回完整参数 schema。

### 会话能力状态

每个 agent session 持有独立的能力状态：

- 固定核心能力
- 本 run 已激活能力
- 显式固定的短期 lease
- revision、激活时间、最后使用时间和 token 预算

状态变更以 revision 串行化。旧 run、取消请求或异步 MCP 初始化都不能覆盖较新的 revision。

## 核心工具集

默认常驻的本地 coding profile 为：

- 文件与代码基本操作：读取、查找、命令、编辑、写入
- `capabilitySearch`：搜索工具、Skill、MCP 和插件能力
- `capabilityActivate`：请求启用已发现的能力
- `readSkillTool`：读取已发现 Skill 的完整指令
- 必须的运行时协调工具，例如任务计划

网页访问、计算机控制、定时任务、IM、系统诊断、密钥交互、子代理、插件和 MCP 工具默认不 active。

系统提示词只说明按需能力协议：需要非核心能力时先搜索、再激活、最后调用；不再列出全量工具或全量 Skill。

## 调用流程

1. 模型判断核心能力不足，调用 `capabilitySearch(query)`。
2. 服务端在完整注册表中检索，返回少量候选及其用途、来源、权限和可用状态。
3. 模型调用 `capabilityActivate(capabilityIds, reason)`。
4. 服务端校验候选仍有效、当前 workspace/surface 可用、依赖完整、权限满足、预算未超限。
5. 服务端原子合并 `core + existing lease + requested`，调用 `session.setActiveToolsByName(...)`，更新 revision 和投影。
6. 激活工具返回结果。pi-mono 在下一次 agent step 将新工具 schema 发送给模型。
7. 模型调用已激活的实际工具。

搜索不等于授权，激活也不等于绕过工具本身的用户确认策略。

## Skill 策略

- Skill 不再以全量 metadata 注入系统提示词。
- 搜索命中 Skill 后，模型通过 `readSkillTool` 读取正文。
- Skill 内容是任务资料，不得提升优先级或覆盖应用安全策略、用户意图和沙箱限制。
- 第三方或工作区 Skill 必须携带信任来源；涉及外部写入、网络、密钥或系统操作时继续走既有确认机制。
- 已读 Skill 默认只在当前 run 生效，不作为永久上下文驻留。

## MCP 与插件策略

### 工作区授权

工作区/设置层继续负责 MCP 的安装、连接配置、绑定和用户授权。只有已绑定且已授权的 MCP 才能出现在能力搜索结果中。

### 已注册能力

内置工具、已加载插件、已缓存并验证 schema 的 MCP 工具在创建 session 时注册到 pi-mono，但默认 inactive。注册本身不使 schema 进入模型请求。

### 首次远程能力加载

当 MCP 尚无可验证的本地 schema 时，目录只能标记为 `provisioning` 或 `blocked`。激活路径负责连接、列举工具、校验身份和缓存 schema。若底层无法把新增定义安全注册到当前 session，本 run 返回可解释的不可用结果，并在下一次安全 session 边界注册；绝不在流式中重建会话。

## 生命周期与预算

- 默认激活范围为当前 run；run 结束后回到 core-only。
- 同一 run 的多次 agent step 共享 active 集合。
- 仅当用户明确固定，或任务计划仍处于进行状态时，允许少量能力 lease 跨 turn 保留。
- lease 有工具数和 schema token 上限；超过上限时回收最久未使用的非核心能力。
- 取消、切换 workspace 或删除对话时，丢弃未持久化 lease 并释放对应远程资源。

默认不自动跨 turn 保留外部工具，保证普通聊天在任何时刻都不会因旧任务工具而回到全量 prompt。

## 并发与错误处理

- 每个 session 的能力状态变更串行执行。
- 激活仅在 `capabilityActivate` 工具调用中发生，不能由 UI 或后台任务直接改变正在执行的 run。
- 搜索结果过期、依赖缺失、权限不足、MCP 离线或初始化超时，均返回结构化失败原因；模型可选择替代方案或向用户说明。
- 失败时不得自动升级为全量启用。
- 删除会话必须先停止 runtime，随后释放 capability 状态和远程连接，禁止后续回写对话事件。
- 只持久化小型能力生命周期事件/投影，绝不持久化完整 schema、Skill 正文或内部 delta。

## MCP 选择入口

移除对话输入框中的 MCP 选择入口，因为它不再是 runtime 工具开关。

可保留工作区设置中的 MCP 管理入口，用于配置、绑定、授权、健康状态和删除。若未来确有高级需求，可增加“固定本 run 的能力”入口，但它必须是显式 pin 行为，不得默认预加载全部 MCP schema。

## 可观测性与验收

为每个 run 记录 prompt token 分解：

- 基础系统提示词
- 对话历史与用户输入
- 记忆注入
- 核心工具 schema
- 动态激活工具 schema
- Skill 内容
- MCP / 插件 schema

验收条件：

1. 新会话普通聊天不含非核心工具 schema 和全量 Skill metadata。
2. 搜索前模型不能调用隐藏工具；激活后下一次 agent step 能调用该工具。
3. 活动工具集在取消、并发 follow-up、删除会话和 workspace 切换后不泄漏。
4. MCP 未被使用时不把 schema 注入模型请求；不可用 MCP 有明确失败路径。
5. 消息 UI 和 run/turn 投影不因能力状态更新重复、消失或延迟。
6. 首轮 prompt token 和 TTFT 以 instrumentation 量化，相对当前约 16.6k 输入 token 有显著、稳定下降。

## 实施顺序

1. 增加 token 分解与能力状态观测，不改变默认行为。
2. 引入完整能力注册表与 core-only resolver，保留现有工具实现。
3. 将现有 discovery 升级为全量可发现目录，并新增受控 activation 工具。
4. 接入 session active allowlist、生命周期、revision 和回收策略。
5. 调整 Skill 注入策略和 MCP 预注册/延迟 provisioning。
6. 移除对话框 MCP 选择入口，将授权保留在工作区设置。
7. 用 feature flag 灰度切换，补齐单元、集成、竞态和 token 回归测试。
