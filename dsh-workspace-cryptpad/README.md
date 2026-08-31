# dsh-workspace-cryptpad

> 本插件是 **CryptPad 的 dsh 封装（wrapper）**：工作台内以 iframe 内嵌一个由插件**本地自启**的 CryptPad 实例
> （自托管、零知识加密协作文档套件）。**仅供 DeepSeek Harness（dsh）使用**;不是 CryptPad 官方发行版 / 云服务，
> 不向 CryptPad 官方服务器发送任何数据。

dsh-workspace-sidebar 工作台 widget 插件：**CryptPad** 文档编辑 tab。
host 半在首次打开时拉起一个真实的 CryptPad node 服务（`cryptpad` 依赖的 checkout），
client 用 iframe 内嵌进工作台面板；配置经 `/settings` 路由持久化。

> 本插件是 [dsh-workspace-market](../README.md) monorepo 的一个子插件（工作台面板）；
> 移植自旧的 `dsh-plugin-cryptpad` sidecar（改为工作台 widget 类型）。

## 两种使用方式

| 方式 | 前提 | 入口 |
|---|---|---|
| **工作台 tab**（推荐） | 装了 dsh-workspace-sidebar | 工作台 TabBar「+」→ 选「CryptPad」（center 区域，iframe 内嵌） |
| **独立侧车** | 没装 workspace-sidebar | 侧边栏底部「📝 CryptPad」按钮 → 帧级覆盖层 |

插件用 `ctx.get('workspace')` 自动检测宿主并切换，无需配置；CryptPad 服务（host 启动）两种模式共享。

## 功能

- **CryptPad 文档编辑**：iframe 内嵌完整 CryptPad（协作文档 / 表格 / 白板 / 代码 / 幻灯片等）。
- **懒启动**：首次打开才 spawn CryptPad node 服务，之后复用（crashed 自动重启）。
- **自动选端口**：dsh-host 自身常占 3000/3001/3003，host 启动时自动向后扫描一段**连续空闲端口**
  （http + safe + websocket 三个），撞 EADDRINUSE 会自动换端口，无需手动配置。
- **配置外置**：运行配置 + 数据全部落在插件 `runtime/`（或自定义数据目录），重启保留。
- **声明式设置**：数据目录 / 端口 / 单文件上传上限 / 每账户存储配额；设置页「工作台 → 插件设置」卡片，
  保存即停止当前服务，下次打开按新设置重启。
- **Embedding 补丁**：`vendor/cryptpad-fixes` 在启动时拷进 CryptPad checkout 的 `customize/`，
  让 CryptPad UI 可被 shell iframe（`window.top !== window` 守卫已注释）。

## 数据 / Host

| 路由 | 作用 |
|---|---|
| `/_dsh/desktop/cryptpad`（POST） | 启动 CryptPad 并返回 portal URL（`http://localhost:<port>/`） |
| `/_dsh/desktop/cryptpad/settings` | 设置读写（GET / POST） |

> ⚠️ **与旧的 `dsh-plugin-cryptpad` sidecar 路由互斥**，装配本插件前必须先移除旧插件。

## 安装前提（重要）

1. **先装 `dsh-workspace-sidebar`**（工作台宿主）。
2. **`cryptpad` 依赖是 git 源**（`git+https://gitcode.com/gh_mirrors/cr/cryptpad.git#2026.5.1`），
   安装需要网络访问 gitcode + npmmirror。已在根 `pnpm-workspace.yaml` 配置：
   - `blockExoticSubdeps: false`（cryptpad 传递依赖有 git 源）
   - `overrides`：`drawio` → 本地 vendor、`json.sortify` → `2.2.2`
3. **drawio 由插件首启自动下载**（无需手工准备 169MB）：`pnpm` 的 drawio 依赖被 override 成本地占位
   `vendor/drawio-stub`（仅 package.json，install 完全离线）；真实 drawio（默认 pin `npm-29.6.7+3`）
   在**首次打开 CryptPad** 时由 `scripts/ensure-drawio.mjs` 从镜像下载到 `www/components/drawio`。
   可手动预热：`node scripts/ensure-drawio.mjs <cryptpad目录>`；镜像/版本/sha256 用
   `DRAWIO_MIRROR_BASE` / `DRAWIO_VERSION` / `DRAWIO_SHA256` 覆盖（见 `docs/drawio-vendor.md`）。

```bash
# 最省事：下载源码后，在插件目录里一条命令搞定（下载依赖 → 构建 → link 装进 dsh web profile）
cd dsh-workspace-cryptpad
pnpm run install:dsh

# 分步等价写法（明白每一步在干嘛）：
#   pnpm install                              # 1. 下载依赖（含 cryptpad git 源，需网络）
#   pnpm run build                            # 2. 构建 → lib/
#   dsh plugin --profile web add <本插件目录>  # 3. link 装进 dsh（不拉 git，无需 pack）
# 也可在市场根用：
#   node scripts/install.mjs dsh-workspace-cryptpad

# 卸载
node scripts/install.mjs --remove dsh-workspace-cryptpad
# 或手动
dsh plugin --profile <web|desktop> remove dsh-workspace-cryptpad
```

> ⚠️ 默认装进 **web** profile；要装 desktop 把脚本里的 `--profile web` 改 `--profile desktop`。
> 日常自己用直接 link（install:dsh）即可；`pnpm run pack:full` 打**自包含
> 发布包**（见下「构建 / 开发」）， `dsh plugin add <tarball>` 直接装，无需 git / 改 profile。

## 使用

1. `dsh web` 启动，打开工作台。
2. 点 TabBar「+」→ 选「CryptPad」（center 区域）。首次打开会**拉起 CryptPad node 服务**（约几十秒），
   之后 iframe 内嵌文档编辑界面。
3. 设置：dsh 设置页「工作台 → 插件设置」→ CryptPad 卡片改端口 / 数据目录等（改后需重新打开页面）。

> 端口 3000 被占时，host 会报错并提示换端口（设置卡里改 `端口` 后保存）。

## 无宿主降级

未安装 `dsh-workspace-sidebar` 时，插件用 `ctx.get('workspace')` 检测宿主：无 → 自动在侧边栏底部
注册「📝 CryptPad」侧车按钮，点击打开帧级覆盖层渲染同一工具（host 路由独立于宿主，照常启动 CryptPad）。
运行期周期性重查宿主可用性，workspace 出现后自动切换为工作台 tab（HMR/热重载安全）。

## 构建 / 开发

```bash
pnpm install && pnpm run build    # esbuild → lib/client.js + lib/index.js；再跑 copy-fixes 生成 lib/cryptpad-fixes
pnpm run pack:full                # 自包含发布包：下载依赖 → 构建 → 把 cryptpad+生产依赖打进 tarball
pnpm run typecheck
```

> `pnpm run pack:full` 产出 `dsh-workspace-cryptpad-<version>.tgz`（约 150MB，gitignore 已排除）。
> 它是**自包含**的：cryptpad 及其生产依赖全部内置，发布版 package.json 不含 dependencies，
> `dsh plugin add <tarball>` 零解析安装——无需 git / 无需改 profile 的 pnpm-workspace.yaml。
> 脚本：`scripts/pack-dist.mjs`（含 `pnpm install --prod` 只带生产依赖、去掉 pnpm 本机元数据等）。
> 日常自己用直接 link（`pnpm run install:dsh`）即可，不需要 pack。

> 宿主直接加载 `lib/`：**改 `src/` 后必须重建**。侧车/reconciler 逻辑见 `src/client/sidecar.ts` +
> `src/client/reconcile.ts`（market/shared 模板的本地副本）。
> 架构/实现移植自 `dsh-workspace-sidebar/dsh-plugin-cryptpad`（`src/index.ts` 的 CryptpadSidecar）。

## 许可证 / 合规

| 组件 | 许可 |
|---|---|
| CryptPad 本体（`node_modules/cryptpad`） | **AGPL-3.0-or-later**（网络 copyleft） |
| 本插件自身代码（`src/` `scripts/`） | MIT |
| 本插件补丁（`vendor/cryptpad-fixes`） | AGPL-3.0-or-later（CryptPad 衍生，须源码可得） |
| drawio（`scripts/ensure-drawio.mjs` 首启下载） | Apache-2.0 |

> 本插件是 CryptPad 的 dsh 封装：分发 / 对外服务时须遵守 **AGPL 源码可得性义务**（保留许可文本、披露修改、提供修改版源码）。
> 详细规范与注意事项见 **[`docs/license-compliance.md`](docs/license-compliance.md)**；数据安全 / 遥测分析见 **[`docs/data-security.md`](docs/data-security.md)**；
> drawio 引入方案（stub + 懒下载）见 **[`docs/drawio-vendor.md`](docs/drawio-vendor.md)**；
> CryptPad 修改注入机制（copy-overlay + 运行时补丁）见 **[`docs/fixes-overlay.md`](docs/fixes-overlay.md)**。
