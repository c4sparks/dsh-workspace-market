/**
 * dsh-workspace-cryptpad host plugin（移植自 dsh-plugin-cryptpad sidecar host）。
 *
 * Lazily spawns the CryptPad node server (from the `cryptpad` dependency's
 * checkout in node_modules) as a child process, externalises all configuration
 * and data into a runtime directory, and exposes same-origin routes the client
 * half calls to obtain the portal URL and read/write settings.
 */

import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Stable Cordis plugin name (diagnostics only). */
export const name = 'dsh-workspace-cryptpad'

/** Services required before the sidecar route can be registered. */
export const inject = ['webServer']

/**
 * electron-builder 把 `node_modules/**` 解包到 `app.asar.unpacked/`（真实磁盘），
 * 但 `require.resolve` / `import.meta.url` 解析出的仍是 `app.asar/` 内的虚拟路径。
 * Electron 主进程可读写虚拟路径，但 spawn 的原生子进程（node）不认 asar → ENOTDIR。
 * 这里把 asar 虚拟路径重写为 `.asar.unpacked` 真实路径；非打包环境原样返回。
 */
function unpackAsarPath(p: string): string {
  const marker = p.indexOf('.asar')
  if (marker === -1) return p
  return `${p.slice(0, marker)}.asar.unpacked${p.slice(marker + '.asar'.length)}`
}

/** Absolute path of this package's root (lib/ sits one level under it). */
const PACKAGE_ROOT = unpackAsarPath(fileURLToPath(new URL('..', import.meta.url)))

/** Resolve a module path from this package's dependency tree. */
const _require = createRequire(import.meta.url)

/** The CryptPad checkout, resolved from the `cryptpad` dependency. */
const CRYPTPAD_DIR = unpackAsarPath(dirname(_require.resolve('cryptpad/package.json')))
const CRYPTPAD_SERVER = join(CRYPTPAD_DIR, 'server.js')

/** Port the CryptPad server listens on (mirrors generated config httpPort). */
const DEFAULT_CRYPTPAD_PORT = 3000

/** 端口自动扫描范围：期望端口被占用时向后尝试的端口数。 */
const PORT_SCAN_RANGE = 50

/** User settings file (persisted via the /settings route). */
const SETTINGS_FILE = join(PACKAGE_ROOT, 'runtime', 'settings.json')

/**
 * Merged current settings: saved settings.json, overridden by env vars.
 * `dataDir` (storage location) prefers the SAVED value so the settings panel
 * can move the data directory; env CRYPTPAD_DATA is the fallback.
 */
function currentSettings(): { dataDir?: string; port: number; maxUploadMB: number; storageLimitGB: number } {
  let saved: { dataDir?: string; port?: number; maxUploadMB?: number; storageLimitGB?: number } = {}
  try { saved = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')) } catch { /* not set yet */ }
  const pick = (envVal: string | undefined, savedVal: number | undefined, dflt: number): number => {
    const n = Number(envVal)
    if (Number.isFinite(n) && n > 0) return n
    if (typeof savedVal === 'number' && Number.isFinite(savedVal) && savedVal > 0) return savedVal
    return dflt
  }
  return {
    dataDir: typeof saved.dataDir === 'string' && saved.dataDir.length > 0 ? saved.dataDir : process.env.CRYPTPAD_DATA,
    port: pick(process.env.CRYPTPAD_PORT, saved.port, DEFAULT_CRYPTPAD_PORT),
    maxUploadMB: pick(process.env.CRYPTPAD_MAX_UPLOAD, saved.maxUploadMB, 100),
    storageLimitGB: pick(process.env.CRYPTPAD_STORAGE_LIMIT, saved.storageLimitGB, 1),
  }
}

/** Runtime directory holding generated config + data (settings dataDir → env → default). */
const RUNTIME_DIR = currentSettings().dataDir ?? join(PACKAGE_ROOT, 'runtime')
// Must be .cjs: the runtime dir sits under this package ("type": "module"), so a
// .js config would be treated as ESM and CryptPad's CJS `require` would break.
const CONFIG_FILE = join(RUNTIME_DIR, 'config.cjs')

/**
 * Front-end embedding fixes shipped as a customize/ overlay (template.js +
 * www/{login,register,install}/main.js with the `window.top !== window` guard
 * commented out). Copied into the checkout's customize/ at start because pnpm
 * patch cannot target the git-hosted `cryptpad` dependency.
 *
 * The runtime source is deliberately looked up in `lib/cryptpad-fixes` first:
 * `scripts/copy-fixes.mjs` copies it there during `pnpm run build`, and the
 * legacy `vendor/**` path is kept as a fallback for source checkouts that have
 * not been rebuilt.
 */
const FIXES_SOURCES = [
  join(PACKAGE_ROOT, 'lib', 'cryptpad-fixes'),
  join(PACKAGE_ROOT, 'vendor', 'cryptpad-fixes'),
]

/** How long the CryptPad server may take to answer before start fails. */
const READY_TIMEOUT_MS = 30_000

/** Same-origin route served to the client half. */
const PORTAL_PATH = '/_dsh/desktop/cryptpad'

/** Decree log that toggles remote embedding at boot (see lib/decrees-core.js). */
const DECREE_DIR = join(RUNTIME_DIR, 'data', 'decrees')
const DECREE_FILE = join(DECREE_DIR, 'decree.ndjson')

/** The ENABLE_EMBEDDING decree line; replayed at CryptPad boot when present. */
const EMBEDDING_DECREE = '["ENABLE_EMBEDDING",[true],"sidecar",0]'

/** www/components is absent from a fresh git checkout; copy it on demand. */
const COMPONENTS_MARKER = join(CRYPTPAD_DIR, 'www', 'components', 'requirejs', 'require.js')

/** Marker that the real drawio webapp is installed (the pnpm stub has no index.html). */
const DRAWIO_MARKER = join(CRYPTPAD_DIR, 'www', 'components', 'drawio', 'src', 'main', 'webapp', 'index.html')

/**
 * CryptPad's lib/http-worker.js is patched at start so the COEP `require-corp`
 * header is skipped when embedding is enabled. COEP require-corp without
 * cross-origin isolation (which an embedded shell iframe cannot provide) makes
 * Chromium refuse to fetch the sframe network worker → apps hang on the loading
 * screen ("Failed to fetch a worker script."). Gating on the existing
 * ENABLE_EMBEDDING decree keeps non-embedded instances fully secure.
 */
const HTTP_WORKER_FILE = join(CRYPTPAD_DIR, 'lib', 'http-worker.js')
const COEP_PATCH_MARKER = 'dsh-workspace-cryptpad (modified 2026-08-30): skip COEP when embedded'

/** Components copied from the dependency tree into www/components (see scripts/copy-components.js). */
const COMPONENTS = [
  'alertify.js', 'bootstrap', 'bootstrap-tokenfield', 'chainpad', 'chainpad-listmap',
  'chainpad-netflux', 'ckeditor', 'codemirror', 'croppie', 'file-saver', 'hyper-json',
  'jquery', 'json.sortify', 'jszip', 'dragula', 'html2canvas', 'localforage', 'marked',
  'mathjax', 'open-sans-fontface', 'tweetnacl', 'tweetnacl-util', 'require-css',
  'requirejs', 'requirejs-plugins', 'scrypt-async', 'sortablejs', 'chainpad-crypto',
  'saferphore', 'nthen', 'netflux-websocket', 'drawio', 'pako', 'x2js',
]

/**
 * Lifecycle manager for the CryptPad sidecar process: lazily spawns the node
 * server on first use, waits for it to answer HTTP, and kills it on teardown.
 */
class CryptpadSidecar {
  private child: ChildProcess | undefined
  private stopping = false
  private port: number

  constructor(port: number) { this.port = port }

  /** The CryptPad origin clients should load (matches generated config httpUnsafeOrigin). */
  originUrl(): string {
    // 必须与 httpAddress(127.0.0.1) 一致：Chromium(桌面渲染器)在 Windows 会把 localhost 解析成 ::1，
    // 而服务只绑 127.0.0.1 → iframe "localhost 拒绝连接"。统一用 127.0.0.1 消除整类问题。
    return `http://127.0.0.1:${String(this.port)}/`
  }

  /** 端口是否可绑定（空闲）。绑定成功即视为空闲，随后关闭测试 socket。 */
  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, '127.0.0.1', () => { srv.close(() => resolve(true)) })
    })
  }

  /**
   * 从 start 起向后扫描一段连续空闲端口（CryptPad 需要 httpPort / httpSafePort / websocketPort
   * 三个端口，且 websocketPort 默认固定 3003、常被 dsh-host 占用，故必须显式分配连续端口段）。
   */
  private async findFreePort(start: number): Promise<number> {
    const need = 3
    for (let p = start; p + need - 1 < start + PORT_SCAN_RANGE; p++) {
      let ok = true
      for (let i = 0; i < need; i++) {
        if (!(await this.isPortFree(p + i))) { ok = false; break }
      }
      if (ok) return p
    }
    throw new Error(`CryptPad 找不到连续空闲端口段（扫描 ${String(start)}–${String(start + PORT_SCAN_RANGE - 1)}）`)
  }

  /** 现有 config.cjs 的 httpPort 是否与当前 this.port 一致。 */
  private configUsesCurrentPort(): boolean {
    try {
      return readFileSync(CONFIG_FILE, 'utf-8').includes(`httpPort: ${this.port}`)
    } catch {
      return false
    }
  }

  /** Lazily start the sidecar and resolve its origin URL. */
  async start(): Promise<string> {
    // 复用存活实例（其已绑定的端口即当前端口）
    if (this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null) {
      return this.originUrl()
    }
    // 自动选空闲端口：设置/默认端口常被 dsh-host 自身占用（如 3000–3003），
    // 硬用会撞 EADDRINUSE。从期望端口向后扫描取第一个可绑定端口。
    this.port = await this.findFreePort(currentSettings().port)
    this.ensureRuntime()
    this.ensureFixes()
    this.ensureServerPatches()
    await this.ensureComponents()
    await this.ensureDrawio()
    const child = this.spawnCryptpad()
    this.child = child
    child.on('error', (cause) => {
      process.stderr.write(`[dsh-workspace-cryptpad] sidecar spawn error: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    })
    child.on('exit', () => {
      if (this.stopping) return
      this.child = undefined
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[cryptpad] ${String(chunk)}`)
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[cryptpad] ${String(chunk)}`)
    })
    try {
      await this.waitForReady(child)
    } catch (cause) {
      this.stop()
      throw cause
    }
    return this.originUrl()
  }

  /** Terminate the sidecar and its whole process tree (cluster workers). */
  stop(): void {
    const child = this.child
    this.child = undefined
    if (child === undefined || this.stopping) return
    this.stopping = true
    const forceKillTree = (): void => {
      if (child.pid === undefined) return
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        } catch { /* best effort */ }
        return
      }
      try { child.kill('SIGKILL') } catch { /* best effort */ }
    }
    try {
      child.kill('SIGTERM')
      setTimeout(() => { if (!child.killed) forceKillTree() }, 2000).unref()
    } catch {
      forceKillTree()
    }
  }

  // --- runtime preparation --------------------------------------------------

  /**
   * Ensure the runtime directory, generate the external config (idempotent) and
   * the embedding decree. Called before every spawn.
   */
  private ensureRuntime(): void {
    try {
      mkdirSync(DECREE_DIR, { recursive: true })
      for (const sub of ['datastore', 'archive', 'pins', 'tasks', 'block', 'blob', 'blobstage', 'logs']) {
        mkdirSync(join(RUNTIME_DIR, 'data', sub), { recursive: true })
      }
      // 首次生成；或配置/环境变量/端口变化 → 重新生成（覆盖早期产物，保证生效）
      if (!existsSync(CONFIG_FILE) || this.hasConfigOverrides() || !this.configUsesCurrentPort()) {
        writeFileSync(CONFIG_FILE, this.generateConfig())
        process.stderr.write(`[dsh-workspace-cryptpad] generated ${CONFIG_FILE}\n`)
      }
      // ENABLE_EMBEDDING decree so the CryptPad UI can be framed by the shell.
      const current = existsSync(DECREE_FILE) ? readFileSync(DECREE_FILE, 'utf-8') : ''
      if (!current.includes('ENABLE_EMBEDDING')) {
        appendFileSync(DECREE_FILE, EMBEDDING_DECREE + '\n')
      }
    } catch (cause) {
      const msg = `[dsh-workspace-cryptpad] ensureRuntime failed: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`
      process.stderr.write(msg)
      try { appendFileSync(join(RUNTIME_DIR, 'ensure-error.log'), msg) } catch { /* best effort */ }
    }
  }

  /** Serialise the external config that CRYPTPAD_CONFIG points at. */
  private generateConfig(): string {
    const p = (sub: string): string => join(RUNTIME_DIR, 'data', sub).replace(/\\/g, '/')
    const conf = {
      httpUnsafeOrigin: `http://127.0.0.1:${String(this.port)}`,
      httpAddress: '127.0.0.1',
      httpPort: this.port,
      // 沙箱独立源 + WS 单独端口：必须与 httpPort 连成一段空闲端口（默认 websocketPort=3003
      // 常被 dsh-host 占用，显式分配成 port+1 / port+2 绕开）
      httpSafePort: this.port + 1,
      websocketPort: this.port + 2,
      filePath: p('datastore'),
      archivePath: p('archive'),
      pinPath: p('pins'),
      taskPath: p('tasks'),
      blockPath: p('block'),
      blobPath: p('blob'),
      blobStagingPath: p('blobstage'),
      decreePath: p('decrees'),
      logPath: p('logs'),
      logToStdout: false,
      logLevel: 'info',
      // 上传/存储限制来自当前设置（settings.json / 环境变量 / 默认）
      maxUploadSize: currentSettings().maxUploadMB * 1024 * 1024,
      defaultStorageLimit: currentSettings().storageLimitGB * 1024 * 1024 * 1024,
    }
    return `module.exports = ${JSON.stringify(conf, null, 2)};\n`
  }

  /** Whether settings/env request a fresh config (re-write config.cjs on boot). */
  private hasConfigOverrides(): boolean {
    return existsSync(SETTINGS_FILE)
      || process.env.CRYPTPAD_MAX_UPLOAD !== undefined
      || process.env.CRYPTPAD_STORAGE_LIMIT !== undefined
      || process.env.CRYPTPAD_DATA !== undefined
      || process.env.CRYPTPAD_PORT !== undefined
  }

  /** Resolve the directory containing the embedding-fix overlay. */
  private resolveFixesSource(): string | undefined {
    for (const candidate of FIXES_SOURCES) {
      if (existsSync(join(candidate, 'template.js'))) return candidate
    }
    return undefined
  }

  /**
   * Copy the embedding-fix overlay into the checkout's customize/ directory.
   * Unlike the old silent catch, a missing/incorrect overlay now fails the
   * start request so the client gets a clear error instead of a blank iframe.
   */
  private ensureFixes(): void {
    const dest = join(CRYPTPAD_DIR, 'customize')
    const marker = join(dest, 'template.js')
    const source = this.resolveFixesSource()
    const installed = existsSync(marker) && readFileSync(marker, 'utf-8').includes('dsh-workspace-cryptpad')
    // 已安装且 source 缺失（repacked / read-only 安装）→ 沿用现有 overlay，不强求 source 树。
    if (installed && source === undefined) return
    if (source === undefined) {
      throw new Error(
        `[dsh-workspace-cryptpad] embedding fixes are missing (looked in: ${FIXES_SOURCES.join(', ')}). ` +
        `Run "pnpm run build" in dsh-workspace-cryptpad and reinstall/repackage the desktop shell.`,
      )
    }
    try {
      // 有 source → 每次覆盖安装（先清空再复制），保证 cryptpad-fixes 的更新能落到运行期
      // checkout（旧实现只装一次：marker 存在即返回，导致 overlay 残留旧版、修复不生效）。
      rmSync(dest, { recursive: true, force: true })
      cpSync(source, dest, { recursive: true })
    } catch (cause) {
      const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
      throw new Error(`[dsh-workspace-cryptpad] failed to install embedding fixes into ${dest}: ${detail}`)
    }
    if (!existsSync(marker) || !readFileSync(marker, 'utf-8').includes('dsh-workspace-cryptpad')) {
      throw new Error(`[dsh-workspace-cryptpad] embedding fixes were copied but ${marker} is missing or invalid`)
    }
  }

  /**
   * Patch the checkout's lib/http-worker.js so COEP require-corp is skipped when
   * embedding is enabled (see COEP_PATCH_MARKER). Idempotent: re-applied on every
   * start after a pnpm reinstall restores the pristine file. Failure to patch is
   * non-fatal (the server still starts, but embedded apps may hang on loading).
   */
  private ensureServerPatches(): void {
    if (!existsSync(HTTP_WORKER_FILE)) return
    let src: string
    try { src = readFileSync(HTTP_WORKER_FILE, 'utf-8') } catch { return }
    if (src.includes(COEP_PATCH_MARKER)) return // already patched
    const from = `headers["Cross-Origin-Embedder-Policy"] = 'require-corp';`
    const to = `if (!Env.enableEmbedding) { headers["Cross-Origin-Embedder-Policy"] = 'require-corp'; } // ${COEP_PATCH_MARKER}`
    if (!src.includes(from)) {
      process.stderr.write(`[dsh-workspace-cryptpad] http-worker.js COEP line not found (skipping patch)\n`)
      return
    }
    try {
      writeFileSync(HTTP_WORKER_FILE, src.replace(from, to))
      process.stderr.write('[dsh-workspace-cryptpad] patched http-worker.js (COEP skipped when embedded)\n')
    } catch (cause) {
      process.stderr.write(`[dsh-workspace-cryptpad] http-worker.js patch failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    }
  }

  /**
   * Ensure www/components exists (missing on a fresh git checkout). Prefers the
   * checkout's own copy script; falls back to copying from the resolved
   * dependency tree.
   */
  private async ensureComponents(): Promise<void> {
    if (existsSync(COMPONENTS_MARKER)) return
    process.stderr.write('[dsh-workspace-cryptpad] building www/components…\n')
    try {
      await this.runNode(['scripts/copy-components.js'], CRYPTPAD_DIR)
      if (existsSync(COMPONENTS_MARKER)) return
    } catch (cause) {
      process.stderr.write(`[dsh-workspace-cryptpad] copy-components failed (${cause instanceof Error ? cause.message : String(cause)}); copying from dependency tree\n`)
    }
    this.copyComponentsManually()
  }

  /**
   * Ensure the real drawio webapp is present in www/components/drawio.
   * pnpm 的 drawio 依赖被 override 成 vendor/drawio-stub 占位（无 index.html），真实 drawio
   * 由 scripts/ensure-drawio.mjs 从镜像下载（版本 pin + 可选 sha256 校验）。marker 存在即视为
   * 已安装；设 DRAWIO_FORCE=1 强制重装 / 升级版本。必须在 copy-components 之后执行（其会覆盖 drawio）。
   */
  private async ensureDrawio(): Promise<void> {
    if (existsSync(DRAWIO_MARKER) && process.env.DRAWIO_FORCE !== '1') {
      return
    }
    await this.runNode(['scripts/ensure-drawio.mjs', CRYPTPAD_DIR], PACKAGE_ROOT)
  }

  /** Fallback: copy each component from the checkout's sibling dependency dir. */
  private copyComponentsManually(): void {
    const dest = join(CRYPTPAD_DIR, 'www', 'components')
    mkdirSync(dest, { recursive: true })
    // Under pnpm the checkout's direct dependencies live next to it in
    // .pnpm/<cryptpad>/node_modules/ (this package's host cannot resolve them).
    const depRoot = dirname(CRYPTPAD_DIR)
    for (const name of COMPONENTS) {
      const src = join(depRoot, name)
      if (!existsSync(src)) {
        process.stderr.write(`[dsh-workspace-cryptpad] component ${name} not found at ${src}\n`)
        continue
      }
      try {
        cpSync(src, join(dest, name), { recursive: true, dereference: true })
      } catch (cause) {
        process.stderr.write(`[dsh-workspace-cryptpad] component ${name} copy failed: ${String(cause)}\n`)
      }
    }
  }

  /** Environment for spawning a Node child, using Electron-as-node when applicable. */
  private nodeEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env = { ...process.env, ...extra }
    if (process.env.CRYPTPAD_NODE === undefined && process.versions.electron !== undefined) {
      env.ELECTRON_RUN_AS_NODE = '1'
    }
    return env
  }

  /**
   * Run a node script in a working directory; resolve on exit 0.
   * In Electron this uses `process.execPath` with `ELECTRON_RUN_AS_NODE=1`,
   * so the packaged app does not depend on a system `node` being on PATH.
   */
  private runNode(args: string[], cwd: string): Promise<void> {
    const nodeBin = process.env.CRYPTPAD_NODE ?? process.execPath
    return new Promise((resolve, reject) => {
      const child = spawn(nodeBin, args, { cwd, env: this.nodeEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout?.on('data', (d: Buffer) => { out += String(d) })
      child.stderr?.on('data', (d: Buffer) => { out += String(d) })
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`node ${args[0]} exited ${String(code)}: ${out.slice(-500)}`))
      })
    })
  }

  /** Spawn the CryptPad node server using a real node or Electron-as-node. */
  private spawnCryptpad(): ChildProcess {
    const nodeBin = process.env.CRYPTPAD_NODE ?? process.execPath
    return spawn(nodeBin, [CRYPTPAD_SERVER], {
      cwd: CRYPTPAD_DIR,
      env: this.nodeEnv({ CRYPTPAD_CONFIG: CONFIG_FILE }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  /**
   * Poll the CryptPad origin until it answers (or the timeout elapses).
   * The spawned child is watched as well: if it dies, the port is almost
   * certainly taken by another instance and its HTTP response must NOT be
   * mistaken for our sidecar becoming ready.
   */
  private async waitForReady(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    const probe = async (): Promise<boolean> => {
      try {
        const res = await fetch(`http://127.0.0.1:${String(this.port)}/`)
        return res.status >= 200
      } catch {
        return false
      }
    }
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `CryptPad sidecar exited (code ${String(child.exitCode ?? child.signalCode)}); ` +
          `port ${String(this.port)} is likely in use by another instance. ` +
          `Stop that instance (or set CRYPTPAD_PORT to a free port).`,
        )
      }
      if (await probe()) return
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`CryptPad server did not become ready on port ${String(this.port)} within ${String(READY_TIMEOUT_MS)}ms`)
  }
}

/**
 * Register the CryptPad portal route, the settings route and the sidecar
 * lifetime with the host.
 * @param ctx - Host context carrying the Web server.
 */
export function apply(ctx: any): void {
  const sidecar = new CryptpadSidecar(currentSettings().port)
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: PORTAL_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
          return
        }
        if (req.headers.origin !== origin) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'forbidden' }))
          return
        }
        try {
          const url = await sidecar.start()
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, url }))
        } catch (cause) {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            ok: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }))
        }
      },
    }),
    'dsh-workspace-cryptpad: portal route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: `${PORTAL_PATH}/settings`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'GET') {
          const s = currentSettings()
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ dataDir: s.dataDir ?? join(PACKAGE_ROOT, 'runtime'), port: s.port, maxUploadMB: s.maxUploadMB, storageLimitGB: s.storageLimitGB }))
          return
        }
        if (req.method === 'POST') {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(Buffer.from(chunk))
          let body: { dataDir?: unknown; port?: unknown; maxUploadMB?: unknown; storageLimitGB?: unknown } = {}
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') } catch { /* malformed → keep old */ }
          const pos = (v: unknown): number | undefined => {
            const n = Number(v)
            return Number.isFinite(n) && n > 0 ? n : undefined
          }
          mkdirSync(dirname(SETTINGS_FILE), { recursive: true })
          writeFileSync(SETTINGS_FILE, JSON.stringify({
            dataDir: typeof body.dataDir === 'string' && body.dataDir.trim().length > 0 ? body.dataDir.trim() : undefined,
            port: pos(body.port),
            maxUploadMB: pos(body.maxUploadMB),
            storageLimitGB: pos(body.storageLimitGB),
          }, null, 2) + '\n')
          // 若 CryptPad 正在运行，停掉；下次打开按新设置重启
          sidecar.stop()
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
      },
    }),
    'dsh-workspace-cryptpad: settings route',
  )
  ctx.effect(
    () => () => { sidecar.stop() },
    'dsh-workspace-cryptpad: sidecar lifetime',
  )
}
