#!/usr/bin/env node
/**
 * scripts/ensure-drawio.mjs — 从镜像下载真实 drawio-npm webapp 到 cryptpad 的 www/components/drawio。
 *
 * 背景：cryptpad 的 `drawio` 依赖被 pnpm override 成本地占位 `vendor/drawio-stub`（仅 package.json），
 * 以绕开 GitHub 直连不稳定、避免 169MB vendor 入 git。真实 drawio 由本脚本在插件首启
 * （或手动 `node scripts/ensure-drawio.mjs`）时下载：
 *   - 版本默认 pin `npm-29.6.7+3`（cryptpad 2026.5.1 期望），可用 DRAWIO_VERSION 覆盖；
 *   - 镜像默认 ghfast.top（github 下载代理前缀），可用 DRAWIO_MIRROR_BASE 覆盖；
 *   - 校验和：默认固定 npm-29.6.7+3 的 sha256，可用 DRAWIO_SHA256 覆盖。
 *
 * 持久缓存（本项目盘，不占系统临时盘 C:\Temp）：
 *   - 下载 / 解压都在项目内缓存目录完成（DRAWIO_CACHE，默认 vendor/download/drawio-npm，与项目同盘）；
 *   - 缓存命中且 VERSION 匹配 → 直接拷到 checkout，不再联网；
 *   - node_modules 重装后 checkout 丢失，也从缓存拷，无需重新下载；
 *   - 已安装（checkout 的 www/components/drawio/.../index.html 存在）且未设 DRAWIO_FORCE=1 时直接退出。
 *
 * 用法：
 *   node scripts/ensure-drawio.mjs [cryptpadDir]
 * 环境变量：DRAWIO_MIRROR_BASE / DRAWIO_VERSION / DRAWIO_SHA256 / DRAWIO_FORCE / DRAWIO_TARGET / DRAWIO_CACHE
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const _require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(HERE, '..')

function resolveCryptpadDir() {
  try { return dirname(_require.resolve('cryptpad/package.json')) } catch { return '' }
}

const cryptpadDir = process.argv[2] || resolveCryptpadDir()
const TARGET = process.env.DRAWIO_TARGET || (cryptpadDir ? join(cryptpadDir, 'www', 'components', 'drawio') : '')
const CACHE = process.env.DRAWIO_CACHE || join(PROJECT_ROOT, 'vendor', 'download', 'drawio-npm')
const VERSION = process.env.DRAWIO_VERSION || 'npm-29.6.7+3'
const EXPECTED_DRAWIO_VER = VERSION.replace(/^npm-/, '').replace(/\+.*$/, '')
const MIRROR_BASE = process.env.DRAWIO_MIRROR_BASE || 'https://ghfast.top/'
const EXPECTED_SHA = process.env.DRAWIO_SHA256 || '92c0b3fbf955df7abbfd7c348fe9316fa79eedfc2c7dcd35dea4e856c8ace61b'
const FORCE = process.env.DRAWIO_FORCE === '1'

if (!TARGET) {
  console.error('[ensure-drawio] 无法定位 cryptpad 目录：传 argv[2] 或设 DRAWIO_TARGET')
  process.exit(1)
}

const MARKER = join(TARGET, 'src', 'main', 'webapp', 'index.html')
const CACHE_MARKER = join(CACHE, 'src', 'main', 'webapp', 'index.html')
const cacheVersion = existsSync(join(CACHE, 'VERSION'))
  ? readFileSync(join(CACHE, 'VERSION'), 'utf-8').trim()
  : ''

/** 把 CACHE 拷到 checkout（CryptPad 实际 serve 的位置）。 */
function installToTarget() {
  rmSync(TARGET, { recursive: true, force: true })
  mkdirSync(dirname(TARGET), { recursive: true })
  cpSync(CACHE, TARGET, { recursive: true })
}

if (existsSync(MARKER) && !FORCE) {
  console.log(`[ensure-drawio] drawio 已安装（${TARGET}）；设 DRAWIO_FORCE=1 强制重装`)
  process.exit(0)
}
if (existsSync(CACHE_MARKER) && cacheVersion === EXPECTED_DRAWIO_VER && !FORCE) {
  installToTarget()
  console.log(`[ensure-drawio] 命中缓存 ${CACHE}（${EXPECTED_DRAWIO_VER}）→ 已拷到 ${TARGET}（无需联网）`)
  process.exit(0)
}

const TARBALL_URL = `${MIRROR_BASE}https://github.com/cryptpad/drawio-npm/archive/refs/tags/${VERSION}.tar.gz`
// 工作目录放项目盘、但**在 CACHE 之外**（CACHE 的兄弟目录），避免占系统临时盘（C:\Temp），
// 也避免后续 rmSync(CACHE) 把刚解压的工作文件一起删掉。
const workDir = join(dirname(CACHE), `.drawio-tmp-${Date.now()}`)
const tmpTarball = join(workDir, 'drawio.tar.gz')

async function main() {
  mkdirSync(workDir, { recursive: true })
  console.log(`[ensure-drawio] 下载 ${VERSION} ← ${TARBALL_URL}`)
  const res = await fetch(TARBALL_URL)
  if (!res.ok) {
    throw new Error(`下载失败 HTTP ${res.status} ${res.statusText}（镜像不可达可换 DRAWIO_MIRROR_BASE）`)
  }
  const buf = Buffer.from(await res.arrayBuffer())

  if (EXPECTED_SHA) {
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== EXPECTED_SHA.toLowerCase()) {
      throw new Error(`sha256 不匹配：got ${got}，expected ${EXPECTED_SHA}`)
    }
    console.log('[ensure-drawio] sha256 校验通过')
  } else {
    console.warn('[ensure-drawio] 未设 DRAWIO_SHA256，跳过校验（默认已固定，通常不会走到这里）')
  }
  writeFileSync(tmpTarball, buf)

  const extractRoot = join(workDir, 'x')
  mkdirSync(extractRoot, { recursive: true })
  // Windows 上用系统 bsdtar（System32/tar.exe），避免 Git Bash 的 GNU tar 把 `C:\` 盘符
  // 误当远程主机（"Cannot connect to C: resolve failed"）。路径统一正斜杠。
  const TAR = (process.platform === 'win32' && process.env.SystemRoot)
    ? (process.env.SystemRoot + '\\System32\\tar.exe')
    : 'tar'
  const norm = (p) => p.replace(/\\/g, '/')
  const r = spawnSync(TAR, ['-xzf', norm(tmpTarball), '-C', norm(extractRoot)], { stdio: 'inherit' })
  if (r.status !== 0) {
    throw new Error(`tar 解压失败（exit ${String(r.status)}）：${String(r.stderr || '').slice(-200)}`)
  }
  const top = readdirSync(extractRoot)[0]
  const srcDir = join(extractRoot, top)

  // 写入持久缓存（CACHE），再拷到 checkout
  rmSync(CACHE, { recursive: true, force: true })
  mkdirSync(CACHE, { recursive: true })
  cpSync(srcDir, CACHE, { recursive: true })
  installToTarget()

  rmSync(workDir, { recursive: true, force: true })
  console.log(`[ensure-drawio] 安装完成 drawio ${VERSION} → ${TARGET}（缓存：${CACHE}）`)
}

main().catch((err) => {
  console.error(`[ensure-drawio] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
