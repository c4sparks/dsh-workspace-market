#!/usr/bin/env node
/**
 * scripts/build.mjs — 构建 src/ → lib/（esbuild）。
 *
 * - client：cjs + __ModuleLoader__.load 格式（toolkit 的 build-client.mjs 模式）。
 * - host：esm / node；better-sqlite3（原生模块）保持 external，运行时从 profile node_modules 解析。
 *
 * esbuild 解析：优先本地 node_modules；找不到则回退 workspace-sidebar（开发约定）。
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

const CLIENT_ID = "dsh-toolkit-api-tester";
const banner = [
  "window.__ModuleLoader__.load({",
  "  id: " + JSON.stringify(CLIENT_ID) + ",",
  "  factory: (require) => {",
  "    var module = { exports: {} };",
  "    var exports = module.exports;",
  '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
].join("\n");
const footer = "\n  ; return module.exports;\n  }\n});\n";

// client：cjs + jsx automatic + react external + banner/footer（toolkit 模式）
await esbuild.build({
  entryPoints: [join(root, "src", "client", "index.ts")],
  outfile: join(root, "lib", "client.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2023",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
  banner: { js: banner },
  footer: { js: footer },
  logLevel: "info"
});

// host：esm / node；better-sqlite3 原生模块保持 external
await esbuild.build({
  entryPoints: [join(root, "src", "index.ts")],
  outfile: join(root, "lib", "index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2023",
  external: ["better-sqlite3"],
  logLevel: "info"
});

console.log(`[build] ${join(root, "lib", "client.js")}\n[build] ${join(root, "lib", "index.js")}`);
