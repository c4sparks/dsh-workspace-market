# dsh-workspace-terminal

一个**真终端** widget 插件：`xterm.js`（浏览器渲染）+ `node-pty`（宿主真实 shell）+ `WebSocket`。
注册为 dsh-workspace-sidebar 工作台里的「终端」tab，可多开、可拖拽分屏、可停靠。

> 本插件是 [dsh-workspace-market](../README.md) monorepo 的一个子插件（工作台面板）；
> 仓库结构 / 整体安装 / 新增插件见外层 README。

## 功能

- **真终端**：node-pty 在宿主 spawn 真实 shell（`$SHELL` / `powershell.exe`），不是模拟器。
- **实时双向**：WebSocket 桥接，输入→shell→输出→xterm，延迟低、会话独立。
- **纯终端 + 工作台分屏**：单面板 xterm（独立 pty）；分屏 / 停靠 / 拖拽由
  dsh-workspace-sidebar 通用能力承载，任意 widget 都可参与。
- **可多开**：`multi: true`（`src/client/plugin.ts`）——TabBar「+」可开多个终端实例，
  每个实例用独立 `tab=<instanceId>` 连宿主 → 各自独立的 shell / pty，互不干扰。
- **声明式设置**：主题（浅色白底默认 / 深色）、字号（10–24）；设置页「工作台」分区直接调。
- **双主题完整 ANSI 调色板**：深浅各配一套 16 色板 + 光标 / 选区色，白底下输入也不糊。
- **健壮降级**：node-pty 缺失时显示降级提示；未装 dsh-workspace-sidebar 时跳过注册并告警。

## 安装前提

本插件是**工作台面板**，依赖 dsh-workspace-sidebar 提供的工作台框架（`inject: ['workspace']`
+ `registerWidget`）。**必须先安装 dsh-workspace-sidebar**，否则插件跳过注册、控制台告警，
看不到任何效果（宿主 + 面板缺一不可）。

## 安装 / 卸载

```bash
# 安装（在 dsh-workspace-market 根目录，见外层 README）
node scripts/install.mjs dsh-workspace-terminal
# 或手动
dsh plugin --profile web add <本插件目录>

# 卸载
node scripts/install.mjs --remove dsh-workspace-terminal
# 或手动
dsh plugin --profile web remove dsh-workspace-terminal
```

> 若 `node-pty` 原生构建被 pnpm 拦截：在 profile 的 `pnpm-workspace.yaml` 放行
> `node-pty: true`（或 `pnpm approve-builds`）后重装。

## 使用

1. `dsh web` 启动。
2. 打开工作台（侧边栏底部「工作台」按钮）。
3. 点「终端」tab，即得真实 shell 提示符；输入命令即回显。
4. 多开终端：点标签栏末尾 **+** → 选「终端」→ 新增独立终端实例（各连各的 shell）。

## 设置

dsh 设置页「工作台」分区 → 「终端」设置块：

- **主题**：浅色（白底，默认）/ 深色；未设置时跟随 dsh 全局主题（浅 / 深 / 跟随系统）。
- **字号**：10–24。

## 工作方式

```
浏览器 xterm.js ── WebSocket /ws/terminal ──▶ 宿主 node-pty ──▶ shell
```

- **Host**：`webServer.registerUpgrade('/ws/terminal')`；鉴权 = Host/Origin 信任 +
  `dsh-auth-*` 会话 cookie（0.1.2-alpha.1 一次性 token → cookie 后的浏览器会话）。
- **Client**：`registerWidget` 注册「终端」tab；xterm 渲染；WS 文本帧 = 输入，
  JSON `{type:'resize',cols,rows}` = 尺寸。
- **会话隔离**：host 以 `sessionId:tab` 为 key 隔离 pty；每个终端实例独立 shell，互不干扰。
- **node-pty 懒加载**：缺失时终端显示降级提示，不拖垮插件 / 不崩溃 dsh web。

## 构建 / 开发

```bash
pnpm install        # 放行 node-pty / esbuild 构建脚本
node scripts/build.mjs   # esbuild → lib/client.js（含 xterm）+ lib/index.js
```

> 宿主直接加载 `lib/`：**改 `src/` 后必须重建**。开发规范见
> [`docs/development/开发规范.md`](docs/development/开发规范.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/README.md](docs/README.md) | 文档索引（分类导航） |
| [docs/architecture/终端实现方案.md](docs/architecture/终端实现方案.md) | 架构 / 数据流 / 模块职责 / 鉴权 / WS 协议 / 决策记录 |
| [docs/development/开发规范.md](docs/development/开发规范.md) | 开发规范（技术栈 / 约定 / 构建 / 常见问题） |
| [docs/upgrade/DSH升级注意点.md](docs/upgrade/DSH升级注意点.md) | DSH 宿主升级影响与适配检查点 |
