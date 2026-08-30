/**
 * CryptPad widget 面板组件：工作台 tab 内嵌 CryptPad iframe。
 * 打开时 POST /_dsh/desktop/cryptpad 让 host 启动 CryptPad 并返回 portal URL。
 * 同时用作侧车 fallback 的覆盖层内容（共享 SidecarOverlay 提供定位，本组件只负责填充）。
 */

import { useEffect, useState } from 'react'

/** Same-origin route the host half serves; returns { ok, url }. */
const PORTAL_PATH = '/_dsh/desktop/cryptpad'

export function CryptPadWidget(_props: { active?: boolean }): any {
  const [portalUrl, setPortalUrl] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const loadPortal = (): void => {
    setPortalUrl(undefined)
    setError(undefined)
    fetch(PORTAL_PATH, { method: 'POST' })
      .then((res) => res.json())
      .then((body: { ok: boolean; url?: string; error?: string }) => {
        if (body.ok !== true || typeof body.url !== 'string') {
          setError(body.error ?? '无法启动 CryptPad')
          return
        }
        setPortalUrl(body.url)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }

  useEffect(() => { loadPortal() }, [])

  return (
    <div style={{ width: '100%', height: '100%', background: '#fff', position: 'relative', fontFamily: 'system-ui, sans-serif' }}>
      {portalUrl === undefined ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 14 }}>
          <div>{error ?? '正在启动 CryptPad…'}</div>
          {error ? (
            <button
              onClick={loadPortal}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', background: '#fff', color: '#374151', fontSize: 13 }}
            >
              重试
            </button>
          ) : null}
        </div>
      ) : (
        <iframe
          src={portalUrl}
          style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
          allow="clipboard-read; clipboard-write; fullscreen; popups"
          title="CryptPad"
        />
      )}
    </div>
  )
}
