// @ts-nocheck — React 为运行时注入种子模块；类型宽松
/**
 * dsh-workspace-terminal — 插件主体：
 * 有 workspace 服务 → 注册「终端」widget tab（经 /ws/terminal 连宿主 pty）；
 * 无 → 回退注册为侧边栏底部侧车入口 + 帧级覆盖层。
 *
 * 调解逻辑（含 HMR/热重载轮询）与侧车组件为 market/shared/ 模板的本地副本
 * （React 以 deps 注入传给 createSidecar，兼容本插件 iife 构建）。
 */
import { TerminalWidget } from './terminal.tsx'
import { createSidecar } from './sidecar.ts'
import { createWorkspaceOrSidecarReconciler } from './reconcile.ts'

const WIDGET_ID = 'dsh-workspace-terminal:term'
const APP_ID = 'dsh-workspace-terminal'

/** 拼 /ws/terminal 的 ws URL（sessionId 固定 default，tab 区分实例）。 */
function wsUrl(tab: string): string {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
    + '/ws/terminal?sessionId=default&tab=' + encodeURIComponent(tab) + '&cols=80&rows=24'
}

export function createPlugin(deps: { React: any }) {
  const React = deps.React
  const inject = ['slots']

  function apply(ctx: any) {
    const sidecar = createSidecar(React)
    createWorkspaceOrSidecarReconciler({
      ctx,
      label: 'dsh-workspace-terminal: reconcile',
      registerWidget: (workspace) => workspace.registerWidget({
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
          const [dshScheme, setDshScheme] = React.useState<string | undefined>(() => props.ctx?.theme?.getTheme?.()?.active?.colorScheme)
          React.useEffect(() => {
            const off = props.ctx?.theme?.onThemeChange?.((snap: any) => { setDshScheme(snap?.active?.colorScheme) })
            return () => { try { off?.() } catch { /* 忽略 */ } }
          }, [props.ctx])
          const theme = settings.theme === 'dark' ? 'dark'
            : settings.theme === 'light' ? 'light'
            : (dshScheme === 'dark' ? 'dark' : 'light')
          const tab = props.instanceId ?? 'term'
          return React.createElement(TerminalWidget, { React, theme, fontSize, wsUrl: wsUrl(tab), active: props.active })
        },
      }),
      registerSidecar: () => {
        sidecar.injectSidecarFooterCss()
        return ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: APP_ID, order: 100 },
            sidecar.createSidecarEntry({
              id: APP_ID, icon: '🖥️', label: '终端',
              loadPage: () => Promise.resolve(() =>
                React.createElement(TerminalWidget, { React, theme: 'light', fontSize: 14, wsUrl: wsUrl('term'), active: true })),
            }),
          ))
      },
    })
  }

  return { apply, inject }
}
