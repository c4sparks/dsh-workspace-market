# 数据安全与网络行为分析（遥测 / 出站请求排查）

> **本插件定位（先说清楚）**:本插件是 **CryptPad 的本地封装（wrapper）**，供 **DeepSeek Harness（dsh）** 工作台使用——
> 插件在本地启动一个自托管的 CryptPad node 实例，工作台内以 iframe 内嵌。**它不是 CryptPad 官方发行版 / 云服务**，
> 也不与 CryptPad 官方服务器有任何数据往来。以下所有结论针对的是「本封装在本机上的行为」。
>
> 分析时间:2026-08-30
> 分析对象:`dsh-workspace-cryptpad` v0.1.0（CryptPad 开源自托管软件的 **dsh 封装**；含 `cryptpad` 依赖 2026.5.1、vendored `drawio`、`vendor/cryptpad-fixes`、`runtime/` 配置）
> 结论先行:**本地部署安全。无遥测、无主动外发数据请求。** 数据不出本机（服务只监听回环、数据只落本地盘、服务端零出站、无默认开启的遥测、drawio 本地内嵌且无激活的分析 SDK）。

---

## 1. 结论

- 服务绑定 `127.0.0.1`，数据全部落本地 `runtime/data/`。
- **CryptPad 服务端零出站**（`node_modules/cryptpad/lib/**` 中 `require('https')` / `fetch(` / `request(` / `http.get/post` 全部零命中）。
- CryptPad 的 "telemetry" 是**被动 + 自愿**的:实例元数据只经 `/api/config` 暴露，仅当管理员显式配置 `listMyInstance: true`（自愿申请登记进 CryptPad 公共实例目录）才会上报；本插件生成的 `runtime/config.cjs` 未配置任何此类开关。
- 插件自身代码、CryptPad 客户端、vendored drawio 均无遥测 SDK 激活、无外发请求。

---

## 2. 逐层分析

### 2.1 插件自身代码（`src/` + `scripts/`）

| 位置 | 行为 |
|---|---|
| `src/index.ts`（host） | `spawn` 本地 CryptPad node 子进程，绑定 `127.0.0.1`；就绪探测只打 `http://127.0.0.1:<port>/`；路由带 origin 校验（仅接受 dsh 宿主自身 origin） |
| `src/client/CryptPadWidget.tsx` | `fetch('/_dsh/desktop/cryptpad')`（同源）→ iframe 指向 `http://localhost:<port>/` |
| `runtime/config.cjs` | 数据路径全部指向本插件 `runtime/data/*` |

**结论**:无遥测调用、无外部 URL。唯一外部网络是**安装期**一次性拉依赖（见 §4.1）。

### 2.2 CryptPad 服务端（`node_modules/cryptpad/lib/` + `server.js`）

- `lib/**` 中出站 HTTP 相关代码**零命中** → 服务端不做任何主动请求。
- 数据只写本机磁盘（由 config 指向 `runtime/data/`）。

### 2.3 CryptPad 的 "server telemetry" 机制（重点澄清）

如:`config/config.example.js`、`lib/stats.js`。

- `Stats.instanceData()` 组装实例元数据（版本、安装方式、域名、origin、`adminEmail` 等），但**只通过 `/api/config` 被动暴露**，服务端不会主动 POST。
- 只有管理员**显式配置** `listMyInstance: true`（自愿申请把实例登记进 CryptPad 公共实例目录）才会上报;注释原话:"These values are publicly available via /api/config, posting them to our server just makes it easier for us."
- 本插件生成的 `runtime/config.cjs` **没有**配置 `listMyInstance` / `consentToContact` / `provideAggregateStatistics` / `adminEmail` → 全部默认关闭。
- `logFeedback` 默认 `false`（客户端 usage feedback 不记录）；`installMethod` 默认 `'unspecified'`。

### 2.4 CryptPad 客户端（`www/`）

- 外部 URL 全部是**文档 / 帮助链接**（`docs.cryptpad.org`、`github.com/cryptpad/cryptpad/releases`、`cryptpad.org/instances`），为 `href` 供用户**点击**打开新标签，非自动请求。
- `fetch('/upload-blob')` 同源;`postMessage` 全是同源 iframe 通信。
- posthog / sentry / gtag / mixpanel / amplitude 等 SDK 在核心代码**零命中**。

### 2.5 vendored drawio（`www/components/drawio` + `vendor/download/drawio-npm`）

- 由 `www/diagram/inner.js` 从**同源** `/components/drawio/src/main/webapp/index.html?embed=1&stealth=1&p=cryptpad&noDevice=1&filesupport=0` 内嵌加载（本地，非 app.diagrams.net）。
- 早先按关键词扫描命中的 `segment` / `telemetry` / `gTag`，逐一核对上下文后**全部是误报**：
  - `segment` → mxGraph **几何线段**（`findNearestSegment`、`ENTITY_SEGMENT`、`rectangleIntersectsSegment`）；
  - `telemetry` → AWS / Cumulus **图标名**（"Distro for OpenTelemetry"、"NetQ Telemetry Server"）；
  - `gTag` → `Symbol.toStringTag`；
  - drawio 打包内**零真实分析端点**（无 googletagmanager / google-analytics / segment.io / aws 请求 URL）。
- drawio 的云盘连接（Google Drive / Dropbox / GitHub / OneDrive）是用户**主动点按钮授权**才触发，且本配置 `filesupport:0`、`noDevice:1`。

---

## 3. 运行时网络白名单（预期）

正常运行时，插件 / CryptPad / drawio 产生的网络请求应**只**包含：

```
http://localhost:<port>/           CryptPad portal（if rame）
http://127.0.0.1:<port>/           就绪探测（host）
/_dsh/desktop/cryptpad{,/settings}  同源设置/启动路由
```

任何非 localhost / 127.0.0.1 的请求都是**意外**，属于异常信号。

---

## 4. 已知的外部网络（非遥测）

### 4.1 安装期（一次性，非运行时）

- `pnpm install` 从 `gitcode.com/gh_mirrors/cr/cryptpad.git`（**第三方镜像源**）+ npmmirror 拉取 cryptpad 依赖。
- drawio vendor 副本（169MB）需手工准备，不入 git。

### 4.2 MathJax SRE（功能触发，非默认）

- MathJax 无障碍语音引擎（SRE）的 bundled 文件里含 `cdn.jsdelivr.net` 引用；但 CryptPad 本地捆绑 mathjax（`components/mathjax`），正常从同源加载。仅当用户触发**无障碍语音渲染**且配置了远程规则时才可能出站。

### 4.3 用户主动点击

- 文档 / 更新 / 公共实例目录等 `href` 链接（点开新标签）。

---

## 5. 注意事项（部署 / 加固建议）

1. **保持当前 config 不要配置遥测相关项**:不要设 `listMyInstance` / `adminEmail` / `consentToContact` / `provideAggregateStatistics`（现状即是，改 `runtime/settings.json` 或 `runtime/config.cjs` 时注意别引入）。
2. **可选的网络隔离**:可在系统防火墙 / 沙箱中禁止该 node 子进程出站。它只监听回环、不出站，断外网不影响工作台正常使用。
3. **供应链核对**:`cryptpad` 来自 gitcode 镜像（`gh_mirrors/cr/cryptpad`），非官方直接分发渠道。建议核对 `pnpm-lock.yaml` 中锁定版本 / hash 与官方 `2026.5.1` tag 的一致性；追求供应链干净可改用官方源 + 固定 lock 文件。
4. **升级后需复检**:依赖升级（尤其 `cryptpad` / `drawio`）后，用 §6 清单重跑，不要沿用本结论。
5. **运行期数据目录**:`runtime/data/` 含用户文档（加密存储），注意备份与权限；`runtime/settings.json` 可改端口 / 数据目录。
6. **host 路由**:`/_dsh/desktop/cryptpad` 已有 origin 校验;如部署在公网暴露 dsh host，注意该路由与整体访问控制。

---

## 6. 自查清单（复检用）

```bash
# 1. 插件自身代码有无遥测 / 外部 URL
rg -i -n 'telemetry|analytics|fetch\(|XMLHttpRequest|WebSocket|https?://(?!localhost|127\.0\.0\.1)' src/ scripts/ | rg -v 'localhost|127\.0\.0\.1'

# 2. CryptPad 服务端是否出站（应零命中）
rg -n "require\('https?'\)|fetch\(|request\(|\.get\(|\.post\(" node_modules/cryptpad/lib/ | rg -v '^\s*//'

# 3. 遥测开关是否关闭
rg -n 'listMyInstance|consentToContact|provideAggregateStatistics|adminEmail|installMethod|logFeedback' runtime/config.cjs runtime/settings.json   # 应无命中（未配置 = 默认关闭）

# 4. 运行时抓包复核
#   浏览器 DevTools → Network：全屏打开 CryptPad，确认请求全部是 localhost/127.0.0.1；
#   系统层面可用 netstat / Wireshark 观察 node 子进程连接，应无外网连接。
```

---

## 7. 不保证 / 免责声明

- **封装定位**:本插件是 CryptPad（自托管、零知识加密协作文档套件）的 **dsh 封装**，仅供 DeepSeek Harness 工作台内使用;
  不提供、不关联 CryptPad 官方云服务，也不向 CryptPad 官方服务器发送任何数据。CryptPad 上游的行为 / 漏洞 / 许可以其官方渠道为准。
- **时效性**:本分析基于快照（`node_modules` 中的 cryptpad 2026.5.1、vendored drawio、插件 `src/`/`lib/`）。**依赖一升级，本结论即失效**，需重新评估。
- **非正式安全审计**:本分析是代码层静态排查，**未做运行时抓包 / 渗透验证**；如需强保证，请自行抓包复核（§6 第 4 项）或委托正式审计。
- **第三方组件不保证**:cryptpad 本体来自 gitcode 镜像、drawio 是 169MB 第三方捆绑；包完整性依赖 pnpm lock + hash，供应链风险由使用方自行评估。不保证这些上游在极端配置下绝无其它网络行为。
- **行为可能随配置变化**:本结论的前提是当前 `runtime/` 配置（未开遥测开关、drawio 以 `embed/stealth` 内嵌）。任何配置改动都可能改变网络行为。
- **不保证未来版本**:本插件或 cryptpad / drawio 上游后续版本可能引入遥测或出站功能，升级后请以复检结果为准，勿沿用本结论。
- **本机安全前提**:本地部署的安全性还依赖宿主机本身不被入侵、`runtime/` 与 config 不被外部改写、dsh host 不被未经授权访问。

---

## 8. 相关文件索引

| 文件 | 说明 |
|---|---|
| `src/index.ts` | host：spawn CryptPad、绑 127.0.0.1、就绪探测、origin 校验 |
| `src/client/CryptPadWidget.tsx` | 同源 POST 启动 + localhost iframe |
| `runtime/config.cjs` | 运行配置（数据路径、端口、无遥测开关） |
| `node_modules/cryptpad/lib/stats.js` | telemetry 数据组装（被动、opt-in） |
| `node_modules/cryptpad/www/diagram/inner.js` | drawio 本地内嵌加载（`embed=1`） |
| `docs/license-compliance.md` | 开源协议与合规说明（AGPL / MIT / Apache 边界与义务） |
| `docs/window-open-popups.md` | 关联:弹窗 / window.open 问题（非安全项） |
