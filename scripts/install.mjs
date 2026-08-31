#!/usr/bin/env node
/**
 * scripts/install.mjs — 将本仓库子插件安装 / 移除到 DSH profile。
 *
 * 包装 `dsh plugin --profile <p> add|remove`（内部即 profile 内 pnpm add/remove）。
 *
 * 用法：
 *   node scripts/install.mjs                     # 安装全部子插件（等价 --all）
 *   node scripts/install.mjs --all               # 安装全部子插件
 *   node scripts/install.mjs <name>              # 安装指定子插件（目录名或包名）
 *   node scripts/install.mjs --remove <name>     # 从 profile 移除指定子插件
 *   node scripts/install.mjs --remove --all      # 从 profile 移除全部
 *   node scripts/install.mjs --list              # 列出子插件（含是否已构建）
 *   node scripts/install.mjs --profile <name>    # 指定 profile（默认 web）
 *   node scripts/install.mjs --dry-run           # 只打印命令，不真正执行
 *   node scripts/install.mjs --help
 *
 * 子插件枚举来源：根 pnpm-workspace.yaml 的 `packages:`（唯一事实来源），
 * 另补扫自带 pnpm-workspace.yaml 的独立 workspace 插件（如 cryptpad，git 源依赖不入根，
 * 用 `dsh plugin add <目录>` 以 link 方式装入 profile，勿先 pnpm pack 再 add tarball）。
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_PROFILE = "web";

/* ---------- 参数解析 ---------- */

function die(msg) {
  console.error("[install] " + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { all: false, remove: false, dryRun: false, list: false, help: false, profile: DEFAULT_PROFILE, targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--profile=")) {
      opts.profile = a.slice("--profile=".length);
      if (!opts.profile) die("--profile 需要 <name>");
      continue;
    }
    switch (a) {
      case "--all": opts.all = true; break;
      case "--remove": opts.remove = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--list": opts.list = true; break;
      case "--help": case "-h": opts.help = true; break;
      case "--profile":
        opts.profile = argv[++i];
        if (!opts.profile) die("--profile 需要 <name>");
        break;
      default:
        if (a.startsWith("-")) die("未知参数: " + a + "（--help 查看用法）");
        opts.targets.push(a);
    }
  }
  return opts;
}

/* ---------- 子插件枚举（解析 pnpm-workspace.yaml packages） ---------- */

function parsePackages(yaml) {
  const globs = [];
  let inPackages = false;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^packages:$/.test(line)) { inPackages = true; continue; }
    if (!inPackages) continue;
    if (line === "" || /^#/.test(line)) continue;
    const m = line.match(/^-\s+(.+)$/);
    if (m) { globs.push(m[1]); continue; }
    break; // 其它顶层键，packages 段结束
  }
  return globs;
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$");
}

async function expandGlob(pattern, base) {
  const idx = pattern.indexOf("/");
  if (idx === -1) {
    const re = globToRegExp(pattern);
    const out = [];
    for (const entry of await readdir(base)) {
      if (re.test(entry) && (await stat(join(base, entry))).isDirectory()) out.push(join(base, entry));
    }
    return out;
  }
  const head = pattern.slice(0, idx);
  const rest = pattern.slice(idx + 1);
  const re = globToRegExp(head);
  const out = [];
  for (const entry of await readdir(base)) {
    if (re.test(entry) && (await stat(join(base, entry))).isDirectory()) {
      out.push(...await expandGlob(rest, join(base, entry)));
    }
  }
  return out;
}

/** 返回子插件列表（仅带 dsh/cordis 字段的包）：根 workspace 成员 + 独立 workspace 插件。 */
async function listPlugins() {
  const yaml = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
  const globs = parsePackages(yaml);
  const dirs = new Set();
  for (const g of globs) {
    for (const d of await expandGlob(g, root)) dirs.add(d);
  }

  // cryptpad 等独立 workspace（自带 pnpm-workspace.yaml，git 源依赖/overrides 不并入根，
  // 否则根 install 会因 exotic subdep 报错）不在根 packages: 里，但 install.mjs 仍要能安装它们。
  for (const entry of await readdir(root)) {
    const dir = join(root, entry);
    if (dirs.has(dir)) continue;
    let isDir;
    try { isDir = (await stat(dir)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) dirs.add(dir);
  }

  const plugins = [];
  for (const dir of dirs) {
    const pkgFile = join(dir, "package.json");
    if (!existsSync(pkgFile)) continue;
    const pkg = JSON.parse(await readFile(pkgFile, "utf8"));
    if (!pkg.dsh && !pkg.cordis) continue; // 只认 dsh 插件
    plugins.push({
      dir,
      name: pkg.name,
      cordis: (pkg.cordis && pkg.cordis.name) || pkg.name,
      built: existsSync(join(dir, "lib"))
    });
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return plugins;
}

/* ---------- 执行 dsh ---------- */

function runDsh(args, dryRun) {
  const line = ["dsh", ...args].join(" ");
  if (dryRun) { console.log("[dry-run] " + line); return; }
  // Windows 上 dsh 是 .cmd shim，spawnSync 直接执行会 ENOENT/EINVAL，需 shell: true。
  const opts = { stdio: "inherit", shell: process.platform === "win32" };
  let res = spawnSync("dsh", args, opts);
  if (res.error && res.error.code === "ENOENT") {
    res = spawnSync("dsh.cmd", args, opts);
  }
  if (res.error) die("无法执行 dsh: " + res.error.message);
  if (res.status !== 0) process.exit(res.status ?? 1);
}

/* ---------- 主流程 ---------- */

function printHelp() {
  console.log(`dsh-workspace-market — 子插件安装脚本

用法：
  node scripts/install.mjs                    安装全部子插件（等价 --all）
  node scripts/install.mjs --all              安装全部子插件
  node scripts/install.mjs <name>             安装指定子插件（目录名或包名）
  node scripts/install.mjs --remove <name>    从 profile 移除指定子插件
  node scripts/install.mjs --remove --all     从 profile 移除全部
  node scripts/install.mjs --list             列出子插件与构建状态
  node scripts/install.mjs --profile <name>   指定 profile（默认 ${DEFAULT_PROFILE}）
  node scripts/install.mjs --dry-run          只打印将执行的命令

说明：
  包装 dsh plugin --profile <p> add <dir> / remove <name>；
  子插件清单 = 根 pnpm-workspace.yaml 的 packages: + 自带 pnpm-workspace.yaml 的
  独立 workspace 插件（如 cryptpad，用目录 link 安装，勿 pack 后 add tarball）。`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  const plugins = await listPlugins();
  if (plugins.length === 0) {
    console.log("[install] pnpm-workspace.yaml 未匹配到任何 dsh 插件目录");
    return;
  }

  if (opts.list) {
    console.log("dsh-workspace-market 子插件（根 workspace 成员 + 独立 workspace 插件）:");
    for (const p of plugins) {
      const badge = p.built ? "built" : "NO lib/";
      console.log(`  ${p.name.padEnd(28)} ${badge.padEnd(7)} ${p.dir}`);
    }
    return;
  }

  const match = function (p) {
    return opts.targets.includes(p.name) || opts.targets.includes(p.cordis);
  };

  if (opts.remove) {
    if (opts.targets.length === 0 && !opts.all) {
      die("请指定要移除的插件名，或 --remove --all");
    }
    const targets = opts.all ? plugins : plugins.filter(match);
    if (targets.length === 0) die("未找到匹配的插件: " + opts.targets.join(", "));
    for (const p of targets) {
      console.log("[install] remove " + p.cordis + "（profile: " + opts.profile + "）");
      runDsh(["plugin", "--profile", opts.profile, "remove", p.cordis], opts.dryRun);
    }
    return;
  }

  const targets = opts.all || opts.targets.length === 0 ? plugins : plugins.filter(match);
  if (targets.length === 0) die("未找到匹配的插件: " + opts.targets.join(", "));
  for (const p of targets) {
    console.log("[install] add " + p.name + "（" + p.dir + "）");
    runDsh(["plugin", "--profile", opts.profile, "add", p.dir], opts.dryRun);
  }
}

main().catch(function (err) {
  console.error("[install] " + err.message);
  process.exit(1);
});
