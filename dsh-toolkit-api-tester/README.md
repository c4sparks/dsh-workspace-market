# dsh-toolkit-api-tester

dsh-workspace-sidebar 工作台 widget 插件：**接口管理** tab（HTTP 调试 + WebSocket + 收藏树 + 历史）。
host 半提供代理转发（规避 CORS）与 SQLite 持久化。

> 本插件是 [dsh-workspace-market](../README.md) monorepo 的一个子插件（工作台面板）；
> 仓库结构 / 整体安装 / 新增插件见外层 README。

## 两种使用方式

| 方式 | 前提 | 入口 |
|---|---|---|
| **工作台 tab**（推荐） | 装了 dsh-workspace-sidebar | 工作台 TabBar「+」→ 选「接口管理」（right 区域，可拖拽/分屏/停靠） |
| **独立侧车** | 没装 workspace-sidebar | 侧边栏底部「🔌 接口管理」按钮 → 帧级覆盖层 |

插件用 `ctx.get('workspace')` 自动检测宿主并切换，无需配置；host 数据（SQLite 收藏/历史 + 代理）两种模式共享。

## 功能

- **HTTP 调试**：9 种请求体（JSON / XML / Text / HTML / JS / GraphQL / urlencoded / Form-Data / Binary），
  响应状态 / 时序分解（DNS / TCP / TLS / TTFB / 总耗时）/ 响应大小 / 头 / 体（JSON 自动格式化）/ 复制。
- **WebSocket 模式**：连接 + 消息收发。
- **代理转发**：请求经 host `/_dsh/desktop/toolkit/proxy` 转发，**Node 无 CORS 限制**。
- **收藏树**：无限层级文件夹 + 右键菜单（新建子文件夹 / 重命名 / 复制 / 删除），
  **better-sqlite3 持久化**（`runtime/data/api-tester.db`，重启保留）。
- **历史**：最近 50 条请求记录（SQLite 持久化），一键清空。
- **三栏可拖拽**：收藏树宽度、请求/响应比例。

## 数据 / Host

| 路由 | 作用 |
|---|---|
| `/_dsh/desktop/toolkit/api-tester/*` | SQLite CRUD（收藏树 / 接口 / 请求历史） |
| `/_dsh/desktop/toolkit/proxy` | HTTP 代理转发（POST，带分阶段时序） |

> ⚠️ 与旧的 `dsh-toolkit` sidecar 共用 `/_dsh/desktop/toolkit/*` 路由，装配本插件前须先移除它。

## 安装前提

本插件是**工作台面板**，优先依赖 dsh-workspace-sidebar 的工作台框架（`registerWidget`）。
**未装宿主时自动回退为侧边栏底部侧车入口**（见「无宿主降级」），工具照常可用（host 路由独立于宿主）。

## 安装 / 卸载

```bash
# 安装（在 dsh-workspace-market 根目录，见外层 README）
node scripts/install.mjs dsh-toolkit-api-tester
# 或手动
dsh plugin --profile <web|desktop> add <本插件目录>

# 卸载
node scripts/install.mjs --remove dsh-toolkit-api-tester
# 或手动
dsh plugin --profile <web|desktop> remove dsh-toolkit-api-tester
```

## 使用

1. `dsh web` 启动，打开工作台。
2. 点 TabBar「+」→ 选「接口管理」（right 区域，懒加载）。
3. 选方法 + 填 URL →「发送」，看时序分解与响应；可收藏到树、查看历史。
4. 右键收藏树条目：新建子文件夹 / 重命名 / 复制 / 删除。

## 无宿主降级

未安装 `dsh-workspace-sidebar` 时，插件用 `ctx.get('workspace')` 检测宿主：无 → 自动在侧边栏底部
注册「🔌 接口管理」侧车按钮，点击打开帧级覆盖层渲染同一工具。运行期周期性重查宿主可用性，
workspace 出现后自动切换为工作台 tab（HMR/热重载安全）。

## 构建 / 开发

```bash
pnpm install && pnpm run build   # esbuild → lib/client.js + lib/index.js（better-sqlite3 保持 external）
pnpm run typecheck
```

> 宿主直接加载 `lib/`：**改 `src/` 后必须重建**。侧车/reconciler 逻辑见 `src/client/sidecar.ts` +
> `src/client/reconcile.ts`（market/shared 模板的本地副本）。
