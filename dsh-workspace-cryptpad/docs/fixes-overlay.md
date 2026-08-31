# CryptPad 修改注入机制（copy-overlay + 运行时补丁）

> 更新:2026-08-31
> 用途:说明本插件对 CryptPad 的修改**存在哪、怎么生效、怎么改、有什么坑**，作为后续维护 / 自定义补丁的参考。

## 1. 为什么需要这套机制

- cryptpad 是 **git 源依赖**（pnpm 安装的 checkout），而 **`pnpm patch` 打不了 git 源依赖**（见 `src/index.ts` 注释）。
- 因此采用「**运行时覆盖**」：把 `node_modules` 当作一次性 checkout，插件**每次启动自动把补丁叠回去**。重装 / 重新打包后 node_modules 里的改动会消失，但启动时从 git 管理的源里重新注入，**不会丢**。

## 2. 修改的两种形式

### 2.1 copy-overlay（6 个 fixes 文件，走 CryptPad customize 覆盖）

| 环节 | 位置 | 说明 |
|---|---|---|
| **源（git 管理）** | `vendor/cryptpad-fixes/` | 全量补丁副本，6 个文件（含改动标记） |
| **构建** | `pnpm run build` | `scripts/copy-fixes.mjs` 把 vendor → `lib/cryptpad-fixes/`（打包实际带的是这份） |
| **启动注入** | `src/index.ts` `ensureFixes()` | 每次 `rmSync` + `cpSync` 到 `node_modules/cryptpad/customize/` |
| **生效机制** | CryptPad customize 覆盖 | `customize/www/*` **覆盖同名 `www/*`**；`customize/application_config.js` 覆盖默认配置 |

文件清单 + 每个文件的改动点 + 改动标记，见 [`docs/license-compliance.md`](license-compliance.md) §1。

### 2.2 运行时行级补丁（不在 vendor 里）

| 补丁 | 实现 | 说明 |
|---|---|---|
| `lib/http-worker.js` COEP | `src/index.ts` `ensureServerPatches()` | 嵌入时跳过 `require-corp`，**幂等**（查标记，已改即跳过） |
| `runtime/config.cjs` | `src/index.ts` `ensureRuntime()` | 每次生成，端口/数据路径/上传限额来自设置 |
| `ENABLE_EMBEDDING` decree | `src/index.ts` `ensureRuntime()` | 启动时追加到 `runtime/data/decrees/decree.ndjson` |

## 3. 生命周期（`start()`，`src/index.ts`）

```
ensureRuntime()      → 生成 config + 补 ENABLE_EMBEDDING decree
ensureFixes()        → 重拷 vendor/lib 的 fixes → customize/
ensureServerPatches()→ 重打 COEP 补丁（幂等）
ensureComponents()   → 缺才 copy-components（装 www/components）
ensureDrawio()       → 缺才下载真实 drawio
spawnCryptpad()      → 起 CryptPad node 服务
```

## 4. 修改规范（避免踩坑）

1. **只改 `vendor/cryptpad-fixes/` + `src/index.ts`，别直接改 `node_modules/`**——node_modules 重装即失。
2. **改完必须 `pnpm run build`**：`lib/cryptpad-fixes` 才是打包 / 分发实际用的那份（`ensureFixes` 优先从 lib 取，vendor 只是源码兜底）。
3. **路径映射**：`vendor/cryptpad-fixes/www/X.js` → `customize/www/X.js`（不是改原 `www/X.js`）；`application_config.js` / `template.js` 在 fixes **根目录**。
4. **保留 SPDX 头 + 改动标记**（AGPL §5(b)：who + what + **date**），格式：
   `// NOTE(dsh-workspace-cryptpad, modified <YYYY-MM-DD>): <改了什么、为什么>`
5. **版本敏感**：cryptpad 升级后，补丁要找的字符串（COEP 行、`window.top` 守卫等）若变，补丁会**跳过并打日志**（`[dsh-workspace-cryptpad] http-worker.js COEP line not found (skipping patch)`，非致命），但功能可能回退——**升级后必须重跑验证**。
6. **COEP 标记幂等**：改 `COEP_PATCH_MARKER` 常量时，**已应用过的 checkout 文件也要同步替换旧标记**，否则下次启动会双包装（`src.includes(marker)` 失配 → 重复替换）。
7. **测试注意**：浏览器对 CryptPad 静态资源有 `?ver=` 缓存，验证补丁改动务必**整页刷新 / 重开 tab**。

## 5. 自定义补丁的步骤（参考）

1. 在 `vendor/cryptpad-fixes/` 下按 customize 路径放修改后的文件（或改 `src/index.ts` 里的运行时补丁）。
2. 保留原文件 SPDX 头，改动点加 `// NOTE(dsh-workspace-cryptpad, modified <date>): ...`。
3. `pnpm run build`（刷新 `lib/cryptpad-fixes`）。
4. 重启 CryptPad tab / dsh（`ensureFixes` 会自动把新文件拷进 `customize/`）。

## 6. 相关文档

- [`docs/license-compliance.md`](license-compliance.md) — AGPL 义务、改动文件清单
- [`docs/drawio-vendor.md`](drawio-vendor.md) — drawio 下载方案（stub + 懒下载）
- [`docs/data-security.md`](data-security.md) — 数据安全 / 遥测分析
