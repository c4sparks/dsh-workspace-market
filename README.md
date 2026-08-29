# dsh-workspace-market

DSH **workspace 插件族** monorepo：主仓库 + 子插件目录。每个子插件是一个**工作台 widget 插件**，
按 dsh-workspace-sidebar 的插件规范开发，为工作台提供可停靠、可分屏、可多开的工具面板


主仓库即 git 根；子插件保持独立的 `package.json` + `lib/` 构建产物，可独立安装、独立演进。

## 结构

```
dsh-workspace-market/            ← 主仓库（git 根）
├── pnpm-workspace.yaml          # 列出所有子插件（packages:）+ 放行原生构建
├── package.json                 # 根级统一 build / typecheck / install 脚本
├── scripts/install.mjs          # 子插件安装 / 卸载（all / 单个 / --remove）
├── LICENSE / .gitignore / README.md
├── dsh-workspace-terminal/      ← 子插件：工作台「终端」widget
└── ...                          ← 新增子插件放这里（各自 package.json + lib/）
```

## 安装前提：先装工作台主插件

本仓库的插件都**依赖 dsh-workspace-sidebar 提供的工作台框架**：插件通过
`inject: ['workspace']` 拿到工作台服务，再用 `registerWidget`（`WidgetDescriptor`）把自己注册成
一个工作台面板。因此：

1. **先安装 `dsh-workspace-sidebar`**（工作台主插件，提供 workspace 服务与四区域框架）；
2. **再安装本仓库子插件** —— 安装即出现在工作台对应区域，可参与标签页、拖拽分屏、停靠、多开。

> ⚠️ 子插件虽然也是「独立 dsh 插件」，可以直接 `dsh plugin add` 装进 dsh，但没有
> dsh-workspace-sidebar 这个宿主时，插件会在加载时**跳过注册**并打印一条控制台警告
> （不报错、不崩溃），只是面板无处安放，**看不到任何效果**。
> 二者是一对「宿主 + 面板」的关系，缺一不可。

只有**遵循工作台插件规范**（`inject: ['workspace']` + `registerWidget`）的插件才能在
dsh-workspace-sidebar 中正常显示与拖拽分屏；规范与最小示例见 dsh-workspace-sidebar 的
`.skills/workspace-plugin-guide/SKILL.md`。

## 快速开始

```bash
pnpm install          # 根级安装全部子插件依赖（放行 node-pty / esbuild 构建）
pnpm run build        # 递归构建所有子插件 src → lib
pnpm run typecheck    # 递归类型检查
```

## 安装到 DSH

**安装全部子插件：**

```bash
node scripts/install.mjs --all        # 或直接 node scripts/install.mjs（默认即全部）
```

**安装单个：**

```bash
node scripts/install.mjs <具体的插件名>   # 目录名或包名均可
```

等价命令（逐个手动装，效果相同）：

```bash
dsh plugin --profile web add <具体的插件名>
```

## 从 DSH 卸载

**卸载单个：**

```bash
node scripts/install.mjs --remove <具体的插件名>
```

**卸载全部：**

```bash
node scripts/install.mjs --remove --all
```

等价命令（逐个手动卸）：

```bash
dsh plugin --profile web remove <具体的插件名>
```

> 常用辅助：`--list` 列出子插件与构建状态；默认 profile 为 `web`，可用 `--profile <name>` 覆盖；
> `--dry-run` 只打印将执行的命令，不改动任何状态。

## 新增子插件

1. 把插件目录放进本仓库（保持独立 `package.json` + `lib/`）；
2. 在 `pnpm-workspace.yaml` 的 `packages:` 登记一行（`scripts/install.mjs` 据此枚举）；
3. 根级 `pnpm install && pnpm run build`；
4. `node scripts/install.mjs <目录名>` 装到 profile。

子插件互不依赖、独立演进；共享的只是 dsh-workspace-sidebar 的工作台插件规范与构建约定。
