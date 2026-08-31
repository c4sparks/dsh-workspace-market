# 开源协议与合规说明（License & Compliance）

> 更新时间:2026-08-30
> 适用对象:`dsh-workspace-cryptpad` v0.1.0（CryptPad 2026.5.1 的 dsh 封装，含 vendored drawio 与 cryptpad-fixes 补丁）
> 一句话:CryptPad 本体是 **AGPL-3.0-or-later**（网络 copyleft），本插件自身是 **MIT**，vendored drawio 是 **Apache-2.0**，
> 本插件对 CryptPad 的补丁文件（`vendor/cryptpad-fixes`）是 **AGPL 衍生**。分发 / 提供服务时**必须遵守 AGPL 的源码可得性义务**。

> ⚠️ 本文件是使用方整理的**合规说明，不是法律意见**。再分发、商用、SaaS 化、修改后发布前，请咨询专业法律顾问。

---

## 1. 各组件许可证一览

| 组件 | 许可 | 依据 | 说明 |
|---|---|---|---|
| **CryptPad 本体** | **AGPL-3.0-or-later** | `node_modules/cryptpad/package.json` `"license": "AGPL-3.0+"`；根 `LICENSE` 为 AGPL v3 全文 | 版权 © XWiki CryptPad Team；`SPDX-FileCopyrightText` |
| **本插件自身代码**（`src/` `scripts/`） | **MIT** | 本插件 `package.json` `"license": "MIT"`；根 `LICENSE` 已补（2026-08-30） | 独立的调用方代码 |
| **cryptpad-fixes 补丁**（`vendor/cryptpad-fixes/` 6 个文件）+ `http-worker.js` 运行时补丁 | **AGPL-3.0-or-later** | 各文件头部 `SPDX-License-Identifier: AGPL-3.0-or-later` | 是 CryptPad 原文件的**修改版** → AGPL 衍生，**不能改按 MIT 发布**；每个改动点都有内联 `NOTE(dsh-workspace-cryptpad)` / `[dsh-workspace-cryptpad]` 标记 |
| **drawio**（`scripts/ensure-drawio.mjs` 首启下载到 `www/components/drawio`，不再 vendor） | **Apache-2.0** | tarball 内 `LICENSE` 为 Apache License 2.0 | draw.io / mxGraph 工程；cryptpad fork `drawio-npm` 带集成补丁（tag `+N`） |
| **CryptPad 内置第三方组件** | 多样 | `node_modules/cryptpad/LICENSES/`（REUSE 规范逐文件 SPDX 标注） | 含 AGPL / Apache-2.0 / BSD-3 / MIT / ISC / LGPL-3 / GPL-2 / MPL-2 / CC-BY-SA-3 等 |

`vendor/cryptpad-fixes/` 涉及文件（对 CryptPad 的修改点，共 6 个；**每个改动点都有内联注释标记**）:

- `application_config.js`（**新增**，基于 `customize.dist` 模板；`AppConfig.disableWorkers = true`，桌面 WebView2 worker 兼容）
- `template.js`（嵌入守卫 + 注释）
- `www/common/sframe-common-outer.js`（嵌入守卫 + `openURL` 弹窗兜底 ×2）
- `www/login/main.js`（嵌入守卫）
- `www/register/main.js`（嵌入守卫）
- `www/install/main.js`（嵌入守卫）

另有**运行时补丁**（非 vendor 文件，插件 `src/index.ts` 的 `patchHttpWorker()` 每次启动幂等改写 checkout）:

- `node_modules/cryptpad/lib/http-worker.js`（嵌入时跳过 COEP `require-corp`；行尾标记 `// dsh-workspace-cryptpad: skip COEP when embedded`）

---

## 2. CryptPad 的协议是什么：AGPL v3 要点

CryptPad 是**自托管、零知识加密**的开源协作文档套件，使用 **GNU Affero General Public License v3 或更高版本（AGPL-3.0-or-later）**。与普通 GPL 相比，AGPL 最关键的差异是 **§13 网络传播条款（network copyleft）**：

> **如果你修改了 AGPL 软件，并让其他人通过网络访问它（即使是"提供服务"而不是"分发"），你有义务把这些用户访问到的、修改后的完整源代码提供给他们。**

落到本插件的含义:

1. **修改披露**：本插件对 CryptPad 做了修改（`vendor/cryptpad-fixes` 的 6 个文件 + `http-worker.js` 运行时补丁，用于让 CryptPad UI 可被 dsh 外壳 iframe 嵌入 / 桌面 WebView2 worker 兼容）。**每个改动点都有内联 `NOTE(dsh-workspace-cryptpad)` 注释**。这些修改必须：
   - 保留原版权与许可声明（文件头的 `SPDX-FileCopyrightText` / `SPDX-License-Identifier`）；
   - 注明改了什么、何时改（见 §4 建议）；
   - 整个修改版继续以 **AGPL** 授权（不能改成 MIT 或闭源）。
2. **源码可得**：修改后的 CryptPad 源码（含补丁）必须提供给服务用户。本插件以源码仓库形式分发、`vendor/cryptpad-fixes` 即修改后的文件——**提供本仓库即满足**。注意 `lib/` 是**构建产物**，不是源码，不能拿它顶替。
3. **个人 / 私有部署**：仅本机自用、不对外提供服务时，AGPL 义务较轻；但一旦 dsh host 让他人经网络访问（内网共享、公网部署），"网络用户"即触发 §13。

---

## 3. 本插件的许可边界（MIT vs AGPL）

- **MIT 部分**：`src/`、`scripts/`、`package.json` 等插件自有代码。只要它们**没有复制 / 改写 CryptPad 的 AGPL 代码**，作为独立程序与 AGPL 服务器协作（起进程、转发请求、渲染 iframe）是允许的——类似"AGPL 后端 + 独立前端"的组合。
- **AGPL 部分**：`node_modules/cryptpad/**`（整个 CryptPad 工程）与 `vendor/cryptpad-fixes/**`（其衍生修改）。这些部分**始终受 AGPL 约束**，无论谁包装它们。
- **整体分发**：把整个插件（含 cryptpad）打包分发给他人 / 对外服务时，AGPL 义务落到 cryptpad 与 fixes 部分：随包保留许可文本、提供修改版源码、注明修改。**不能**只按 MIT 声明整个产物。

> 本插件根目录已补 `LICENSE`（MIT）。分发时**随包保留它**，并同时列出 cryptpad 的 AGPL 与 drawio 的 Apache 声明。

---

## 4. 具体遵循的规范与注意事项（清单）

1. **保留许可文本（随包 / 随产物）**，不得删除：
   - CryptPad：`node_modules/cryptpad/LICENSE`（AGPL v3 全文）+ `node_modules/cryptpad/LICENSES/` 目录（9 种 SPDX 许可全文）+ 各文件 SPDX 头；
   - drawio：`www/components/drawio/LICENSE`（Apache-2.0，由 `scripts/ensure-drawio.mjs` 随下载落盘）；
   - 本插件：`LICENSE`（MIT，已补）。
2. **修改披露**：在 README / 分发说明中声明"本插件对 CryptPad 做了哪些修改、修改目的、修改时间"。当前 README 已简述（"Embedding 补丁"）；逐文件清单见 §1（6 个 fixes 文件 + `http-worker.js` 运行时补丁）。
3. **源码可得性**：对外提供服务 / 分发时，向用户提供**修改后的 CryptPad 源码**（本仓库源码 + `vendor/cryptpad-fixes`），而不是只有 `lib/` 构建产物。
4. **第三方组件再分发**：CryptPad 内置组件（ckeditor 等 GPL 系、codemirror/jquery 等 MIT 系、mathjax、sortablejs……）各自许可由 `LICENSES/` 声明。再分发时保留原声明；**商用前逐项核对**，尤其 GPL 系组件。
5. **商标 / 署名**：CryptPad 名称与标识归 XWiki 团队所有。本插件是"封装 / 集成"，文档已声明**"不是 CryptPad 官方发行版 / 云服务"**，避免暗示官方背书；使用 CryptPad 名称作集成说明一般可接受，但不得冒用商标作官方产品宣传。
6. **升级复检**：cryptpad / drawio 依赖升级后，`LICENSES/` 与各 `LICENSE` 可能变化，需同步更新本说明（新增 / 移除组件、许可变更），并重跑 §5 检查。
7. **构建产物与源码区分**：`lib/` 是 esbuild 构建产物；AGPL 的"提供源码"义务提供的是可读源码（本仓库 `src/` + `vendor/cryptpad-fixes` + `node_modules/cryptpad` 对应 checkout），不是 `lib/`。

---

## 5. 合规检查清单（复检用）

```bash
# 1. 随包应包含的许可文本是否存在
ls node_modules/cryptpad/LICENSE node_modules/cryptpad/LICENSES/   # AGPL + 9 种 SPDX
ls <cryptpad>/www/components/drawio/LICENSE                            # drawio Apache-2.0（ensure-drawio 落盘）
ls LICENSE                                                           # 本插件 MIT（已补，2026-08-30）

# 2. cryptpad-fixes 补丁是否带 SPDX 头（AGPL 衍生，必须保留）
rg -l 'SPDX-License-Identifier: AGPL-3.0-or-later' vendor/cryptpad-fixes/

# 3. 是否误把 AGPL 代码并入 MIT 声明
#    插件自有 src/ 里不应出现 cryptpad 源码的复制块（无 SPDX AGPL 头的 src 文件）
rg -l 'SPDX-License-Identifier' src/ || echo "src/ 无 SPDX 头（MIT 自有代码，可选加）"
```

---

## 6. 不保证 / 免责声明

- 本文件是**使用方整理的合规说明，不构成法律意见**；具体义务（尤其 AGPL §13 对"提供服务"的界定、GPL 系组件的再分发）以各上游随包许可文本、官方解释与当地法律为准。
- 本插件打包的 CryptPad 来自 **gitcode 镜像**（`gh_mirrors/cr/cryptpad`），非官方直接分发渠道；许可文本本身应与官方 tag 一致，但**镜像内容完整性由使用方自行核对**（见 `docs/data-security.md` §4.1）。
- 依赖升级后本说明可能过时；以随包 `LICENSE` / `LICENSES/` 的实际内容为准。
- 商用 / 对外服务 / 再分发前，请务必咨询专业法律顾问。

---

## 7. 相关文件索引

| 文件 | 说明 |
|---|---|
| `node_modules/cryptpad/LICENSE` | CryptPad AGPL v3 全文 |
| `node_modules/cryptpad/LICENSES/` | CryptPad 内置组件 SPDX 许可全文（REUSE 规范） |
| `<cryptpad>/www/components/drawio/LICENSE` | drawio Apache-2.0 全文（`ensure-drawio.mjs` 下载落盘） |
| `vendor/cryptpad-fixes/` | 对 CryptPad 的 AGPL 修改（6 个文件 + `http-worker.js` 运行时补丁，见 §1） |
| `LICENSE` / `package.json` | 本插件 MIT 许可（根 LICENSE 已补，2026-08-30） |
| `docs/data-security.md` | 数据安全 / 遥测分析（配套阅读） |
