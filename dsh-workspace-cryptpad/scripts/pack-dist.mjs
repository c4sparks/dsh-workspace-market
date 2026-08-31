#!/usr/bin/env node
/**
 * scripts/pack-dist.mjs — 打"自包含发布包"，直接安装用。
 *
 * 背景：普通 `pnpm pack` 的 tarball 里带着 `cryptpad` git 依赖，
 * `dsh plugin add <tarball>` 会在其 profile 里被 pnpm 的 blockExoticSubdeps 拦下
 * （ERR_PNPM_EXOTIC_SUBDEP），还得改 profile 配置 + 连 gitcode，门槛太高。
 *
 * 本脚本把 cryptpad 的整个"生产依赖树"（`pnpm install --prod` 单独装，不夹 dev 依赖）
 * 也打进 tarball，并去掉 package.json 里的 dependencies 声明，让安装方零解析：
 *   - 无需 git / github / gitcode 网络
 *   - 无需改 profile 的 pnpm-workspace.yaml
 *   - 无需 allowBuilds（依赖已构建好，不触发任何构建脚本）
 *
 * 用法：pnpm run pack:full
 * 产物：<root>/dsh-workspace-cryptpad-<version>.tgz
 * 安装：dsh plugin --profile <web|desktop> add <该 tarball 绝对路径>
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const TGZ = `${pkg.name}-${pkg.version}.tgz`;

// Windows 上用系统 bsdtar（System32/tar.exe），避免 Git Bash 的 GNU tar 把 `C:\` 盘符
// 误当远程主机（同 ensure-drawio.mjs）。路径统一正斜杠。
const TAR = (process.platform === "win32" && process.env.SystemRoot)
  ? process.env.SystemRoot + "\\System32\\tar.exe"
  : "tar";
const norm = (p) => p.replace(/\\/g, "/");

const STAGE = join(ROOT, ".dist-pack"); // 发布内容暂存（含 package/ 顶层目录）
const PROD = join(ROOT, ".dist-prod");   // 仅生产依赖的临时 workspace

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.error) {
    console.error(`[pack-dist] ${cmd} 执行失败: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 1. 下载依赖 + 构建（幂等；命令内部完成，无需先手动装/构建）
run("pnpm", ["install"], ROOT);
run("pnpm", ["run", "build"], ROOT);

// 2. 用官方 `pnpm pack` 拿"发布文件集"（lib/ src/ scripts/ vendor/ docs/ 配置等），解到 STAGE
rmSync(STAGE, { recursive: true, force: true });
rmSync(PROD, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
mkdirSync(PROD, { recursive: true });
rmSync(join(ROOT, TGZ), { force: true });
run("pnpm", ["pack"], ROOT);
run(TAR, ["-xzf", norm(join(ROOT, TGZ)), "-C", norm(STAGE)]);
rmSync(join(ROOT, TGZ), { force: true });

// 3. 单独 --prod 装出干净生产依赖（复用 store，不夹 esbuild/typescript/@types 等 dev 依赖），
//    拷进 STAGE/package/node_modules。需带 pnpm-workspace.yaml + vendor/drawio-stub
//    （overrides 里的 drawio 引用本地占位）。
cpSync(join(ROOT, "package.json"), join(PROD, "package.json"));
cpSync(join(ROOT, "pnpm-workspace.yaml"), join(PROD, "pnpm-workspace.yaml"));
cpSync(join(ROOT, "vendor", "drawio-stub"), join(PROD, "vendor", "drawio-stub"), { recursive: true });
run("pnpm", ["install", "--prod"], PROD);
// dereference: 把 .pnpm 虚拟存储里的 symlink 都解开成真目录，发布包不依赖本机路径
cpSync(join(PROD, "node_modules"), join(STAGE, "package", "node_modules"), {
  recursive: true,
  dereference: true
});
// 去掉 pnpm 自身元数据（.modules.yaml 等记录本机绝对路径，不进发布包）
for (const f of [".modules.yaml", ".package-map.json", ".pnpm-workspace-state-v1.json"]) {
  rmSync(join(STAGE, "package", "node_modules", f), { force: true });
}

// 4. 改写发布版 package.json：去掉所有依赖声明 → 安装方零解析、零拦截。
//    运行时 cryptpad 从包内自带 node_modules 解析（src/index.ts 的 _require.resolve('cryptpad')）。
const distPkg = JSON.parse(readFileSync(join(STAGE, "package", "package.json"), "utf8"));
delete distPkg.dependencies;
delete distPkg.devDependencies;
delete distPkg.peerDependencies;
delete distPkg.peerDependenciesMeta;
distPkg._packedBy = "dsh-workspace-cryptpad/scripts/pack-dist.mjs"; // 标记来源，便于辨认
writeFileSync(join(STAGE, "package", "package.json"), JSON.stringify(distPkg, null, 2));

// 5. 打最终 tarball（保留 package/ 顶层目录、且不带 "./" 前缀，与 npm tarball 一致，
//    否则 pnpm 解包认不出 package.json）
run(TAR, ["-czf", norm(join(ROOT, TGZ)), "-C", norm(STAGE), "package"]);

// 6. 清理暂存
rmSync(STAGE, { recursive: true, force: true });
rmSync(PROD, { recursive: true, force: true });

console.log(`[pack-dist] 完成：${join(ROOT, TGZ)}`);
console.log(`[pack-dist] 自包含（cryptpad + 生产依赖已内置），安装方无需 git / profile 配置`);
console.log(`[pack-dist] 安装：dsh plugin --profile <web|desktop> add ${join(ROOT, TGZ)}`);
