# DSH 升级注意点

> 记录 DSH 宿主升级对本插件的影响与适配点。**升级宿主前先读这份**，按「适配检查点」核对。

## 0.1.2-alpha.1（2026-08-29 记录）

### 传输层变更

- **旧 APIProxy 传输层移除**，统一走 **Remote 网关**（`@deepseek-ai/dsh-api-gateway`，Typert RPC）。
- **浏览器鉴权**：进程一次性启动 token（`/?token=`）→ `authorizeIndex` 签发**签名 cookie**
  （host-only / HttpOnly / SameSite=Strict，绑定 host+port）→ 后续请求带 cookie + Host/Origin
  信任栅栏；缺失 / 过期 → 401。

### 对本插件的影响

- **`webServer` 不提供服务器级认证**：`registerUpgrade` 只交付原始 socket，route owner 自己实施
  请求策略 → 本插件 `/ws/terminal` 自实现 `authorize()`（Host/Origin 信任 + `dsh-auth-*` cookie）。
- **插件 WS 路由不被 `/api` 网关覆盖**：不走网关统一鉴权，需自己验 cookie / trust。
- **typert 严格 codegen 仅限 harness 一等包**：构建机器（`clientBundle`）是仓库内部 helper，
  独立插件不用它；需要宿主能力的独立插件走原始 WS / HTTP 路由（或 `ctx.typert.register()` 手动）。

### 适配检查点

- [x] WS 路由鉴权：Host/Origin + `dsh-auth-*` cookie 存在性。
- [x] node-pty 原生构建：插件 `pnpm-workspace.yaml` 放行 `node-pty: true`；profile 亦需放行。
- [ ] cookie 存在性 → 可升级为**签名验证**（复用 connection 的 BrowserAuth，`ctx.connection`
      未直接暴露 `isAuthenticated`，需自行取 `ctx.credentials` 的 browser-session 密钥或等宿主开放）。

### 升级动作模板

1. 读对应版本 `packages/client/connection/README`（浏览器鉴权 / 请求信任）。
2. 检查本插件所有 WS / HTTP 路由是否仍被鉴权覆盖；缺 cookie 检查则补。
3. 重装 profile 依赖（原生模块放行：`pnpm-workspace.yaml` allowBuilds 加 `node-pty: true`）。
4. 若宿主暴露新鉴权 helper，优先复用而非自实现。
