# dsh-workspace-market

DSH 工作台插件族 monorepo：主仓库 + 子插件目录。每个子插件是一个工作台 widget 插件
（结合 dsh-workspace-sidebar 使用），也可不装宿主独立作为侧车入口。

> 📖 **插件怎么用**（独立 / 结合工作台两种模式）：见 [`docs/使用说明.md`](docs/使用说明.md)
> 每个子插件目录里各有 `README.md`（功能 / 安装 / 使用 / 设置），细节以那里为准。

## 结构

```
dsh-workspace-market/             ← git 根
├── pnpm-workspace.yaml           # 子插件清单（packages:）+ 放行原生构建
├── scripts/install.mjs           # 安装 / 卸载脚本（all / 单个 / --remove）
├── shared/                       # 模板/参考代码（侧车 + 调解器），各插件 copy 进自己 src/client/
├── dsh-workspace-terminal/       # 终端（xterm + node-pty）
├── dsh-toolkit-api-tester/       # 接口管理（代理 + SQLite 收藏/历史）
└── dsh-xxx                       #其他
```

## 快速开始

```bash
pnpm install && pnpm run build      # 安装依赖 + 构建全部
node scripts/install.mjs --all      # 装到 profile（默认 web；桌面端加 --profile desktop）
# 或单个：node scripts/install.mjs <插件名>
# 等价手动：dsh plugin --profile <web|desktop> add <插件目录>
```

> ⚠️ 部分插件有额外依赖 / 路由注意：`cryptpad` 是独立 workspace，需在它目录内
> `cd dsh-workspace-cryptpad && pnpm install`（git 源依赖 + drawio vendor 169MB，不入 git）；
> `api-tester` / `cryptpad` 路由与旧 sidecar 互斥，装前先移除旧插件。详见各插件 README。

## 新增子插件

1. 插件目录放进本仓库（独立 package.json + lib/）
2. 在 `pnpm-workspace.yaml` 的 `packages:` 登记
3. `pnpm install && pnpm run build`
4. `node scripts/install.mjs <目录名>` 装到 profile
