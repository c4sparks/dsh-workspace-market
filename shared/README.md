# shared/ — 工作台 widget 插件的共享模板（参考代码，不是运行时依赖）

> ⚠️ **本目录只作模板 / 参考实现**。插件开发不一定都在本 market 目录下，因此各插件
> **必须把这两个文件 copy 进自己的 `src/client/`**，保持插件完全自包含；不要 import 本目录。

## 文件

| 文件 | 导出 | 作用 |
|---|---|---|
| `reconcile.ts` | `createWorkspaceOrSidecarReconciler(opts)` | workspace 可用性调解（有→widget / 无→侧车）+ HMR 轮询，纯逻辑、不依赖 React |
| `sidecar.ts` | `createSidecar(React)` 工厂 | 侧车入口按钮 + 帧级覆盖层 + footer 垂直堆叠 CSS + `dsh:sidecar-open` 互斥广播 |

## 为什么这样写

- **`createSidecar(React)` 用参数注入 React、全程 `React.createElement`（无裸 import、无 JSX）**，
  因此同时兼容两种 client 构建：
  - cjs+banner 构建（dsh-toolkit-*）：插件侧 `import * as React from 'react'` 传入
  - iife 构建（dsh-workspace-terminal）：插件侧 `deps.React` 传入
- `reconcile.ts` 纯逻辑，任何构建都能用；`window.setInterval` 轮询 + `ctx.effect` 自动清理，
  解决 HMR/热重载下插件先于 workspace 加载的误判。

## copy 后怎么用

```ts
// 插件 src/client/index.ts（或 plugin.ts）
import * as React from 'react'
import { createSidecar } from './sidecar.js'          // 本地副本
import { createWorkspaceOrSidecarReconciler } from './reconcile.js'

export const inject = ['slots']                        // 只依赖 slots；workspace 用 ctx.get 可选检测

export function apply(ctx: any): void {
  const sidecar = createSidecar(React)
  createWorkspaceOrSidecarReconciler({
    ctx,
    label: '<插件名>: reconcile',
    registerWidget: (workspace) => workspace.registerWidget({ id, title, icon, region, order, component/loadComponent }),
    registerSidecar: () => {
      sidecar.injectSidecarFooterCss()
      return ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register({ name: 'sidebar.footer.action', id, order: 100 },
          sidecar.createSidecarEntry({ id, icon, label, loadPage })))
    },
  })
}
```

> 参考实现：本仓库 `dsh-toolkit-format-converter` 等 5 个插件（各自 `src/client/reconcile.ts` + `sidecar.ts` 即为 copy 后的成品）。
