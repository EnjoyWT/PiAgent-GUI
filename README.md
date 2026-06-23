# PiAgent-GUI

PiAgent-GUI 是一个面向个人工作流的 AI Agent 桌面客户端，基于 Electron、Vue 3 和 TypeScript 构建。它把本地编码 Agent、会话管理、IM 接入、插件系统、长期记忆和任务调度放在同一个桌面界面里，目标是让 AI 不只停留在聊天窗口，而是成为可以持续接收消息、调用工具、记住上下文并处理任务的本地工作台。

底层 Agent Runtime 基于 pi-mono 做了定制维护，并以 `@enjoywt/*` 包的形式接入。本项目并不是直接依赖原版 pi-mono，而是使用适配了 GUI、IM、多工具运行和插件集成需求的 fork。

项目当前处于快速迭代阶段，适合开发者试用、二次开发和集成自己的 Agent / IM / MCP / 插件能力。

## 界面预览

![PiAgent-GUI chat workspace](assets/screenshots/chat-workspace.png)

![PiAgent-GUI provider settings](assets/screenshots/provider-settings.png)

## 来源与致谢

- UI 层高度借鉴 AlMA 的桌面 Agent 交互和视觉结构，包括会话布局、工具执行呈现、队列状态和运行过程可视化。本项目的 UI 不是从零原创设计，而是在 AlMA 方向上做了 PiAgent-GUI 所需的工程化适配。
- 底层 Agent Runtime 基于 pi-mono 的定制 fork，当前以 `@enjoywt/*` 包接入，包含包名、构建方式和部分运行时适配。
- IM 接入和消息路由能力参考 OpenClaw、Hermes 这类多入口 Agent 架构思路，让 Agent 可以从本地窗口以外接收任务。
- 记忆系统参考 Memos 的信息沉淀方式，把对话里的事实、偏好、项目状态和证据逐步整理成可检索的长期记忆。
- 插件和工具层尽量兼容主流 Agent 生态，包括 MCP、技能目录、外部插件、传输插件和自定义工具。

## 核心能力

### 本地 Agent 桌面端

- 基于工作目录创建对话，让每个会话绑定明确的项目上下文。
- 支持流式回复、工具调用时间线、运行状态、错误状态和中断控制。
- 内置 read、write、edit、bash、grep、find、ls 等编码工具。
- 支持图片输入、文件上下文、计划状态、子 Agent 面板和运行事件调试。

### IM 与多入口接入

- 内置 IM runtime、消息 envelope 标准化、会话路由、投递策略和诊断工具。
- 支持通过 transport plugin 扩展不同 IM 或外部消息来源。
- 同一套运行时可以处理本地聊天、IM 消息、计划任务和插件触发的请求。

### 记忆系统

- 本地 SQLite 存储知识实体、事实 claim、证据引用、关系和反思记录。
- 支持从对话和运行结果中抽取记忆，并在后续上下文中检索注入。
- 提供知识搜索、trace、整理、去重、归档和 profile 生成等能力。
- 支持本地 embedding 引擎，用于语义检索和记忆召回。

### 插件与工具生态

- 支持 MCP server 配置和运行时接入。
- 支持外部 agent plugin、transport plugin、内置技能和项目级技能。
- 提供插件发现、启用/禁用、账号配置、资源解析和插件状态管理。
- 内置 web fetch、web search、computer use、system doctor、scheduled task 等工具入口。

### 自动化与任务

- 支持 scheduled tasks，把 Agent 运行从一次聊天扩展为持续任务。
- 支持队列、暂停、批量发送、自动续跑和运行完成通知。
- 支持运行事件、runtime inspector、delivery record 和 core-v2 读模型，便于调试复杂任务链路。

## 技术栈

- 桌面框架：Electron
- 前端框架：Vue 3
- 语言：TypeScript
- 构建：electron-vite、Vite、Rolldown
- 样式：Tailwind CSS
- 本地存储：SQLite / better-sqlite3
- Agent Runtime：基于 pi-mono 定制的 `@enjoywt/pi-ai`、`@enjoywt/pi-agent-core`、`@enjoywt/pi-coding-agent`
- 插件协议：MCP、自定义 Agent Plugin、自定义 Transport Plugin

## 项目结构

```text
src/
  main/
    core-v2/          本地会话、消息、运行记录和读模型
    runtime-host/     Agent runtime host、工具层、运行表面
    im/               IM envelope、路由、交互和诊断
    transport/        外部消息传输 host 和内置 transport
    plugin-system/    插件发现、状态、账号和资源解析
    agent-plugins/    Agent 插件管理
    mcp/              MCP server 配置和运行时管理
    knowledge/        长期记忆、抽取、检索、整理和 embedding
    scheduled-tasks/  定时任务
    subagents/        子 Agent 任务和 worker host
    computer-use/     Computer Use 辅助能力
    tools/            内置工具实现
  preload/            Electron context bridge
  renderer/src/       Vue UI、聊天界面、设置、知识窗口和运行状态
resources/
  skills/             内置技能
  bin/                CLI 启动脚本
  computer-use-helper/Computer Use helper
tests/
  main/               主进程和服务测试
  renderer/           渲染层逻辑测试
  e2e/                Electron e2e 测试
```

## 安装与开发

需要 Node.js 22+ 和 pnpm。

```bash
pnpm install
pnpm dev
```

类型检查：

```bash
pnpm run typecheck
```

构建：

```bash
pnpm run build
```

平台打包：

```bash
pnpm run build:mac
pnpm run build:win
pnpm run build:linux
```

## 关于 `@enjoywt/*` Git 依赖

本项目使用 `@enjoywt/pi-ai`、`@enjoywt/pi-agent-core`、`@enjoywt/pi-coding-agent` 作为 Agent runtime。这些包来自对 pi-mono 的定制 fork，包含了为 PiAgent-GUI 适配的包名、构建方式和部分运行时调整。

为了让公开仓库不依赖 GitHub Packages token，这些包通过 Git URL 安装，并在 `package.json` 的 `pnpm.overrides` 中固定到同一分支。

如果安装时提示 Git package 需要执行 build script，请确认 `pnpm-workspace.yaml` 中允许了以下包：

```yaml
onlyBuiltDependencies:
  - '@enjoywt/pi-ai'
  - '@enjoywt/pi-agent-core'
  - '@enjoywt/pi-coding-agent'
```

## 配置与数据

应用会在本机用户目录下保存运行数据、插件配置、会话记录、记忆数据库和技能文件。实际路径由运行时根据系统平台解析。

常见数据包括：

- 会话、消息和 Agent run 记录
- Provider 和模型配置
- MCP server 配置
- 插件状态与插件账号
- 知识库和 embedding 数据
- 计划任务和任务运行历史

## 当前状态

PiAgent-GUI 仍在开发中，很多能力已经具备完整模块和测试，但产品形态还在快速调整。欢迎围绕以下方向继续扩展：

- 更多 IM / 消息平台 transport (微信,飞书插件已经完成)
- 更完整的插件市场和插件安装体验
- 更强的长期记忆整理、可视化和人工审核
- 更稳定的多 Agent 协作和计划任务编排
- 更细的权限控制、沙箱和审计日志

## License

See [LICENSE](./LICENSE).
