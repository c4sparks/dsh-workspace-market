/**
 * CryptPad widget 设置面板：经 /_dsh/desktop/cryptpad/settings 读写 host 侧 CryptPad 配置
 * （数据目录 / 端口 / 上传上限 / 存储配额）。作为 WidgetDescriptor.settings.render 渲染在
 * dsh 设置页「工作台 → 插件设置」卡片里；保存会停止运行的 CryptPad，下次打开按新设置重启。
 */

import { useEffect, useState } from 'react'

/** Same-origin route the host half serves for the settings document. */
const SETTINGS_PATH = '/_dsh/desktop/cryptpad/settings'

interface SettingsForm {
  dataDir: string
  port: string
  maxUploadMB: string
  storageLimitGB: string
}

const rowStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#222', fontFamily: 'system-ui, sans-serif' } as const
const hintStyle = { fontSize: 12, color: '#888', fontWeight: 400 } as const
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '7px 9px',
  border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 13, color: '#222', background: '#fff',
} as const

export function CryptPadSettingsPanel(_handles?: any): any {
  const [settings, setSettings] = useState<SettingsForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [savedNotice, setSavedNotice] = useState(false)

  // Load the current effective values when the section mounts.
  useEffect(() => {
    let cancelled = false
    fetch(SETTINGS_PATH)
      .then((res) => res.json())
      .then((s: { dataDir?: string; port?: number; maxUploadMB?: number; storageLimitGB?: number }) => {
        if (cancelled) return
        setSettings({
          dataDir: s.dataDir ?? '',
          port: s.port != null ? String(s.port) : '',
          maxUploadMB: s.maxUploadMB != null ? String(s.maxUploadMB) : '',
          storageLimitGB: s.storageLimitGB != null ? String(s.storageLimitGB) : '',
        })
      })
      .catch(() => { if (!cancelled) setError('无法读取 CryptPad 设置') })
    return () => { cancelled = true }
  }, [])

  const saveSettings = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    setError(undefined)
    try {
      await fetch(SETTINGS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dataDir: settings.dataDir,
          port: Number(settings.port) || 0,
          maxUploadMB: Number(settings.maxUploadMB) || 0,
          storageLimitGB: Number(settings.storageLimitGB) || 0,
        }),
      })
      setSavedNotice(true)
      setTimeout(() => setSavedNotice(false), 2500)
      setSaving(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, padding: '4px 0' }}>
      <div style={{ fontSize: 13, color: '#444', fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>
        CryptPad 服务的运行参数。保存并重启后对下一次打开生效（保存会停止当前运行的
        CryptPad server，正在打开的页面需要重新打开）。
      </div>

      <label style={rowStyle}>
        数据目录（存储位置）
        <span style={hintStyle}>CryptPad 数据存储目录（datastore / blob / archive 等）。修改后需重启 dsh 才生效。</span>
        <input style={inputStyle} value={settings?.dataDir ?? ''} onChange={(e) => setSettings((s) => s ? { ...s, dataDir: e.target.value } : s)} placeholder="E:\cryptpad-data" />
      </label>

      <label style={rowStyle}>
        端口
        <span style={hintStyle}>CryptPad server 监听端口。</span>
        <input style={inputStyle} value={settings?.port ?? ''} onChange={(e) => setSettings((s) => s ? { ...s, port: e.target.value } : s)} placeholder="3000" />
      </label>

      <label style={rowStyle}>
        单文件上传上限（MB）
        <span style={hintStyle}>单个文件上传大小限制。</span>
        <input style={inputStyle} value={settings?.maxUploadMB ?? ''} onChange={(e) => setSettings((s) => s ? { ...s, maxUploadMB: e.target.value } : s)} placeholder="100" />
      </label>

      <label style={rowStyle}>
        每账户存储配额（GB）
        <span style={hintStyle}>每账户存储配额上限。</span>
        <input style={inputStyle} value={settings?.storageLimitGB ?? ''} onChange={(e) => setSettings((s) => s ? { ...s, storageLimitGB: e.target.value } : s)} placeholder="1" />
      </label>

      {error ? (
        <div style={{ fontSize: 12, color: '#dc2626', fontFamily: 'system-ui, sans-serif' }}>{error}</div>
      ) : null}
      {savedNotice ? (
        <div style={{ fontSize: 12, color: '#16a34a', fontFamily: 'system-ui, sans-serif' }}>✓ 已保存，正在停止 CryptPad（下次打开按新设置重启）…</div>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={saveSettings}
          disabled={saving || settings === null}
          style={{ border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', background: '#3b82f6', color: '#fff', fontSize: 13 }}
        >
          {saving ? '保存中…' : '保存并重启'}
        </button>
      </div>
    </div>
  )
}
