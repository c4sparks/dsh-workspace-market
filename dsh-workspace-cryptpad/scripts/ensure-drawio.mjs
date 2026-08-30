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
 * 已安装（www/components/drawio/src/main/webapp/index.html 存在）且未设 DRAWIO_FORCE=1 时直接退出。
 *
 * 用法：
 *   node scripts/ensure-drawio.mjs [cryptpadDir]
 * 环境变量：DRAWIO_MIRROR_BASE / DRAWIO_VERSION / DRAWIO_SHA256 / DRAWIO_FORCE / DRAWIO_TARGET
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const _require = createRequire(import.meta.url)

function resolveCryptpadDir() {
  try { return dirname(_require.resolve('cryptpad/package.json')) } catch { return '' }
}

const cryptpadDir = process.argv[2] || resolveCryptpadDir()
const TARGET = process.env.DRAWIO_TARGET || (cryptpadDir ? join(cryptpadDir, 'www', 'components', 'drawio') : '')
const VERSION = process.env.DRAWIO_VERSION || 'npm-29.6.7+3'
const MIRROR_BASE = process.env.DRAWIO_MIRROR_BASE || 'https://ghfast.top/'
const EXPECTED_SHA = process.env.DRAWIO_SHA256 || '92c0b3fbf955df7abbfd7c348fe9316fa79eedfc2c7dcd35dea4e856c8ace61b'
const FORCE = process.env.DRAWIO_FORCE === '1'

if (!TARGET) {
  console.error('[ensure-drawio] 无法定位 cryptpad 目录：传 argv[2] 或设 DRAWIO_TARGET')
  process.exit(1)
}

const MARKER = join(TARGET, 'src', 'main', 'webapp', 'index.html')
if (existsSync(MARKER) && !FORCE) {
  console.log(`[ensure-drawio] drawio 已安装（${TARGET}）；设 DRAWIO_FORCE=1 强制重装`)
  process.exit(0)
}

const TARBALL_URL = `${MIRROR_BASE}https://github.com/cryptpad/drawio-npm/archive/refs/tags/${VERSION}.tar.gz`
const tmpTarball = join(tmpdir(), `drawio-${VERSION.replace(/[^a-zA-Z0-9._-]/g, '_')}.tar.gz`)

async function main() {
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

  const extractRoot = join(tmpdir(), `drawio-x-${Date.now()}`)
  mkdirSync(extractRoot, { recursive: true })
  const r = spawnSync('tar', ['-xzf', tmpTarball, '-C', extractRoot], { stdio: 'inherit' })
  if (r.status !== 0) {
    throw new Error('tar 解压失败（需 tar 在 PATH：win10 自带 tar.exe / Git Bash）')
  }
  const top = readdirSync(extractRoot)[0]
  const srcDir = join(extractRoot, top)

  rmSync(TARGET, { recursive: true, force: true })
  mkdirSync(dirname(TARGET), { recursive: true })
  cpSync(srcDir, TARGET, { recursive: true })

  rmSync(extractRoot, { recursive: true, force: true })
  rmSync(tmpTarball, { force: true })
  console.log(`[ensure-drawio] 安装完成 drawio ${VERSION} → ${TARGET}`)
}

main().catch((err) => {
  console.error(`[ensure-drawio] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
