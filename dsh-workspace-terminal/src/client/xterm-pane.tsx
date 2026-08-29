// @ts-nocheck — 每面板独立 xterm + WS（tab=<paneId>，host 为每个 tab 独立 pty）
/**
 * xterm-pane — 一个终端面板：xterm.js + 独立 WebSocket（node-pty）。
 */
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import xtermCss from '@xterm/xterm/css/xterm.css'

let cssInjected = false
function ensureCss(): void {
  if (cssInjected) return
  cssInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-workspace-terminal'
  tag.textContent = xtermCss
  document.head.appendChild(tag)
}

export interface XTermPaneProps {
  React: any
  theme: 'dark' | 'light'
  fontSize: number
  wsUrl: string
  /** 是否当前激活 tab（激活时聚焦终端，显示光标）。 */
  active?: boolean
}

/**
 * 双主题完整 ANSI 调色板（xterm theme 的 16 色 + 前景/背景/光标/选区）。
 * 浅色（白底）用暗饱和色保证对比——xterm 默认调色板是给深色背景设计的，
 * 白底下绿/黄/青会太浅看不清输入文字。
 */
const THEMES: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#1a1a1a',
    cursorAccent: '#ffffff',
    selectionBackground: '#b3d7ff',
    black: '#1a1a1a', red: '#c62828', green: '#2e7d32', yellow: '#9a6700',
    blue: '#1565c0', magenta: '#8e24aa', cyan: '#00838f', white: '#e0e0e0',
    brightBlack: '#616161', brightRed: '#d32f2f', brightGreen: '#388e3c',
    brightYellow: '#b8860b', brightBlue: '#1976d2', brightMagenta: '#9c27b0',
    brightCyan: '#00838f', brightWhite: '#f5f5f5',
  },
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    black: '#1e1e1e', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
    brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
    brightCyan: '#29b8db', brightWhite: '#e5e5e5',
  },
}

export function XTermPane(props: XTermPaneProps): any {
  const { React, theme, fontSize, wsUrl, active } = props
  const ref = React.useRef(null)
  const termRef = React.useRef(null)

  React.useEffect(() => {
    ensureCss()
    const el = ref.current
    const term = new XTerm({
      fontSize,
      cursorBlink: true,
      theme: THEMES[theme],
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    term.writeln('dsh-workspace-terminal — 连接中…')

    // 自适应：容器尺寸变化（窗口缩放 / 分屏分隔条拖动）→ 防抖后 fit → pty 随之 resize。
    // 防抖避免覆盖层滑入动画过渡期间按中间尺寸误 fit（否则内容截断「看不全」）。
    let fitTimer = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(fitTimer)
      fitTimer = window.setTimeout(() => { try { fit.fit() } catch { /* 容器尺寸暂不可测 */ } }, 150)
    })
    ro.observe(el)

    // 挂载后**立即 fit**（下一帧，容器尺寸已定）：否则 xterm 先按默认尺寸渲染、溢出容器，
    // 滚动条闪现（面板打开 / 分屏时尤其明显），等 150ms 防抖 fit 才正确。
    const fitRaf = requestAnimationFrame(() => { try { fit.fit() } catch { /* 容器暂不可测 */ } })

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => { term.writeln('已连接（node-pty）。输入 help / exit 试试'); term.focus() }
    ws.onmessage = (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data)
      term.write(data)
    }
    ws.onclose = () => { term.writeln('\r\n[连接已关闭]') }
    ws.onerror = () => { term.writeln('\r\n[连接错误]') }

    const input = (d: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(d) }
    term.onData(input)
    const onResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }
    term.onResize(onResize)

    return () => { cancelAnimationFrame(fitRaf); clearTimeout(fitTimer); ro.disconnect(); ws.close(); term.dispose(); termRef.current = null }
  }, [theme, fontSize, wsUrl])

  // 变激活（或打开时）聚焦终端 → 显示光标；等一帧等布局可见再 focus
  React.useEffect(() => {
    if (!active) return
    const t = setTimeout(() => { try { termRef.current?.focus() } catch { /* 忽略 */ } }, 80)
    return () => clearTimeout(t)
  }, [active])

  return React.createElement('div', { ref, style: { height: '100%', padding: 4, boxSizing: 'border-box' } })
}
