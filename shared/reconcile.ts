/**
 * workspace 可用性调解器（共享工具，5 个 widget 插件共用）。
 *
 * 解决 HMR/热重载下插件先于 workspace 加载（或 workspace 重载换实例）导致的误判：
 * 周期性重查 `ctx.get('workspace')` 的实例引用，变化（出现 / 消失 / 换实例）就 teardown 旧的
 * （dispose widget/sidecar + clearInterval）再按新状态注册。
 *
 * 纯逻辑、不依赖 React，两个 client 构建（cjs+banner / iife）都能用。
 */

export interface ReconcilerOptions {
  /** 客户端根 ctx（dynamicCordisContext 门面，需支持 ctx.get 可选服务查找）。 */
  ctx: any
  /** workspace 可用时注册 widget（参数为 workspace 服务），返回 disposer。 */
  registerWidget: (workspace: any) => () => void
  /** workspace 不可用时注册侧车，返回 disposer。 */
  registerSidecar: () => () => void
  /** 重查间隔 ms（默认 1000）。 */
  intervalMs?: number
  /**
   * 侧车注册宽限期 ms（默认 2000）。workspace 缺失时**延迟** `sidecarGraceMs` 才注册侧车，
   * 给 workspace 一个出现窗口——启动 / HMR 竞态下 workspace 通常很快（毫秒级）就绪，
   * 立即注册侧车会造成「侧车闪现后被 widget 顶掉」的不稳定。宽限期内 workspace 出现则由
   * 下一轮 sync 直接切 widget，侧车根本不注册；真正无宿主时才在宽限期后落侧车。
   */
  sidecarGraceMs?: number
  /** ctx.effect 标签。 */
  label?: string
}

/** 启动调解：立即 sync 一次，并周期性重查；disposer 已挂到 ctx.effect（插件卸载自动清理）。 */
export function createWorkspaceOrSidecarReconciler(options: ReconcilerOptions): { dispose: () => void } {
  const {
    ctx, registerWidget, registerSidecar,
    intervalMs = 1000, sidecarGraceMs = 2000, label = 'workspace/sidecar reconcile',
  } = options
  let sidecarDispose: (() => void) | null = null
  let widgetDispose: (() => void) | null = null
  let poll: number | null = null
  let sidecarTimer: number | null = null
  let lastWs: unknown = null

  const teardown = (): void => {
    if (poll != null) { window.clearInterval(poll); poll = null }
    if (sidecarTimer != null) { window.clearTimeout(sidecarTimer); sidecarTimer = null }
    if (sidecarDispose) { sidecarDispose(); sidecarDispose = null }
    if (widgetDispose) { widgetDispose(); widgetDispose = null }
  }

  const sync = (): void => {
    const workspace = ctx.get('workspace')
    if (workspace === lastWs) return
    lastWs = workspace
    teardown()
    if (workspace) {
      widgetDispose = registerWidget(workspace)
    } else {
      // 优雅降级：延迟侧车注册，宽限期内 workspace 出现则跳过（下一轮 sync 切 widget）。
      sidecarTimer = window.setTimeout(() => {
        sidecarTimer = null
        if (ctx.get('workspace') !== undefined) return
        sidecarDispose = registerSidecar()
      }, sidecarGraceMs)
    }
    // 重查期间保持轮询（workspace 未就绪时等它出现；就绪后也等 workspace 重载换实例）
    if (poll == null) poll = window.setInterval(sync, intervalMs)
  }

  sync()
  ctx.effect(() => teardown, label)
  return { dispose: teardown }
}
