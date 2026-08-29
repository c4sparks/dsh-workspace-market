#!/usr/bin/env node
/**
 * scripts/build.mjs — 构建 src/ → lib/（esbuild）。
 *
 * 本插件不独立安装 esbuild：优先解析本地 node_modules；找不到则共享同仓库
 * workspace-sidebar 的 esbuild（开发约定：先装好 workspace-sidebar）。
 */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");
const require = createRequire(import.meta.url);

function resolveEsbuild() {
  try { return require.resolve("esbuild", { paths: [root] }); } catch { /* 回退 */ }
  const fallback = join(root, "..", "..", "dsh-workspace-sidebar", "dsh-workspace-sidebar");
  try { return require.resolve("esbuild", { paths: [fallback] }); } catch { /* 再回退 */ }
  throw new Error("esbuild not found — 请先安装 workspace-sidebar 或本插件依赖");
}

const esbuild = require(resolveEsbuild());
await mkdir(join(root, "lib"), { recursive: true });

// client：iife + __ModuleLoader__.load 格式；react 等种子模块 external；CSS 按 text 内联
await esbuild.build({
  entryPoints: [join(root, "src", "client", "index.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2023"],
  outfile: join(root, "lib", "client.js"),
  external: ["react", "react/jsx-runtime", "@deepseek-ai/*"],
  loader: { ".css": "text" },
  legalComments: "none",
  logLevel: "info"
});

// host：esm，node；node-pty（原生）/ ws 保持外部，运行时从 profile node_modules 解析
await esbuild.build({
  entryPoints: [join(root, "src", "index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["es2023"],
  outfile: join(root, "lib", "index.js"),
  external: ["node-pty", "ws"],
  legalComments: "none",
  logLevel: "info"
});

console.log(`[build] ${join(root, "lib", "client.js")}\n[build] ${join(root, "lib", "index.js")}`);
