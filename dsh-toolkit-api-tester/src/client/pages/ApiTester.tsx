/**
 * 接口管理页（完整版）：HTTP 请求调试 + WebSocket + 收藏菜单树。
 * - 请求构建：9 种请求体（JSON/XML/Text/HTML/JS/GraphQL/urlencoded/Form-Data/Binary）
 * - 发送：经 host 代理 /_dsh/desktop/toolkit/proxy（Node 打点，规避 CORS）
 * - 响应：状态/时序分解/响应大小/响应头/响应体（JSON 格式化）/复制
 * - 收藏树：无限层级文件夹、右键菜单（新建子文件夹/重命名/复制/删除）
 * - 历史：host store 持久化（HTTP + WS 连接记录）
 * - 三栏可拖拽（收藏树宽度、请求/响应比例）
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type MouseEvent as RMouseEvent } from 'react'
import { apiDb, type SavedApi, type SavedFolder, type SavedTree, type HistoryItem } from '../utils/api-db.js'

const PROXY_PATH = '/_dsh/desktop/toolkit/proxy'

interface HeaderRow { key: string; value: string }
type BodyType = 'none' | 'json' | 'xml' | 'text' | 'html' | 'javascript' | 'graphql' | 'urlencoded' | 'formdata' | 'binary'

interface RespData {
  ok: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  elapsedMs?: number
  timing?: { dns: number; connect: number; tls: number; ttfb: number; total: number }
  error?: string
}

interface CtxMenu { x: number; y: number; type: 'folder' | 'api'; id: string }

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const BODY_TYPES: { value: BodyType; label: string; kind: 'text' | 'kv' | 'graphql' | 'binary'; placeholder: string; contentType?: string }[] = [
  { value: 'none', label: '无请求体', kind: 'text', placeholder: '' },
  { value: 'json', label: 'JSON', kind: 'text', placeholder: '{\n  "key": "value"\n}', contentType: 'application/json' },
  { value: 'xml', label: 'XML', kind: 'text', placeholder: '<?xml version="1.0"?>\n<root></root>', contentType: 'application/xml' },
  { value: 'text', label: 'Text', kind: 'text', placeholder: '纯文本…', contentType: 'text/plain' },
  { value: 'html', label: 'HTML', kind: 'text', placeholder: '<html><body></body></html>', contentType: 'text/html' },
  { value: 'javascript', label: 'JavaScript', kind: 'text', placeholder: '// js', contentType: 'application/javascript' },
  { value: 'graphql', label: 'GraphQL', kind: 'graphql', placeholder: '', contentType: 'application/json' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded', kind: 'kv', placeholder: '', contentType: 'application/x-www-form-urlencoded' },
  { value: 'formdata', label: 'Form-Data', kind: 'kv', placeholder: '', contentType: 'multipart/form-data' },
  { value: 'binary', label: 'Binary', kind: 'binary', placeholder: '' },
]

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', gap: 8, fontFamily: 'system-ui, sans-serif' }
const toolbarStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
const titleStyle: CSSProperties = { fontSize: 15, fontWeight: 600, color: '#1f2937' }
const inputStyle: CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
const urlInputStyle: CSSProperties = { ...inputStyle, flex: 1, minWidth: 200 }
const methodSelectStyle: CSSProperties = { ...inputStyle, width: 90 }
const btnStyle: CSSProperties = { border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', background: '#fff', color: '#374151' }
const btnPrimaryStyle: CSSProperties = { ...btnStyle, background: '#2563eb', borderColor: '#2563eb', color: '#fff' }
const btnMiniStyle: CSSProperties = { ...btnStyle, padding: '1px 5px', fontSize: 11, lineHeight: 1.4 }
const bodyStyle: CSSProperties = { display: 'flex', flex: 1, minHeight: 0 }
const treeColStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 8, overflow: 'auto', flexShrink: 0 }
const panelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', overflow: 'hidden', minWidth: 0 }
const panelHeaderStyle: CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }
const textareaStyle: CSSProperties = { flex: 1, width: '100%', padding: 10, border: 'none', outline: 'none', resize: 'none', fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.5, color: '#1f2937', background: '#fff', boxSizing: 'border-box' }
const kvRowStyle: CSSProperties = { display: 'flex', gap: 6, padding: '4px 10px' }
const kvInputStyle: CSSProperties = { ...inputStyle, flex: 1 }
const kvDelStyle: CSSProperties = { ...btnMiniStyle, color: '#dc2626', borderColor: '#fecaca' }
const kvAddStyle: CSSProperties = { ...btnMiniStyle, marginLeft: 10 }
const respPreStyle: CSSProperties = { flex: 1, overflow: 'auto', padding: 10, margin: 0, fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.5, color: '#1f2937', background: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
const tabStyle: CSSProperties = { padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid transparent', color: '#6b7280', background: 'transparent' }
const tabOnStyle: CSSProperties = { ...tabStyle, background: '#eff6ff', color: '#2563eb', borderColor: '#bfdbfe' }
const historyItemStyle: CSSProperties = { textAlign: 'left', padding: '4px 6px', fontSize: 12, cursor: 'pointer', background: 'transparent', border: 'none', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRadius: 4 }
const historyWrapStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 110, overflow: 'auto', borderTop: '1px solid #e5e7eb', padding: '6px 10px' }
const treeRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#1f2937', padding: '2px 0', borderRadius: 4 }
const treeItemStyle: CSSProperties = { flex: 1, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const methodBadgeStyle: CSSProperties = { fontWeight: 700, marginRight: 4 }
const dragBarStyle: CSSProperties = { width: 6, cursor: 'col-resize', flexShrink: 0, background: 'transparent', borderRadius: 3 }
const ctxMenuStyle: CSSProperties = { position: 'fixed', zIndex: 999, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.15)', padding: 4, minWidth: 140, fontSize: 12 }
const modalOverlayStyle: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const modalBoxStyle: CSSProperties = { background: '#fff', borderRadius: 10, padding: 18, width: 380, boxShadow: '0 8px 30px rgba(0,0,0,0.2)', fontFamily: 'system-ui, sans-serif' }
const modalTitleStyle: CSSProperties = { fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 10 }
const modalTextStyle: CSSProperties = { fontSize: 13, color: '#374151', marginBottom: 16, lineHeight: 1.6 }

function genId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function loadHistory(): HistoryItem[] {
  try { return JSON.parse(localStorage.getItem('dsh-toolkit.api-history') || '[]') } catch { return [] }
}

/** 响应体 JSON 自动格式化。 */
function formatBody(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.stringify(JSON.parse(t), null, 2) } catch { /* 保持原文 */ }
  }
  return raw
}

/** 时序分解：各阶段耗时（<1ms 显示 Cache）。 */
function timingBreakdown(t: RespData['timing']): { label: string; value: string }[] | null {
  if (!t) return null
  const fmt = (v: number): string => (v <= 1 ? 'Cache' : `${Math.round(v)}ms`)
  return [
    { label: 'DNS', value: fmt(t.dns) },
    { label: 'TCP', value: fmt(t.connect - t.dns) },
    { label: 'TLS', value: fmt(t.tls - t.connect) },
    { label: 'TTFB', value: fmt(t.ttfb - (t.tls || t.connect)) },
    { label: '下载', value: fmt(t.total - t.ttfb) },
  ]
}

export function ApiTester(): ReactElement {
  const [mode, setMode] = useState<'http' | 'websocket'>('http')

  // HTTP 请求
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<HeaderRow[]>([{ key: '', value: '' }])
  const [bodyType, setBodyType] = useState<BodyType>('none')
  const [body, setBody] = useState('')
  const [kvBody, setKvBody] = useState<HeaderRow[]>([{ key: '', value: '' }])
  const [gqlQuery, setGqlQuery] = useState('')
  const [gqlVariables, setGqlVariables] = useState('')
  const [binaryBase64, setBinaryBase64] = useState('')
  const [sending, setSending] = useState(false)
  const [resp, setResp] = useState<RespData | null>(null)

  // 收藏树
  const [folders, setFolders] = useState<SavedFolder[]>([])
  const [apis, setApis] = useState<SavedApi[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [currentApiId, setCurrentApiId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

  // 历史
  const [history, setHistory] = useState<HistoryItem[]>([])

  // WebSocket
  const [wsUrl, setWsUrl] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  const [wsMsg, setWsMsg] = useState('')
  const [wsLogs, setWsLogs] = useState<{ dir: 'send' | 'recv'; text: string; time: string }[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  // 布局
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const [mainSplit, setMainSplit] = useState(50) // 请求区占主区 %

  // 侧边栏 Tab（收藏/历史）与内联编辑（Electron 禁用 window.prompt，用行内输入替代）
  const [sidebarTab, setSidebarTab] = useState<'fav' | 'history'>('fav')
  const [editing, setEditing] = useState<{ kind: 'create-folder' | 'rename-folder' | 'save-api' | 'rename-api'; id?: string; parentId?: string | null; folderId?: string | null; defaultValue?: string } | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDel, setConfirmDel] = useState<{ type: 'folder' | 'api'; id: string; name: string } | null>(null)

  // ---- 持久化加载（SQLite）----
  useEffect(() => {
    void apiDb.loadTree().then((t) => { if (t) { setFolders(t.folders); setApis(t.apis) } })
    void apiDb.loadHistory().then((h) => { if (h) setHistory(h) })
  }, [])

  // 卸载时关闭 WS
  useEffect(() => () => { wsRef.current?.close() }, [])

  // ---- 请求体构建 ----
  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {}
    for (const row of headers) {
      const k = row.key.trim()
      if (k) h[k] = row.value
    }
    const hasCT = Object.keys(h).some((k) => k.toLowerCase() === 'content-type')
    const autoCT = BODY_TYPES.find((b) => b.value === bodyType)?.contentType
    if (!hasCT && autoCT) h['Content-Type'] = autoCT
    return h
  }

  const buildRequestBody = (): { body?: string; isBase64?: boolean } => {
    switch (bodyType) {
      case 'none': return {}
      case 'urlencoded':
      case 'formdata': {
        const s = kvBody.filter((r) => r.key.trim()).map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`).join('&')
        return { body: s }
      }
      case 'graphql': {
        let variables: unknown
        if (gqlVariables.trim()) { try { variables = JSON.parse(gqlVariables) } catch { variables = gqlVariables } }
        return { body: JSON.stringify({ query: gqlQuery, variables }) }
      }
      case 'binary': return binaryBase64 ? { body: binaryBase64, isBase64: true } : {}
      default: return { body }
    }
  }

  // ---- 发送 ----
  const send = async (): Promise<void> => {
    if (!url.trim()) return
    setSending(true)
    try {
      const built = buildRequestBody()
      const upstream = await fetch(PROXY_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, url: url.trim(), headers: buildHeaders(), body: built.body, bodyIsBase64: built.isBase64 }),
      })
      const data: RespData = await upstream.json()
      setResp(data)
      await pushHistory({ method, url: url.trim(), headers: buildHeaders(), bodyType, body: built.body, status: data.status != null ? String(data.status) : undefined, time: new Date().toLocaleTimeString() })
    } catch (e) {
      setResp({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  // ---- 历史（SQLite）----
  const pushHistory = async (item: HistoryItem): Promise<void> => {
    await apiDb.pushHistory(item)
    const h = await apiDb.loadHistory()
    if (h) setHistory(h)
  }

  const clearHistory = async (): Promise<void> => {
    await apiDb.clearHistory()
    setHistory([])
  }

  const applyHistory = (item: HistoryItem): void => {
    setMethod(item.method)
    setUrl(item.url)
    if (item.headers) setHeaders(Object.entries(item.headers).map(([key, value]) => ({ key, value })))
    if (item.bodyType) setBodyType(item.bodyType as BodyType)
    if (item.body != null) setBody(item.body)
  }

  // ---- WebSocket ----
  const addWsLog = (dir: 'send' | 'recv', text: string): void => {
    setWsLogs((prev) => [...prev.slice(-199), { dir, text, time: new Date().toLocaleTimeString() }])
  }

  const toggleWs = async (): Promise<void> => {
    if (wsConnected) {
      wsRef.current?.close()
      return
    }
    if (!wsUrl.trim()) { window.alert('请输入 WS/WSS 地址'); return }
    try {
      const ws = new WebSocket(wsUrl.trim())
      wsRef.current = ws
      ws.onopen = () => {
        setWsConnected(true)
        addWsLog('recv', '已连接')
        void pushHistory({ method: 'WS', url: wsUrl.trim(), status: 'connected', time: new Date().toLocaleString() })
      }
      ws.onmessage = (e) => addWsLog('recv', String(e.data))
      ws.onerror = () => addWsLog('recv', '连接错误')
      ws.onclose = () => {
        setWsConnected(false)
        addWsLog('recv', '连接已关闭')
        void pushHistory({ method: 'WS', url: wsUrl.trim(), status: 'closed', time: new Date().toLocaleString() })
      }
    } catch (e) {
      addWsLog('recv', `连接失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const sendWs = (): void => {
    if (wsRef.current && wsConnected && wsMsg) {
      wsRef.current.send(wsMsg)
      addWsLog('send', wsMsg)
      setWsMsg('')
    }
  }

  // ---- 收藏树（SQLite）----
  const reloadTree = async (): Promise<void> => {
    const t = await apiDb.loadTree()
    if (t) { setFolders(t.folders); setApis(t.apis) }
  }

  const toggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ---- 内联编辑（替代 window.prompt / confirm，Electron 禁用）----
  const startCreateFolder = (parentId: string | null): void => {
    setEditing({ kind: 'create-folder', parentId, defaultValue: '新文件夹' })
    setEditName('新文件夹')
  }
  const startRenameFolder = (id: string): void => {
    const f = folders.find((x) => x.id === id)
    if (!f) return
    setEditing({ kind: 'rename-folder', id, defaultValue: f.name })
    setEditName(f.name)
  }
  const startSaveApi = (folderId: string | null = currentFolderId): void => {
    const target = mode === 'websocket' ? wsUrl : url
    if (!target.trim()) return
    const fallback = target.split('/').pop() || target || '新接口'
    setEditing({ kind: 'save-api', folderId, defaultValue: fallback })
    setEditName(fallback)
  }
  const startRenameApi = (id: string): void => {
    const a = apis.find((x) => x.id === id)
    if (!a) return
    setEditing({ kind: 'rename-api', id, defaultValue: a.name })
    setEditName(a.name)
  }
  const cancelEdit = (): void => setEditing(null)

  /** 编辑弹窗标题。 */
  const editTitle = (): string => {
    if (!editing) return ''
    switch (editing.kind) {
      case 'create-folder': return '新建文件夹'
      case 'rename-folder': return '重命名文件夹'
      case 'save-api': return '保存接口'
      case 'rename-api': return '重命名接口'
      default: return ''
    }
  }

  /** 编辑弹窗提示行（明确操作目标，避免保存位置与操作点脱节）。 */
  const editHint = (): string => {
    if (!editing) return ''
    switch (editing.kind) {
      case 'create-folder':
        return editing.parentId ? `新建子文件夹到: 📁${folders.find((f) => f.id === editing.parentId)?.name ?? ''}` : '新建文件夹'
      case 'rename-folder': return '重命名文件夹'
      case 'save-api': {
        const folderName = editing.folderId ? folders.find((f) => f.id === editing.folderId)?.name : null
        return `保存接口到: ${folderName ? `📁${folderName}` : '未分组（树底部）'}`
      }
      case 'rename-api': return '重命名接口'
      default: return ''
    }
  }

  const confirmEdit = async (): Promise<void> => {
    if (!editing) return
    const name = editName.trim()
    if (!name) return
    try {
      switch (editing.kind) {
        case 'create-folder':
          await apiDb.createFolder(name, editing.parentId ?? null)
          break
        case 'rename-folder':
          await apiDb.renameFolder(editing.id!, name)
          break
        case 'save-api': {
          // WS 模式：method 存 "WS"，url 存 ws 地址，其余字段清空（对齐 hexun）
          const isWs = mode === 'websocket'
          await apiDb.saveApi({
            id: genId(), name, folderId: editing.folderId ?? currentFolderId,
            method: isWs ? 'WS' : method,
            url: isWs ? wsUrl : url,
            headers: isWs ? {} : buildHeaders(),
            bodyType: isWs ? 'none' : bodyType,
            body: isWs ? '' : body,
            kvBody: isWs ? [] : kvBody,
            gqlQuery: isWs ? '' : gqlQuery,
            gqlVariables: isWs ? '' : gqlVariables,
          })
          break
        }
        case 'rename-api':
          await apiDb.renameApi(editing.id!, name)
          break
      }
      await reloadTree()
    } finally {
      setEditing(null)
    }
  }

  // 删除：弹出确认/取消 modal
  const requestDeleteFolder = (folderId: string): void => {
    const f = folders.find((x) => x.id === folderId)
    setConfirmDel({ type: 'folder', id: folderId, name: f?.name ?? '' })
  }
  const requestDeleteApi = (apiId: string): void => {
    const a = apis.find((x) => x.id === apiId)
    setConfirmDel({ type: 'api', id: apiId, name: a?.name ?? '' })
  }
  const cancelDelete = (): void => setConfirmDel(null)
  const confirmDelete = async (): Promise<void> => {
    if (!confirmDel) return
    const c = confirmDel
    setConfirmDel(null)
    if (c.type === 'folder') {
      await apiDb.deleteFolder(c.id)
      if (currentFolderId === c.id) setCurrentFolderId(null)
    } else {
      await apiDb.deleteApi(c.id)
    }
    await reloadTree()
  }

  const copyApi = async (id: string): Promise<void> => {
    await apiDb.copyApi(id)
    await reloadTree()
  }

  const loadApi = (api: SavedApi): void => {
    setCurrentApiId(api.id)
    // WS 接口：切到 WebSocket 模式并回填 ws 地址
    if (api.method === 'WS') {
      setMode('websocket')
      setWsUrl(api.url)
      return
    }
    setMode('http')
    setMethod(api.method)
    setUrl(api.url)
    setHeaders(Object.entries(api.headers).map(([key, value]) => ({ key, value })))
    setBodyType(api.bodyType as BodyType)
    setBody(api.body)
    setKvBody(api.kvBody?.length ? api.kvBody : [{ key: '', value: '' }])
    setGqlQuery(api.gqlQuery ?? '')
    setGqlVariables(api.gqlVariables ?? '')
  }

  const renderApi = (api: SavedApi, depth: number): ReactElement => (
    <div
      key={api.id}
      style={{
        ...treeRowStyle,
        paddingLeft: depth * 14 + 8,
        background: currentApiId === api.id ? '#eff6ff' : undefined,
        borderRadius: 4,
      }}
      onClick={() => loadApi(api)}
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'api', id: api.id }) }}
    >
      <span style={methodBadgeStyle}>{api.method}</span>
      <span style={treeItemStyle} title={`${api.method} ${api.url}`}>{api.name}</span>
      <button style={kvDelStyle} title="删除" onClick={(e) => { e.stopPropagation(); requestDeleteApi(api.id) }}>✕</button>
    </div>
  )

  const renderFolder = (folder: SavedFolder, depth: number): ReactElement[] => {
    const children = folders.filter((f) => f.parentId === folder.id)
    const apisIn = apis.filter((a) => a.folderId === folder.id)
    const isOpen = expanded.has(folder.id)
    const rows: ReactElement[] = [
      <div
        key={folder.id}
        style={{ ...treeRowStyle, paddingLeft: depth * 14 + 4, background: currentFolderId === folder.id ? '#eff6ff' : undefined }}
        onClick={() => { setCurrentFolderId(folder.id); toggleExpand(folder.id) }}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'folder', id: folder.id }) }}
      >
        <span style={{ width: 12 }}>{isOpen ? '▾' : '▸'}</span>
        <span style={{ ...treeItemStyle, fontWeight: 600 }}>📁 {folder.name}</span>
        <button style={btnMiniStyle} title="新建子文件夹" onClick={(e) => { e.stopPropagation(); startCreateFolder(folder.id) }}>+</button>
        <button style={kvDelStyle} title="删除" onClick={(e) => { e.stopPropagation(); requestDeleteFolder(folder.id) }}>✕</button>
      </div>,
    ]
    if (isOpen) {
      for (const child of children) rows.push(...renderFolder(child, depth + 1))
      for (const api of apisIn) rows.push(renderApi(api, depth + 1))
    }
    return rows
  }

  // ---- 布局拖拽 ----
  const startSidebarDrag = (e: RMouseEvent): void => {
    e.preventDefault()
    const onMove = (ev: globalThis.MouseEvent): void => {
      const w = Math.min(600, Math.max(160, ev.clientX - 0))
      setSidebarWidth(w)
    }
    const onUp = (): void => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startSplitDrag = (e: RMouseEvent): void => {
    e.preventDefault()
    const onMove = (ev: globalThis.MouseEvent): void => {
      const pct = ((ev.clientX - sidebarWidth) / Math.max(1, window.innerWidth - sidebarWidth)) * 100
      setMainSplit(Math.min(80, Math.max(20, pct)))
    }
    const onUp = (): void => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const currentBodyType = BODY_TYPES.find((b) => b.value === bodyType) ?? BODY_TYPES[0]
  const respSize = resp?.body != null
    ? new Blob([resp.body]).size + (Object.entries(resp.headers ?? {}).reduce((s, [k, v]) => s + k.length + v.length + 4, 0))
    : 0

  const bodyEditor = (): ReactElement => {
    if (bodyType === 'none') {
      return <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>该请求不发送请求体</div>
    }
    if (currentBodyType.kind === 'kv') {
      return (
        <div style={{ padding: '6px 0', overflow: 'auto' }}>
          {kvBody.map((row, i) => (
            <div key={i} style={kvRowStyle}>
              <input value={row.key} onChange={(e) => setKvBody((l) => l.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))} placeholder="Key" spellCheck={false} style={kvInputStyle} />
              <input value={row.value} onChange={(e) => setKvBody((l) => l.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))} placeholder="Value" spellCheck={false} style={kvInputStyle} />
              <button style={kvDelStyle} onClick={() => setKvBody((l) => l.filter((_, idx) => idx !== i))}>✕</button>
            </div>
          ))}
          <button style={kvAddStyle} onClick={() => setKvBody((l) => [...l, { key: '', value: '' }])}>+ 添加字段</button>
        </div>
      )
    }
    if (currentBodyType.kind === 'graphql') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, flex: 1, minHeight: 0 }}>
          <textarea value={gqlQuery} onChange={(e) => setGqlQuery(e.target.value)} placeholder="query { ... }" spellCheck={false} style={{ ...textareaStyle, minHeight: 100 }} />
          <textarea value={gqlVariables} onChange={(e) => setGqlVariables(e.target.value)} placeholder="variables (JSON)" spellCheck={false} style={{ ...textareaStyle, minHeight: 80 }} />
        </div>
      )
    }
    if (currentBodyType.kind === 'binary') {
      return (
        <div style={{ padding: 10, fontSize: 12, color: '#6b7280' }}>
          <input
            type="file"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const buf = await f.arrayBuffer()
              const bytes = new Uint8Array(buf)
              let bin = ''
              for (const b of bytes) bin += String.fromCharCode(b)
              setBinaryBase64(btoa(bin))
              e.target.value = ''
            }}
          />
          {binaryBase64 ? <div style={{ marginTop: 6 }}>已选择文件（{Math.round(binaryBase64.length * 3 / 4)} 字节）</div> : null}
        </div>
      )
    }
    return <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={currentBodyType.placeholder} spellCheck={false} style={textareaStyle} />
  }

  return (
    <div style={pageStyle}>
      <div style={toolbarStyle}>
        <span style={titleStyle}>🔌 接口管理</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={mode === 'http' ? btnPrimaryStyle : btnStyle} onClick={() => setMode('http')}>HTTP</button>
          <button style={mode === 'websocket' ? btnPrimaryStyle : btnStyle} onClick={() => setMode('websocket')}>WebSocket</button>
        </div>
        {mode === 'http' ? (
          <>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={methodSelectStyle}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/path" spellCheck={false} style={urlInputStyle} />
            <button style={btnPrimaryStyle} onClick={send} disabled={sending || !url.trim()}>{sending ? '发送中…' : '发送'}</button>
            <button style={btnStyle} onClick={() => startSaveApi()} disabled={!url.trim()}>保存到收藏</button>
          </>
        ) : (
          <>
            <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} placeholder="ws://127.0.0.1:8080/ws" spellCheck={false} style={urlInputStyle} />
            <button style={wsConnected ? { ...btnStyle, background: '#dc2626', borderColor: '#dc2626', color: '#fff' } : btnPrimaryStyle} onClick={toggleWs}>
              {wsConnected ? '断开' : '连接'}
            </button>
            <button style={btnStyle} onClick={() => startSaveApi()} disabled={!wsUrl.trim()}>保存到收藏</button>
          </>
        )}
      </div>

      <div style={bodyStyle}>
        {/* 侧边栏：收藏树 / 历史 */}
        <div style={{ ...treeColStyle, width: sidebarWidth }}>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
            <button style={sidebarTab === 'fav' ? tabOnStyle : tabStyle} onClick={() => setSidebarTab('fav')}>收藏</button>
            <button style={sidebarTab === 'history' ? tabOnStyle : tabStyle} onClick={() => setSidebarTab('history')}>历史({history.length})</button>
          </div>

          {sidebarTab === 'fav' ? (
            <div data-dsh-api-tree="">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>📁 收藏</span>
                <button style={btnMiniStyle} title="新建文件夹" onClick={() => startCreateFolder(null)}>+</button>
              </div>
              {folders.filter((f) => f.parentId === null).map((f) => renderFolder(f, 0))}
              {apis.filter((a) => a.folderId === null).map((a) => renderApi(a, 0))}
              {folders.length === 0 && apis.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9ca3af', padding: '6px 0' }}>暂无收藏</div>
              ) : null}
            </div>
          ) : (
            <div data-dsh-api-history="" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>🕘 历史</span>
                <button style={btnMiniStyle} onClick={clearHistory} disabled={history.length === 0}>清空</button>
              </div>
              {history.map((item, i) => (
                <button
                  key={i}
                  style={historyItemStyle}
                  onClick={() => applyHistory(item)}
                  title={`${item.method} ${item.url}`}
                >
                  <span style={methodBadgeStyle}>{item.method}</span> {item.url}
                  {item.status ? <span style={{ color: '#9ca3af', fontSize: 10, marginLeft: 4 }}>{item.status}</span> : null}
                </button>
              ))}
              {history.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9ca3af', padding: '6px 0' }}>暂无历史</div>
              ) : null}
            </div>
          )}
        </div>
        <div style={dragBarStyle} onMouseDown={startSidebarDrag} title="拖拽调整宽度" />

        {mode === 'http' ? (
          <>
            {/* 请求构建 */}
            <div style={{ ...panelStyle, flex: `${mainSplit} 1 0%` }}>
              <div style={panelHeaderStyle}>请求</div>
              <div style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', overflow: 'auto' }}>
                {headers.map((row, i) => (
                  <div key={i} style={kvRowStyle}>
                    <input value={row.key} onChange={(e) => setHeaders((l) => l.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))} placeholder="Header 名" spellCheck={false} style={kvInputStyle} />
                    <input value={row.value} onChange={(e) => setHeaders((l) => l.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))} placeholder="值" spellCheck={false} style={kvInputStyle} />
                    <button style={kvDelStyle} onClick={() => setHeaders((l) => l.filter((_, idx) => idx !== i))}>✕</button>
                  </div>
                ))}
                <button style={kvAddStyle} onClick={() => setHeaders((l) => [...l, { key: '', value: '' }])}>+ 添加请求头</button>
              </div>
              <div style={kvRowStyle}>
                <span style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>请求体类型</span>
                <select value={bodyType} onChange={(e) => setBodyType(e.target.value as BodyType)} style={methodSelectStyle}>
                  {BODY_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{bodyEditor()}</div>
            </div>
            <div style={dragBarStyle} onMouseDown={startSplitDrag} title="拖拽调整比例" />

            {/* 响应 */}
            <div style={{ ...panelStyle, flex: `${100 - mainSplit} 1 0%` }}>
              <div style={panelHeaderStyle}>
                响应
                {resp?.status != null ? (
                  <span style={{ marginLeft: 8, color: resp.ok ? '#16a34a' : '#dc2626' }}>
                    {resp.status} {resp.statusText ?? ''} · {resp.elapsedMs != null ? `${resp.elapsedMs}ms` : ''}
                  </span>
                ) : null}
                {resp?.body != null ? <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280' }}>≈{respSize} B</span> : null}
                {resp?.error ? <span style={{ marginLeft: 8, color: '#dc2626' }}>⚠ {resp.error}</span> : null}
              </div>
              {timingBreakdown(resp?.timing) ? (
                <div style={{ padding: '5px 10px', fontSize: 12, color: '#374151', background: '#f0f7ff', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {timingBreakdown(resp?.timing)!.map((s) => (
                    <span key={s.label}><b>{s.label}</b> {s.value}</span>
                  ))}
                </div>
              ) : null}
              {resp?.headers ? (
                <pre style={{ maxHeight: 140, overflow: 'auto', margin: 0, padding: 10, fontSize: 12, color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {Object.entries(resp.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}
                </pre>
              ) : null}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ padding: '4px 10px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button style={{ ...btnStyle, padding: '3px 8px', fontSize: 11 }} onClick={() => navigator.clipboard.writeText(resp?.body ?? '')}>复制响应体</button>
                </div>
                <pre style={respPreStyle}>{resp?.body != null ? formatBody(resp.body) : (resp?.ok === false ? (resp.error ?? '请求失败') : '发送请求查看响应…')}</pre>
              </div>
            </div>
          </>
        ) : (
          <div style={{ ...panelStyle, flex: 1 }}>
            <div style={panelHeaderStyle}>WebSocket {wsConnected ? '· 已连接' : '· 未连接'}</div>
            <div style={kvRowStyle}>
              <input value={wsMsg} onChange={(e) => setWsMsg(e.target.value)} placeholder="输入消息…" spellCheck={false} style={kvInputStyle} onKeyDown={(e) => { if (e.key === 'Enter') sendWs() }} />
              <button style={btnPrimaryStyle} onClick={sendWs} disabled={!wsConnected || !wsMsg}>发送</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
              {wsLogs.map((log, i) => (
                <div key={i} style={{ fontSize: 12, padding: '2px 12px', color: log.dir === 'send' ? '#2563eb' : '#16a34a', wordBreak: 'break-all' }}>
                  <span style={{ color: '#9ca3af', marginRight: 6 }}>{log.time}</span>{log.dir === 'send' ? '→' : '←'} {log.text}
                </div>
              ))}
              {wsLogs.length === 0 ? <div style={{ fontSize: 12, color: '#9ca3af', padding: '6px 12px' }}>暂无消息，输入地址连接后收发</div> : null}
            </div>
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu ? (
        <div style={{ ...ctxMenuStyle, left: ctxMenu.x, top: ctxMenu.y }} onMouseLeave={() => setCtxMenu(null)}>
          {ctxMenu.type === 'folder' ? (
            <>
              <button style={{ ...btnStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onClick={() => { setCtxMenu(null); startSaveApi(ctxMenu.id) }}>新建接口</button>
              <button style={{ ...btnStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onClick={() => { setCtxMenu(null); startCreateFolder(ctxMenu.id) }}>新建子文件夹</button>
              <button style={{ ...btnStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onClick={() => { setCtxMenu(null); startRenameFolder(ctxMenu.id) }}>重命名</button>
              <button style={{ ...btnStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: '#dc2626' }} onClick={() => { setCtxMenu(null); requestDeleteFolder(ctxMenu.id) }}>删除</button>
            </>
          ) : (
            <>
              <button style={{ ...btnStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onClick={() => { setCtxMenu(null); startRenameApi(ctxMenu.id) }}>重命名</button>
              <button style={{ ...btnStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onClick={() => { setCtxMenu(null); copyApi(ctxMenu.id) }}>复制</button>
              <button style={{ ...btnStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: '#dc2626' }} onClick={() => { setCtxMenu(null); requestDeleteApi(ctxMenu.id) }}>删除</button>
            </>
          )}
        </div>
      ) : null}

      {/* 编辑输入 modal（新建/重命名/保存接口，对齐 hexun 弹窗） */}
      {editing ? (
        <div style={modalOverlayStyle} onClick={cancelEdit}>
          <div style={modalBoxStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>{editTitle()}</div>
            {editHint() ? <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>{editHint()}</div> : null}
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void confirmEdit(); if (e.key === 'Escape') cancelEdit() }}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 14, padding: '8px 10px' }}
              placeholder="名称"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnStyle} onClick={cancelEdit}>取消</button>
              <button style={btnPrimaryStyle} onClick={() => void confirmEdit()} disabled={!editName.trim()}>确定</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 删除确认 modal */}
      {confirmDel ? (
        <div style={modalOverlayStyle} onClick={cancelDelete}>
          <div style={modalBoxStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>删除确认</div>
            <div style={modalTextStyle}>
              {confirmDel.type === 'folder'
                ? `确定删除文件夹「📁 ${confirmDel.name}」？（将同时删除其所有子文件夹和接口）`
                : `确定删除接口「${confirmDel.name}」？`}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnStyle} onClick={cancelDelete}>取消</button>
              <button style={{ ...btnStyle, background: '#dc2626', borderColor: '#dc2626', color: '#fff' }} onClick={() => void confirmDelete()}>确认删除</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
