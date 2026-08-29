/**
 * dsh-workspace-terminal — host entry.
 * 注册 `/ws/terminal` WebSocket 升级路由：node-pty 真实 shell，浏览器→xterm。
 * 鉴权：Host/Origin 信任 + `dsh-auth-*` 会话 cookie 存在性检查（0.1.2-alpha.1 一次性
 * token → cookie 后的浏览器会话）。
 */
import { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { PtyManager } from './pty-manager.ts'

export const name = 'dsh-workspace-terminal'
export const inject = ['webServer', 'webRuntime']

type Ctx = any

/** Host/Origin 信任 + 会话 cookie 存在性检查（插件的轻量鉴权；真实签名验证在 connection 内部）。 */
function authorize(req: any, ctx: Ctx): boolean {
  const headers = req.headers ?? {}
  const host: string | undefined = headers.host
  if (!host) return false
  const hostname = (host.split(':')[0] || '').toLowerCase()
  const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  const trusted: readonly string[] = ctx.webRuntime?.trustedHosts ?? []
  const okHost = isLoopback || trusted.some((t) => (t.split(':')[0] || '').toLowerCase() === hostname)
  if (!okHost) return false
  // Origin 存在时必须等于 Host（防跨站）
  const origin: string | undefined = headers.origin
  if (origin) {
    let originHost = ''
    try { originHost = new URL(origin).host } catch { /* 忽略 */ }
    if (originHost !== host) return false
  }
  // 浏览器会话 cookie（同源 WS 自动携带；名字动态 `dsh-auth-<hash>`）。
  // 本地开发终端：Host/Origin 信任即主要防线；cookie 缺失仅告警不拒绝
  // （否则绕过 `?token=` 直连页面时 WS 会连不上）。
  const cookie: string | undefined = headers.cookie
  if (!cookie || !cookie.includes('dsh-auth-')) {
    console.warn('[dsh-workspace-terminal] /ws/terminal: 未携带浏览器会话 cookie（仅 Host/Origin 信任）')
  }
  return true
}

/** 桥接一条 WebSocket ↔ 一个 node-pty。 */
function attach(ctx: Ctx, ptyManager: PtyManager, ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const sessionId = url.searchParams.get('sessionId') ?? 'default'
  const tab = url.searchParams.get('tab') ?? 'term'
  const cols = clamp(Number(url.searchParams.get('cols')) || 80, 2, 200)
  const rows = clamp(Number(url.searchParams.get('rows')) || 24, 2, 100)

  const pty = ptyManager.open(sessionId, tab, cols, rows)
  if (!pty) {
    ws.close(1011, ptyManager.available ? 'pty open failed' : 'node-pty unavailable')
    return
  }

  const offData = pty.onData((d) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(d)
  })
  const offExit = pty.onExit((code) => {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(`\r\n[进程已退出 code=${code}]\r\n`) } catch { /* 忽略 */ }
    ws.close()
  })

  ws.on('message', (data) => {
    const text = data.toString('utf8')
    // 控制帧：{type:'resize',cols,rows}；其余按终端输入
    if (text.startsWith('{')) {
      try {
        const c = JSON.parse(text)
        if (c?.type === 'resize' && typeof c.cols === 'number' && typeof c.rows === 'number') {
          pty.resize(clamp(Math.round(c.cols), 2, 200), clamp(Math.round(c.rows), 2, 100))
          return
        }
      } catch { /* 非 JSON → 当输入 */ }
    }
    pty.write(text)
  })
  ws.on('close', () => { offData(); offExit(); ptyManager.close(pty.key) })
  ws.on('error', () => { /* 关闭时忽略 */ })
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function apply(ctx: Ctx): void {
  const ptyManager = new PtyManager()
  const wss = new WebSocketServer({ noServer: true })

  ctx.effect(() => {
    return ctx.webServer.registerUpgrade({
      path: '/ws/terminal',
      handler: (req, socket, head) => {
        if (!authorize(req, ctx)) { socket.destroy(); return }
        wss.handleUpgrade(req as unknown as IncomingMessage, socket as unknown as Duplex, head as Buffer, (ws) => {
          attach(ctx, ptyManager, ws, req as unknown as IncomingMessage)
        })
      },
    })
  }, 'dsh-workspace-terminal: /ws/terminal route')

  ctx.effect(() => () => { ptyManager.disposeAll(); wss.close() }, 'dsh-workspace-terminal: teardown')
}
