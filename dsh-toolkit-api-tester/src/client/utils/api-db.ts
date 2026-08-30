/**
 * 接口管理数据层：调 host 的 SQLite CRUD 路由（/_dsh/desktop/toolkit/api-tester）。
 * 收藏树（文件夹/接口）与请求历史持久化到 better-sqlite3。
 */

const API = '/_dsh/desktop/toolkit/api-tester'

export interface SavedFolder { id: string; name: string; parentId: string | null }

export interface SavedApi {
  id: string
  folderId: string | null
  name: string
  method: string
  url: string
  headers: Record<string, string>
  bodyType: string
  body: string
  kvBody: { key: string; value: string }[]
  gqlQuery: string
  gqlVariables: string
  time: string
}

export interface SavedTree { folders: SavedFolder[]; apis: SavedApi[] }

export interface HistoryItem {
  method: string
  url: string
  headers?: Record<string, string>
  bodyType?: string
  body?: string
  status?: string
  time: string
}

async function get(path: string): Promise<any> {
  try {
    const res = await fetch(`${API}${path}`)
    return await res.json()
  } catch { return { ok: false } }
}

async function post(path: string, data: unknown): Promise<any> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    return await res.json()
  } catch { return { ok: false } }
}

export const apiDb = {
  loadTree: async (): Promise<SavedTree | null> => {
    const j = await get('/tree')
    return j?.ok ? (j.data as SavedTree) : null
  },
  loadHistory: async (): Promise<HistoryItem[] | null> => {
    const j = await get('/history')
    return j?.ok ? (j.data as HistoryItem[]) : null
  },
  createFolder: (name: string, parentId: string | null) => post('/folders', { name, parentId }),
  renameFolder: (id: string, name: string) => post('/folders/rename', { id, name }),
  deleteFolder: (id: string) => post('/folders/delete', { id }),
  saveApi: (api: Record<string, unknown>) => post('/apis', api),
  renameApi: (id: string, name: string) => post('/apis/rename', { id, name }),
  copyApi: (id: string) => post('/apis/copy', { id }),
  deleteApi: (id: string) => post('/apis/delete', { id }),
  pushHistory: (item: HistoryItem) => post('/history', item),
  clearHistory: () => post('/history/clear', {}),
}
