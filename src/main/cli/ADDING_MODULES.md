# Adding CLI Modules

这份说明只回答一件事：以后如果你要新增一个 `piagent <module> <action>`，应该怎么接。

## 心智模型

当前结构分两层：

1. `src/main/http/`
   负责本地 HTTP 服务本身
2. `src/main/cli/`
   负责 CLI 协议、路由和模块注册

也就是说：

- 本地 HTTP 服务不是 CLI 专用
- CLI 只是挂在这个本地 HTTP 服务上的一组路由

## 当前入口

命令入口统一为：

```bash
piagent <module> <action> [args...] [--json]
```

HTTP 入口统一为：

```text
POST /v1/cli/execute
```

## 目录约定

新增 CLI 模块时，只需要关注：

```text
src/main/cli/
  cli-types.ts
  cli-errors.ts
  cli-http-routes.ts
  cli-registry.ts
  modules/
```

## 新增一个 action 的步骤

假设你要新增：

```bash
piagent hello ping
```

### 1. 新建模块文件

在 `src/main/cli/modules/` 下新增：

```text
hello-cli-module.ts
```

推荐结构：

```ts
import type { CliRegistry } from '../cli-registry'

export const registerHelloCliModule = (registry: CliRegistry): void => {
  registry.register('hello', 'ping', async () => ({
    ok: true,
    exitCode: 0,
    stdout: 'pong',
    stderr: '',
    data: { message: 'pong' }
  }))
}
```

### 2. 在 registry 中注册

编辑 `src/main/cli/cli-registry.ts`：

1. import 这个模块的注册函数
2. 在 `createCliRegistry()` 里调用它

示例：

```ts
import { registerHelloCliModule } from './modules/hello-cli-module'

export const createCliRegistry = (): CliRegistry => {
  const registry = new CliRegistry()
  registerTestCliModule(registry)
  registerHelloCliModule(registry)
  return registry
}
```

### 3. 测试命令

应用启动后，直接执行：

```bash
piagent hello ping
```

## 如果一个模块有多个 action

一个文件里注册多个 action 就行。

例如：

```ts
registry.register('memory', 'search', memorySearchHandler)
registry.register('memory', 'list', memoryListHandler)
registry.register('memory', 'stats', memoryStatsHandler)
```

建议：

- 同一模块的 action 放在同一个 `*-cli-module.ts` 文件里
- 不要把一个模块拆成很多零碎文件，除非逻辑已经明显过大

## 返回结果规范

所有 handler 都返回统一结构：

```ts
{
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  data?: unknown
}
```

建议规则：

- 成功：`ok=true`，`exitCode=0`
- 参数错误：`exitCode=2`
- 模块不存在：`exitCode=4`
- 执行失败：`exitCode=5`

## 文本输出和 JSON 输出

shim 会把 HTTP 响应里的：

- `stdout` 打到终端标准输出
- `stderr` 打到终端错误输出

如果你要支持 `--json`：

1. 从 `request.flags.json` 读标记
2. 把结构化数据塞进 `stdout`
3. 同时也可以把原始对象放进 `data`

## 什么时候不要改 `src/main/http/`

如果你只是新增一个 CLI 命令：

- 不需要改 `src/main/http/local-http-server.ts`
- 不需要改 `src/main/http/register-local-http-routes.ts`

只有在你要新增“非 CLI 的 HTTP 能力”时，才应该去改 `src/main/http/`

例如未来如果有：

- `/v1/memory/jobs`
- `/v1/debug/runtime`
- `/v1/internal/...`

那时才把新的 route group 挂到 `register-local-http-routes.ts`

## 一句话规则

新增 CLI 命令时：

**只在 `src/main/cli/modules/` 写模块文件，并在 `cli-registry.ts` 注册，不要把 HTTP 服务层和 CLI 模块层混在一起。**
