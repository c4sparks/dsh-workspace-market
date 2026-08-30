/**
 * 侧车 fallback 组件工厂（共享工具，5 个 widget 插件共用）。
 *
 * 用工厂注入 React（不裸 import react、不用 JSX），因此同时兼容两种 client 构建：
 *  - dsh-toolkit-* 的 cjs+banner 构建（插件侧 `import React from 'react'` 传入）
 *  - dsh-workspace-terminal 的 iife 构建（插件侧 `deps.React` 传入）
 */

export interface SidecarConfig {
  /** 本插件 app id（侧车互斥用）。 */
  id: string
  /** 侧车按钮图标（emoji）。 */
  icon: string
  /** 侧车按钮文案。 */
  label: string
  /** 工具页懒加载器（返回组件；打开侧车才求值）。 */
  loadPage: () => Promise<any>
}

/** 侧车互斥事件：打开某个侧车时广播，其他侧车监听后自动关闭。 */
const SIDECAR_OPEN_EVENT = 'dsh:sidecar-open'

/** 宿主把 sidebar.footer.action 渲染成单行横向区域，多个入口需垂直堆叠（旧 toolkit 同款 CSS）。 */
const FOOTER_STACK_CSS = `
  div:has(> [data-slot="sidebar.footer.action"]) {
    flex-direction: column !important;
    height: auto !important;
    gap: 4px !important;
  }
  [data-slot="sidebar.footer.action"] {
    display: flex !important;
    flex-direction: column !important;
    gap: 4px !important;
  }
  [data-slot="sidebar.footer.action"] > div { width: 100% !important; }
`

export interface SidecarApi {
  /** 幂等注入 footer 垂直堆叠样式。 */
  injectSidecarFooterCss: () => void
  /** 生成 slots.register 可用的侧车入口组件（绑定配置，slot 透传 props 时忽略）。 */
  createSidecarEntry: (config: SidecarConfig) => () => any
}

/** 侧车组件工厂：React 以参数注入（两个 client 构建通用）。 */
export function createSidecar(React: any): SidecarApi {
  /** 幂等注入 footer 垂直堆叠样式。 */
  function injectSidecarFooterCss(): void {
    if (document.getElementById('dsh-workspace-shared-sidecar-css')) return
    const style = document.createElement('style')
    style.id = 'dsh-workspace-shared-sidecar-css'
    style.textContent = FOOTER_STACK_CSS
    document.head.appendChild(style)
  }

  /**
   * 侧边栏底部入口组件：按钮点击打开帧级覆盖层渲染工具页。
   * 打开时广播 dsh:sidecar-open 互斥，其他侧车自动收起；懒加载工具页。
   */
  function SidecarFooterAction({ id, icon, label, loadPage }: SidecarConfig) {
    const [open, setOpen] = React.useState(false)
    const [Page, setPage] = React.useState(null)

    // 侧车互斥：其他侧车打开时自动关闭本侧车
    React.useEffect(() => {
      const onOpen = (e: Event): void => {
        const other = (e as CustomEvent<string>).detail
        if (other !== id) setOpen(false)
      }
      window.addEventListener(SIDECAR_OPEN_EVENT, onOpen)
      return () => window.removeEventListener(SIDECAR_OPEN_EVENT, onOpen)
    }, [id])

    // 打开时懒加载工具页（结果缓存，重开不重复加载）
    React.useEffect(() => {
      if (!open || Page) return
      let cancelled = false
      loadPage().then((C: any) => { if (!cancelled) setPage(() => C) }).catch(() => { /* 加载失败保持占位 */ })
      return () => { cancelled = true }
    }, [open, Page, loadPage])

    const toggle = (): void => {
      const next = !open
      if (next) window.dispatchEvent(new CustomEvent(SIDECAR_OPEN_EVENT, { detail: id }))
      setOpen(next)
    }

    return React.createElement(
      'div',
      { style: { display: 'flex', width: '100%' } },
      React.createElement(
        'button',
        {
          type: 'button', title: label, 'aria-label': label,
          'data-dsh-toolkit-sidecar-footer': id,
          'data-active': open || undefined,
          onClick: toggle,
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 8, boxSizing: 'border-box',
            width: '100%', height: 42, border: 'none', borderRadius: 12,
            background: open ? 'rgba(0,0,0,0.06)' : 'transparent',
            color: open ? '#111' : '#444', cursor: 'pointer', padding: '0 10px',
            justifyContent: 'flex-start', fontFamily: 'system-ui, sans-serif', fontSize: 14,
            transition: 'background .12s, color .12s',
          },
        },
        React.createElement('span', { style: { fontSize: 16, lineHeight: 1 } }, icon),
        React.createElement('span', null, label),
      ),
      open
        ? React.createElement(SidecarOverlay, { onClose: () => setOpen(false) },
            Page
              ? React.createElement(Page)
              : React.createElement('div', { style: { padding: 40, color: '#999', fontFamily: 'system-ui, sans-serif' } }, '加载中…'))
        : null,
    )
  }

  /** 帧级覆盖层：从侧边栏右缘起覆盖主内容区（读 [data-shell-overlay] 列宽定位）。 */
  function SidecarOverlay({ onClose, children }: { onClose: () => void; children?: any }) {
    const [sidebarRight, setSidebarRight] = React.useState(0)

    React.useEffect(() => {
      let frameEl: Element | null = null
      const findFrame = (): Element | null => {
        frameEl = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
        return frameEl
      }
      let raf = 0
      let last = -1
      const loop = (): void => {
        raf = requestAnimationFrame(loop)
        try {
          const el = frameEl ?? findFrame()
          if (!el) return
          const grid = getComputedStyle(el).gridTemplateColumns
          const track = grid.split(' ')[0]
          const px = Number.parseFloat(track)
          if (!Number.isFinite(px)) return
          const right = el.getBoundingClientRect().left + px
          if (right !== last) { last = right; setSidebarRight(right) }
        } catch { /* 测量失败保持上次值 */ }
      }
      loop()
      return () => cancelAnimationFrame(raf)
    }, [])

    return React.createElement(
      'div',
      {
        'data-dsh-toolkit-sidecar-view': '',
        style: {
          position: 'fixed', left: sidebarRight, top: 0, right: 0, bottom: 0,
          background: '#fff', zIndex: 30, display: 'flex', flexDirection: 'column',
        },
      },
      React.createElement(
        'button',
        {
          'data-dsh-toolkit-sidecar-close': '',
          title: '关闭', 'aria-label': '关闭',
          onClick: onClose,
          style: {
            position: 'absolute', left: 8, top: 8, zIndex: 99999,
            width: 28, height: 28, border: 'none', borderRadius: 8,
            background: 'rgba(0,0,0,0.05)', color: '#111', fontSize: 16, lineHeight: 1, cursor: 'pointer',
          },
        },
        '✕',
      ),
      children
        ? React.createElement('div', { style: { flex: 1, minHeight: 0, paddingTop: 44, overflow: 'auto' } }, children)
        : null,
    )
  }

  /** 生成 slots.register 可用的侧车入口组件（绑定配置，slot 透传 props 时忽略）。 */
  function createSidecarEntry(config: SidecarConfig) {
    return () => React.createElement(SidecarFooterAction, config)
  }

  return { injectSidecarFooterCss, createSidecarEntry }
}
