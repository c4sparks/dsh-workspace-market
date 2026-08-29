// @ts-nocheck — 纯终端（单面板 xterm + WS）；分屏由 workspace-sidebar 通用能力承载
/**
 * terminal — 终端 widget：单个 xterm 面板（独立 pty）。
 */
import { XTermPane } from './xterm-pane.tsx'

export interface TerminalWidgetProps {
  React: any
  theme: 'dark' | 'light'
  fontSize: number
  wsUrl: string
  active?: boolean
}

export function TerminalWidget(props: TerminalWidgetProps): any {
  const { React, theme, fontSize, wsUrl, active } = props
  return React.createElement('div', {
    style: { height: '100%', background: theme === 'light' ? '#ffffff' : '#1e1e1e' },
  },
    React.createElement(XTermPane, { React, theme, fontSize, wsUrl, active })
  )
}
