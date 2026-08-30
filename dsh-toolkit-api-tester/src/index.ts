/**
 * dsh-toolkit-api-tester host plugin.
 *
 * 提供接口管理需要的宿主能力：
 *  - POST /_dsh/desktop/toolkit/proxy —— HTTP 代理转发（Node 打点，规避 CORS）
 *  - /_dsh/desktop/toolkit/api-tester/* —— SQLite CRUD（收藏树/接口/请求历史，better-sqlite3）
 *
 * 注：与旧的 toolkit-sidecar 路由互斥（同一批 /_dsh/desktop/toolkit/* 路径），装配前须先移除旧插件。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

/** Stable Cordis plugin name (diagnostics only). */
export const name = 'dsh-toolkit-api-tester'

/** Services required before the route can be registered. */
export const inject = ['webServer']

/** Same-origin route prefix served to the client half（与旧 toolkit 保持同路径，客户端零改动）。 */
const ROUTE_PATH = '/_dsh/desktop/toolkit'

/** asar 虚拟路径重写为 .asar.unpacked 真实路径（打包时原生 fs 可读写）。 */
function unpackAsarPath(p: string): string {
  const marker = p.indexOf('.asar')
  if (marker === -1) return p
  return `${p.slice(0, marker)}.asar.unpacked${p.slice(marker + '.asar'.length)}`
}

/** 本插件包根目录（lib/ 在下一级）。 */
const PACKAGE_ROOT = unpackAsarPath(fileURLToPath(new URL('..', import.meta.url)))

/** 数据存储目录（SQLite）。 */
const DATA_DIR = join(PACKAGE_ROOT, 'runtime', 'data')

// ---- 接口管理 SQLite（better-sqlite3）----

mkdirSync(DATA_DIR, { recursive: true })
const apiDb = new Database(join(DATA_DIR, 'api-tester.db'))
apiDb.pragma('journal_mode = WAL')
apiDb.exec(`
  CREATE TABLE IF NOT EXISTS api_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saved_apis (
    id TEXT PRIMARY KEY,
    folder_id TEXT,
    name TEXT NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    headers TEXT,
    body_type TEXT,
    body TEXT,
    kv_body TEXT,
    gql_query TEXT,
    gql_variables TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS request_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    headers TEXT,
    body_type TEXT,
    body TEXT,
    status TEXT,
    created_at TEXT
  );
`)

/** 收集并解析 JSON 请求体。 */
async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  try { return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') } catch { return {} }
}

/** 代理转发超时（ms）。 */
const PROXY_TIMEOUT_MS = 30_000

interface ProxyTiming { dns: number; connect: number; tls: number; ttfb: number; total: number }

/**
 * 用 node:http/https 手动请求转发，并通过 socket 事件采集分阶段耗时
 * （DNS / TCP / TLS / TTFB / 总耗时），近似 curl --write-out。
 */
function timedRequest(
  url: string, method: string, headers: Record<string, string> | undefined,
  body: string | undefined, timeoutMs: number,
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; timing: ProxyTiming }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === 'https:' ? httpsRequest : httpRequest
    const timing: ProxyTiming = { dns: 0, connect: 0, tls: 0, ttfb: 0, total: 0 }
    const start = performance.now()
    const req = mod(u, { method, headers: headers ?? {} }, (res) => {
      timing.ttfb = performance.now() - start
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(Buffer.from(c)))
      res.on('end', () => {
        timing.total = performance.now() - start
        const outHeaders: Record<string, string> = {}
        for (const [k, v] of Object.entries(res.headers)) {
          outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v)
        }
        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          headers: outHeaders,
          body: Buffer.concat(chunks).toString('utf-8'),
          timing,
        })
      })
    })
    req.on('socket', (socket) => {
      socket.on('lookup', () => { timing.dns = performance.now() - start })
      socket.on('connect', () => { timing.connect = performance.now() - start })
      socket.on('secureConnect', () => { timing.tls = performance.now() - start })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
    setTimeout(() => req.destroy(new Error('timeout')), timeoutMs).unref()
  })
}

// ---- 接口管理 SQLite CRUD（better-sqlite3）----

function safeJson(s: unknown, fallback: unknown): unknown {
  if (typeof s !== 'string' || s.length === 0) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

function genId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

async function apiTesterHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
  const rel = pathname.replace(/^\/_dsh\/desktop\/toolkit\/api-tester/, '')
  const method = req.method ?? ''
  const json = (code: number, data: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  try {
    const body = method === 'POST' ? await readJsonBody(req) : {}

    if (rel === '/tree' && method === 'GET') {
      const folders = apiDb.prepare('SELECT id, name, parent_id AS parentId, created_at AS createdAt FROM api_folders').all() as Array<{ id: string; name: string; parentId: string | null }>
      const rows = apiDb.prepare('SELECT id, folder_id AS folderId, name, method, url, headers, body_type AS bodyType, body, kv_body AS kvBody, gql_query AS gqlQuery, gql_variables AS gqlVariables, created_at AS createdAt FROM saved_apis').all() as Array<Record<string, unknown>>
      json(200, {
        ok: true,
        data: {
          folders,
          apis: rows.map((r) => ({
            id: String(r.id), folderId: r.folderId ?? null, name: String(r.name), method: String(r.method), url: String(r.url),
            headers: safeJson(r.headers, {}), bodyType: r.bodyType ?? 'none', body: r.body ?? '',
            kvBody: safeJson(r.kvBody, []), gqlQuery: r.gqlQuery ?? '', gqlVariables: r.gqlVariables ?? '',
            time: r.createdAt ?? '',
          })),
        },
      })
      return
    }

    if (rel === '/folders' && method === 'POST') {
      const { name, parentId } = body ?? {}
      const id = genId('f')
      apiDb.prepare('INSERT INTO api_folders (id, name, parent_id, created_at) VALUES (?,?,?,?)').run(id, String(name), parentId ?? null, new Date().toLocaleString())
      json(200, { ok: true, data: { id, name, parentId: parentId ?? null } })
      return
    }
    if (rel === '/folders/rename' && method === 'POST') {
      apiDb.prepare('UPDATE api_folders SET name = ? WHERE id = ?').run(String((body as any).name), String((body as any).id))
      json(200, { ok: true })
      return
    }
    if (rel === '/folders/delete' && method === 'POST') {
      const collect = (id: string, acc: string[]): string[] => {
        acc.push(id)
        const kids = apiDb.prepare('SELECT id FROM api_folders WHERE parent_id = ?').all(id) as Array<{ id: string }>
        for (const k of kids) collect(k.id, acc)
        return acc
      }
      const ids = collect(String((body as any).id), [])
      const marks = ids.map(() => '?').join(',')
      apiDb.prepare(`DELETE FROM saved_apis WHERE folder_id IN (${marks})`).run(...ids)
      apiDb.prepare(`DELETE FROM api_folders WHERE id IN (${marks})`).run(...ids)
      json(200, { ok: true })
      return
    }

    if (rel === '/apis' && method === 'POST') {
      const a = (body ?? {}) as any
      const now = new Date().toLocaleString()
      apiDb.prepare('INSERT INTO saved_apis (id, folder_id, name, method, url, headers, body_type, body, kv_body, gql_query, gql_variables, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(a.id ?? genId('a'), a.folderId ?? null, a.name, a.method, a.url,
          JSON.stringify(a.headers ?? {}), a.bodyType ?? 'none', a.body ?? '', JSON.stringify(a.kvBody ?? []), a.gqlQuery ?? '', a.gqlVariables ?? '', now, now)
      json(200, { ok: true })
      return
    }
    if (rel === '/apis/rename' && method === 'POST') {
      apiDb.prepare('UPDATE saved_apis SET name = ? WHERE id = ?').run(String((body as any).name), String((body as any).id))
      json(200, { ok: true })
      return
    }
    if (rel === '/apis/copy' && method === 'POST') {
      const row = apiDb.prepare('SELECT * FROM saved_apis WHERE id = ?').get(String((body as any).id)) as Record<string, unknown> | undefined
      if (!row) { json(404, { ok: false, error: 'api not found' }); return }
      const now = new Date().toLocaleString()
      const newId = genId('a')
      apiDb.prepare('INSERT INTO saved_apis (id, folder_id, name, method, url, headers, body_type, body, kv_body, gql_query, gql_variables, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(newId, row.folder_id, row.name, row.method, row.url, row.headers, row.body_type, row.body, row.kv_body, row.gql_query, row.gql_variables, now, now)
      json(200, { ok: true, data: { id: newId } })
      return
    }
    if (rel === '/apis/delete' && method === 'POST') {
      apiDb.prepare('DELETE FROM saved_apis WHERE id = ?').run(String((body as any).id))
      json(200, { ok: true })
      return
    }

    if (rel === '/history' && method === 'GET') {
      const rows = apiDb.prepare('SELECT method, url, headers, body_type AS bodyType, body, status, created_at AS createdAt FROM request_history ORDER BY id DESC LIMIT 50').all() as Array<Record<string, unknown>>
      json(200, {
        ok: true,
        data: rows.map((r) => ({
          method: String(r.method), url: String(r.url), headers: safeJson(r.headers, undefined), bodyType: r.bodyType ?? 'none', body: r.body ?? '', status: r.status ?? undefined, time: r.createdAt ?? '',
        })),
      })
      return
    }
    if (rel === '/history' && method === 'POST') {
      const h = (body ?? {}) as any
      apiDb.prepare('INSERT INTO request_history (method, url, headers, body_type, body, status, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(String(h.method), String(h.url), h.headers ? JSON.stringify(h.headers) : null, h.bodyType ?? null, h.body ?? null, h.status ?? null, h.time ?? new Date().toLocaleString())
      apiDb.prepare('DELETE FROM request_history WHERE id NOT IN (SELECT id FROM request_history ORDER BY id DESC LIMIT 50)').run()
      json(200, { ok: true })
      return
    }
    if (rel === '/history/clear' && method === 'POST') {
      apiDb.prepare('DELETE FROM request_history').run()
      json(200, { ok: true })
      return
    }

    json(404, { ok: false, error: 'not found' })
  } catch (cause) {
    json(500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
  }
}

/**
 * Register the api-tester routes with the host:
 *  - /proxy —— HTTP 代理转发（接口管理用，Node 无 CORS 限制）
 *  - /api-tester —— SQLite CRUD（收藏树/接口/历史）
 * @param ctx - Host context carrying the Web server.
 */
export function apply(ctx: any): void {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: `${ROUTE_PATH}/api-tester`,
      handler: apiTesterHandler,
    }),
    'dsh-toolkit-api-tester: api-tester route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PATH}/proxy`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
          return
        }
        const body = await readJsonBody(req)
        const { method, url, headers, body: reqBody, bodyIsBase64 } = body ?? {}
        if (typeof url !== 'string' || url.length === 0) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'url required' }))
          return
        }
        const m = typeof method === 'string' && method.length > 0 ? method : 'GET'
        // Binary 请求体：base64 解码为原始字节再发送
        const payload: string | undefined = typeof reqBody === 'string' && reqBody.length > 0
          ? (bodyIsBase64 === true ? Buffer.from(reqBody, 'base64').toString('binary') : reqBody)
          : undefined
        try {
          const upstream = await timedRequest(
            url,
            m,
            headers && typeof headers === 'object' ? (headers as Record<string, string>) : undefined,
            payload,
            PROXY_TIMEOUT_MS,
          )
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            status: upstream.status,
            statusText: upstream.statusText,
            headers: upstream.headers,
            body: upstream.body,
            elapsedMs: Math.round(upstream.timing.total),
            timing: {
              dns: Math.round(upstream.timing.dns),
              connect: Math.round(upstream.timing.connect),
              tls: Math.round(upstream.timing.tls),
              ttfb: Math.round(upstream.timing.ttfb),
              total: Math.round(upstream.timing.total),
            },
          }))
        } catch (cause) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            ok: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }))
        }
      },
    }),
    'dsh-toolkit-api-tester: proxy route',
  )
}
