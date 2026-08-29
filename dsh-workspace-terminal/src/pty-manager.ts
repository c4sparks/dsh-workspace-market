/**
 * dsh-workspace-terminal — node-pty 生命周期（懒加载，缺失降级）。
 */
import { createRequire } from 'node:module'

export interface PtyHandle {
  key: string
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): () => void
  onExit(cb: (code: number) => void): () => void
}

export class PtyManager {
  private readonly ptys = new Map<string, PtyHandle>()
  private readonly nodePty: any
  private readonly shell: string

  constructor() {
    this.shell = process.env.SHELL
      || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')
    let np: any = null
    try {
      const require = createRequire(import.meta.url)
      np = require('node-pty')
    } catch { /* node-pty 缺失 → available=false，宿主降级处理 */ }
    this.nodePty = np
  }

  /** node-pty 是否可用（不可用时终端降级横幅）。 */
  get available(): boolean { return this.nodePty !== null }

  open(sessionId: string, tab: string, cols: number, rows: number): PtyHandle | null {
    if (!this.nodePty) return null
    const key = `${sessionId}:${tab}`
    const pty = this.nodePty.spawn(this.shell, [], {
      name: 'xterm-256color', cols, rows,
      cwd: process.cwd(), env: process.env,
    })
    const handle: PtyHandle = {
      key,
      write: (d) => { try { pty.write(d) } catch { /* closed */ } },
      resize: (c, r) => { try { pty.resize(c, r) } catch { /* closed */ } },
      kill: () => { try { pty.kill() } catch { /* already gone */ } },
      onData: (cb) => {
        const l = (d: string) => cb(d)
        pty.onData(l)
        return () => { try { pty.removeListener('data', l) } catch { /* noop */ } }
      },
      onExit: (cb) => {
        const l = (e: { exitCode: number }) => cb(e.exitCode)
        pty.onExit(l)
        return () => { try { pty.removeListener('exit', l) } catch { /* noop */ } }
      },
    }
    this.ptys.set(key, handle)
    return handle
  }

  close(key: string): void {
    const h = this.ptys.get(key)
    if (h) { h.kill(); this.ptys.delete(key) }
  }

  disposeAll(): void {
    for (const h of this.ptys.values()) h.kill()
    this.ptys.clear()
  }
}
