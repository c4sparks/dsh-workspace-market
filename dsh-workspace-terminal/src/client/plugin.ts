// @ts-nocheck — React 为运行时注入种子模块；类型宽松
/**
 * dsh-workspace-terminal — 插件主体：注册「终端」widget tab，经 /ws/terminal 连宿主 pty。
 */
import { TerminalWidget } from './terminal.tsx'

const WIDGET_ID = 'dsh-workspace-terminal:term'

export function createPlugin(deps: { React: any }) {
  const React = deps.React
  const inject = ['workspace']

  function apply(ctx: any) {
    // 未提供 workspace 服务（dsh-workspace-sidebar 未安装）→ 跳过注册，避免直接抛错
    if (!ctx.workspace) {
      console.warn('[dsh-workspace-terminal] 未找到 workspace 服务（需先安装 dsh-workspace-sidebar），插件已跳过注册')
      return
    }
    ctx.effect(() => {
      return ctx.workspace.registerWidget({
        id: WIDGET_ID,
        title: '终端',
        // Lucide「terminal」图标（内嵌 SVG 路径，随主题 currentColor）
        icon: (size: number) => React.createElement('svg', {
          viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
          strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block' },
        },
          React.createElement('path', { d: 'm4 17 6-6-6-6' }),
          React.createElement('path', { d: 'M12 19h8' })),
        region: 'center',
        order: 50,
        // 可多开：TabBar「+」可开多个终端实例，每个实例独立 pty（不同 tab= → host 不同进程）
        multi: true,
        settings: {
          // 手风琴折叠：设置页插件卡片默认收起，点 ▼/▲ 展开看主题/字号
          collapsible: true,
          fields: [
            {
              type: 'select',
              key: 'theme',
              label: '主题',
              options: [
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ],
            },
            { type: 'number', key: 'fontSize', label: '字号', min: 10, max: 24 },
          ],
        },
        component: (props: any) => {
          const settings = props.service?.getWidgetSettings(WIDGET_ID) ?? {}
          const fontSize = typeof settings.fontSize === 'number' ? settings.fontSize : 14
          // 跟随 dsh 主题（浅色/深色/跟随系统）：
          //  - 设置里显式选「浅色/深色」→ 优先用它；
          //  - 未设置（默认）→ 用 dsh 的 colorScheme（system 已由宿主解析成 light/dark）。
          // 订阅主题变化 → 切换时重渲染 xterm 换色（pty 不变，会话保留）。
          const [dshScheme, setDshScheme] = React.useState<string | undefined>(() => props.ctx?.theme?.getTheme?.()?.active?.colorScheme)
          React.useEffect(() => {
            const off = props.ctx?.theme?.onThemeChange?.((snap: any) => { setDshScheme(snap?.active?.colorScheme) })
            return () => { try { off?.() } catch { /* 忽略 */ } }
          }, [props.ctx])
          const theme = settings.theme === 'dark' ? 'dark'
            : settings.theme === 'light' ? 'light'
            : (dshScheme === 'dark' ? 'dark' : 'light')
          // 每个实例用独立 tab=<instanceId>：host 按 sessionId:tab 隔离 pty → 多开互不干扰
          const tab = props.instanceId ?? 'term'
          const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
            + '/ws/terminal?sessionId=default&tab=' + encodeURIComponent(tab) + '&cols=80&rows=24'
          return React.createElement(TerminalWidget, { React, theme, fontSize, wsUrl, active: props.active })
        },
      })
    }, 'dsh-workspace-terminal: widget')
  }

  return { apply, inject }
}
