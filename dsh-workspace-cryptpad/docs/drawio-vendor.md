# drawio 引入方案：pnpm 占位 + 首启懒下载（替代 169MB vendor）

> 更新:2026-08-30
> 状态:已实现（见 `scripts/ensure-drawio.mjs`、`vendor/drawio-stub/`）

## 1. 背景 / 现状（问题）

- cryptpad 声明依赖 `"drawio": "github:cryptpad/drawio-npm#npm-29.6.7+3"`——该包**只在 GitHub、npm 无发布**。
- 原方案:pnpm override 指向本地 `vendor/download/drawio-npm`（169MB、**不入 git**）。
- 问题:
  1. **GitHub 直连不稳定**（本项目面向中国网络:cryptpad 走 gitcode 镜像、registry 用 npmmirror），169MB 大文件拉取极易失败;
  2. **169MB 手工 artifact**，每台机器都要从旧 `dsh-plugin-cryptpad` 复制或自行准备;缺失时 `pnpm install` 直接失败;
  3. **版本漂移**（**已解决，2026-08-31**）:原 vendor 副本 VERSION = **21.5.2（2023-06）**，与 cryptpad 2026.5.1 期望的 **`npm-29.6.7+3`（drawio 29.6.7，2026）** 相差约 3 年、多个大版本。已用 `DRAWIO_FORCE=1` 把运行时 `www/components/drawio` 升到 **29.6.7**。

## 2. 决策

改为 **pnpm 占位 + 首启懒下载**:

- `pnpm install` 完全离线:override 指向本地**占位包** `vendor/drawio-stub`（仅 `package.json`，声明 `name: "drawio"`，几 KB，可入 git）;
- 真实 drawio 在**首次打开 CryptPad** 时由 `scripts/ensure-drawio.mjs` 从**镜像**下载到 cryptpad checkout 的 `www/components/drawio`（运行时 serve 的位置）;
- **版本 + 可选 sha256 双 pin**，镜像可配。

> 为什么还必须留一个占位而不是彻底去掉 vendor:cryptpad 的 `package.json` 声明了 `drawio` 依赖，pnpm 必须在依赖图里解析它——不 override 就回落到 GitHub 直连（正是要绕开的路）;要"安装离线 + 网络后置"，占位 stub 是最小代价。**占位不是 drawio 代码**,drawio 本体不再 vendor。

## 3. 方案设计

### 3.1 占位包 `vendor/drawio-stub/package.json`

```json
{
  "name": "drawio",
  "version": "0.0.0-stub",
  "private": true,
  "description": "pnpm 占位:真实 drawio 由 scripts/ensure-drawio.mjs 首启下载到 www/components/drawio"
}
```

### 3.2 `pnpm-workspace.yaml`

```yaml
overrides:
  drawio: 'file:./vendor/drawio-stub'
  json.sortify: '2.2.2'
```

### 3.3 `scripts/ensure-drawio.mjs`

- 目标:`<cryptpad>/www/components/drawio`（cryptpad 目录由 argv[2] 或 `require.resolve('cryptpad/package.json')` 推导）。
- **持久缓存**:下载 / 解压都在项目内 `DRAWIO_CACHE`（默认 `vendor/download/drawio-npm`,git 已忽略）完成;缓存 VERSION 匹配 → 直接拷到 checkout,**无需联网**;node_modules 重装后 checkout 丢失也从缓存恢复,不重新下载。
- 已安装判定:`www/components/drawio/src/main/webapp/index.html` 存在即跳过;`DRAWIO_FORCE=1` 强制重装 / 升级。
- 下载:镜像 tarball `github.com/cryptpad/drawio-npm/archive/refs/tags/<VERSION>.tar.gz`,经 `DRAWIO_MIRROR_BASE` 前缀代理（默认 ghfast.top）。
- 校验:**默认固定 sha256**（`DRAWIO_SHA256` 已填入 `npm-29.6.7+3` 实测值）,可覆盖。
- 解压:Windows 用系统 bsdtar（`System32\tar.exe`）,避开 Git Bash GNU tar 的盘符误判;解到项目盘临时目录后写入缓存 + checkout。

### 3.4 `src/index.ts` 集成

`start()` 中 `ensureComponents()` 之后新增 `ensureDrawio()`:

```ts
private async ensureDrawio(): Promise<void> {
  if (existsSync(DRAWIO_MARKER) && process.env.DRAWIO_FORCE !== '1') return
  await this.runNode(['scripts/ensure-drawio.mjs', CRYPTPAD_DIR], PACKAGE_ROOT)
}
```

> 顺序:先 `copy-components`（会用 stub 覆盖 drawio）→ 再 `ensureDrawio()` 用真实 drawio 覆盖。`ensureDrawio` 独立于 components 是否已存在,总是自查 drawio。

## 4. 配置 / 使用

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `DRAWIO_MIRROR_BASE` | `https://ghfast.top/` | GitHub 下载代理前缀（ghfast.top 实测可用；ghproxy.net 实测不通，失效可换别的） |
| `DRAWIO_VERSION` | `npm-29.6.7+3` | 与 cryptpad 2026.5.1 期望对齐 |
| `DRAWIO_SHA256` | `92c0b3fb...ace61b`（已固定） | `npm-29.6.7+3` 实测 sha256（2026-08-31 下载验证） |
| `DRAWIO_FORCE` | 空 | `=1` 强制重装 / 升级版本 |
| `DRAWIO_TARGET` | 自动推导 | 手动指定输出目录（checkout 的 www/components/drawio） |
| `DRAWIO_CACHE` | `vendor/download/drawio-npm` | 持久缓存目录（项目盘;命中且版本匹配则不联网） |

手动预热:`node scripts/ensure-drawio.mjs`（插件根,依赖已装）或 `node scripts/ensure-drawio.mjs <cryptpad目录>`。

升级 drawio 版本:改 `DRAWIO_VERSION` + 对应 `DRAWIO_SHA256`,删 `www/components/drawio` 或设 `DRAWIO_FORCE=1` 后重启。

## 5. 协议说明（为什么不再 vendor 后义务反而更轻）

- drawio（含 cryptpad 的 `drawio-npm` fork）为 **Apache-2.0（宽松）**:vendor 或下载都不受限,义务仅是"再分发时保留 LICENSE + 版权声明 + 注明修改"。无论代码放 `vendor/` 还是 `www/components/drawio`,义务一样——**义务来自再分发,不来自目录**。
- 新方案下**仓库不再含 169MB drawio 代码副本**,少一块"第三方代码混进 MIT 仓库"的合规负担;下载落盘的 `www/components/drawio` 随包带 Apache LICENSE。
- cryptpad 本体 AGPL 义务与本次改动无关,按 `docs/license-compliance.md` 处理。
- 补充:不要用 npm 上的 `drawio` 原版顶替——`drawio-npm` 带 cryptpad 集成补丁（tag `+3`）,原版会丢补丁。

## 6. 待办 / 风险

- [x] 固定 `DRAWIO_SHA256`（`92c0b3fb...ace61b`，2026-08-31 经 ghfast.top 下载验证；tarball VERSION=29.6.7、Apache-2.0）。
- [x] 旧 `vendor/download/drawio-npm` **改作持久缓存**（2026-08-31 已播种 29.6.7）——不再待删;重装后从缓存恢复,不重新下载。
- [x] 镜像下载 + sha256 校验 + 解压整链路已验证（2026-08-31，ghfast.top；Windows 用 System32 bsdtar 解压）；运行时 drawio 已升至 **29.6.7**；**缓存命中路径已验证**（移走 checkout → 命中缓存秒恢复、不联网）。此后默认 marker 存在即跳过，重装 / 升版设 `DRAWIO_FORCE=1`。
- [ ] 镜像源（ghproxy 类）可能有波动,多配一个备选并在脚本报错时提示换 `DRAWIO_MIRROR_BASE`。

---

## 7. 附：json.sortify（github fork → 原版 2.2.2）

- cryptpad 声明 `"json.sortify": "github:cryptpad/JSON.sortify"`（CryptPad 官方 fork，仅 GitHub）。
- override `json.sortify: '2.2.2'` 实际安装的是 **npm 原版**（`ThomasR/JSON.sortify`，Apache-2.0，
  原作者的最终发布版，2017 年后基本停更），**不是** cryptpad 的 fork——两者是不同仓库。
- 判定：**无实质差异**。证据链：
  1) npm `2.2.2` 是原版（ThomasR）最终发布版，2017 后基本停更；
  2) cryptpad 的 fork 解析到 GitHub 提交 `0a96f91c3f3b127c3040bbc2d3eb6ae803cb2dfd`，**版本同为 2.2.2**
     （见 `pnpm-lock.yaml`），与原版版本号一致；
  3) cryptpad CHANGELOG/README 无 sortify 改动记录；
  4) 本插件一直用 2.2.2 运行正常。
- override **保留在 `pnpm-workspace.yaml`**：尝试移到 `package.json` 的 `pnpm.overrides` 失败——
  **pnpm 11 不再读 package.json 的 `pnpm` 字段**（install 警告已证实），overrides 必须在
  `pnpm-workspace.yaml`；否则回落 GitHub 直连（`ENOTFOUND`）。
- 残余风险：未能逐字节对比 fork 与 2.2.2（GitHub 两侧不可达；lockfile 里 github tarball 与 npm 包的
  sha512 不同是因文件集不同，不能据此判断代码差异）。若 fork 修过边界情况（`undefined` / `toJSON` /
  循环引用等），确定性 stringify 输出可能不同 → 内容哈希不一致。核实路径：从可达镜像拉
  `cryptpad/JSON.sortify@0a96f91`，与 `json.sortify@2.2.2` 的 `dist/JSON.sortify.js` 比对 sha256。
