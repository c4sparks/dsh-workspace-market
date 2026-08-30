/**
 * dsh-toolkit-api-tester client plugin:
 * 有 workspace 服务 → 注册工作台 widget tab（right 区域，懒加载）；无 → 注册侧边栏底部侧车入口 + 覆盖层。
 *
 * 调解逻辑（含 HMR/热重载轮询）与侧车组件为 market/shared/ 模板的本地副本（插件自包含）。
 */

import * as React from 'react'
import { createSidecar } from './sidecar.js'
import { createWorkspaceOrSidecarReconciler } from './reconcile.js'

/** 侧车 app id（侧车互斥用）。 */
export const APP_ID = 'dsh-toolkit-api-tester'

/** 工作台 widget 全局唯一 id。 */
export const WIDGET_ID = 'dsh-toolkit-api-tester:panel'

/** 只依赖 slots（始终可用）；workspace 由共享 reconciler 用 ctx.get 可选检测。 */
export const inject = ['slots']

/** 工具页懒加载器（widget loadComponent 与侧车 loadPage 共用）。 */
function loadApiTester() {
  return import('./pages/ApiTester.js').then((m) => m.ApiTester)
}

/**
 * Client plugin body: 启动 workspace 可用性调解（widget / 侧车自动切换）。
 * @param ctx - 客户端根 ctx（dynamicCordisContext 门面，ctx.get 为可选服务查找）。
 */
export function apply(ctx: any): void {
  const sidecar = createSidecar(React)
  createWorkspaceOrSidecarReconciler({
    ctx,
    label: 'dsh-toolkit-api-tester: reconcile',
    registerWidget: (workspace) => workspace.registerWidget({
      id: WIDGET_ID,
      title: '接口管理',
      icon: '🔌',
      region: 'right',
      order: 30,
      loadComponent: loadApiTester,
    }),
    registerSidecar: () => {
      sidecar.injectSidecarFooterCss()
      return ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: APP_ID, order: 100 },
          sidecar.createSidecarEntry({
            id: APP_ID, icon: '🔌', label: '接口管理',
            loadPage: loadApiTester,
          }),
        ))
    },
  })
}
