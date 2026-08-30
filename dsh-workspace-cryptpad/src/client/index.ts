/**
 * dsh-workspace-cryptpad client plugin:
 * 有 workspace 服务 → 注册工作台 widget tab（center 区域，CryptPad iframe + 声明式设置）；
 * 无 → 注册侧边栏底部侧车入口 + 覆盖层。
 *
 * 调解逻辑（含 HMR/热重载轮询）与侧车组件为 market/shared/ 模板的本地副本（插件自包含）。
 */

import * as React from 'react'
import { createSidecar } from './sidecar.js'
import { createWorkspaceOrSidecarReconciler } from './reconcile.js'
import { CryptPadWidget } from './CryptPadWidget.js'
import { CryptPadSettingsPanel } from './settings.js'
import { CRYPTPAD_ICON } from './icon.js'

/** 侧车 app id（侧车互斥用）。 */
export const APP_ID = 'dsh-workspace-cryptpad'

/** 工作台 widget 全局唯一 id。 */
export const WIDGET_ID = 'dsh-workspace-cryptpad:pad'

/** 只依赖 slots（始终可用）；workspace 由共享 reconciler 用 ctx.get 可选检测。 */
export const inject = ['slots']

/**
 * Client plugin body: 启动 workspace 可用性调解（widget / 侧车自动切换）。
 * @param ctx - 客户端根 ctx（dynamicCordisContext 门面，ctx.get 为可选服务查找）。
 */
export function apply(ctx: any): void {
  const sidecar = createSidecar(React)
  createWorkspaceOrSidecarReconciler({
    ctx,
    label: 'dsh-workspace-cryptpad: reconcile',
    registerWidget: (workspace) => workspace.registerWidget({
      id: WIDGET_ID,
      title: 'CryptPad',
      icon: (size: number) => React.createElement('img', {
        src: CRYPTPAD_ICON, width: size, height: size, alt: '', style: { display: 'block' },
      }),
      region: 'center',
      order: 60,
      // 声明式设置：dsh 设置页「工作台 → 插件设置」卡片渲染 host 侧 CryptPad 配置
      settings: { render: (handles: any) => React.createElement(CryptPadSettingsPanel, handles) },
      component: CryptPadWidget,
    }),
    registerSidecar: () => {
      sidecar.injectSidecarFooterCss()
      return ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: APP_ID, order: 100 },
          sidecar.createSidecarEntry({
            id: APP_ID, icon: '📝', label: 'CryptPad',
            loadPage: () => Promise.resolve(() => React.createElement(CryptPadWidget)),
          }),
        ))
    },
  })
}
