/**
 * API client.
 *
 * Tokens live in memory plus localStorage. A 401 triggers exactly one refresh
 * attempt, and concurrent 401s share that single refresh rather than each
 * firing their own -- otherwise a page with six queries would burn six
 * refresh tokens on load.
 */

import type {
  Analytics,
  ChatResponse,
  ConversationDetail,
  Conversation,
  ConnectionTest,
  DatabaseConnection,
  GlossaryTerm,
  Membership,
  QueryRecord,
  SavedQuery,
  SchemaSyncResult,
  SchemaTree,
  StreamEventName,
  TokenPair,
  User,
  ValidateSQLResult,
} from '@/types/api'

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

const ACCESS_KEY = 'dbc.access'
const REFRESH_KEY = 'dbc.refresh'

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly requestId?: string | null,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

function readToken(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export const tokens = {
  get access() {
    return readToken(ACCESS_KEY)
  },
  get refresh() {
    return readToken(REFRESH_KEY)
  },
  set(pair: TokenPair) {
    localStorage.setItem(ACCESS_KEY, pair.access_token)
    localStorage.setItem(REFRESH_KEY, pair.refresh_token)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

/** Shared in-flight refresh, so N concurrent 401s cause one refresh. */
let refreshInFlight: Promise<boolean> | null = null

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const refresh = tokens.refresh
    if (!refresh) return false
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!res.ok) {
        tokens.clear()
        return false
      }
      tokens.set((await res.json()) as TokenPair)
      return true
    } catch {
      return false
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see it.
      setTimeout(() => {
        refreshInFlight = null
      }, 0)
    }
  })()

  return refreshInFlight
}

interface RequestOptions extends RequestInit {
  retryOn401?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { retryOn401 = true, ...init } = options
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const access = tokens.access
  if (access) headers.set('Authorization', `Bearer ${access}`)

  const res = await fetch(`${BASE}${path}`, { ...init, headers })

  if (res.status === 401 && retryOn401 && tokens.refresh) {
    if (await refreshTokens()) {
      return request<T>(path, { ...options, retryOn401: false })
    }
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const body = text ? JSON.parse(text) : null

  if (!res.ok) {
    const detail = body?.error ?? {}
    throw new ApiRequestError(
      detail.message ?? `Request failed (${res.status})`,
      detail.code ?? 'ERROR',
      res.status,
      detail.request_id,
    )
  }

  return body as T
}

const get = <T>(p: string) => request<T>(p)
const post = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
const patch = <T>(p: string, body: unknown) =>
  request<T>(p, { method: 'PATCH', body: JSON.stringify(body) })
const del = (p: string) => request<void>(p, { method: 'DELETE' })

export const api = {
  auth: {
    register: (body: {
      email: string
      password: string
      full_name?: string
      organization_name?: string
    }) => post<TokenPair>('/auth/register', body),
    login: (body: { email: string; password: string }) =>
      post<TokenPair>('/auth/login', body),
    me: () => get<User>('/auth/me'),
    memberships: () => get<Membership[]>('/auth/memberships'),
  },

  databases: {
    list: (ws: string) => get<DatabaseConnection[]>(`/workspaces/${ws}/databases`),
    get: (ws: string, id: string) =>
      get<DatabaseConnection>(`/workspaces/${ws}/databases/${id}`),
    create: (ws: string, body: unknown) =>
      post<DatabaseConnection>(`/workspaces/${ws}/databases`, body),
    update: (ws: string, id: string, body: unknown) =>
      patch<DatabaseConnection>(`/workspaces/${ws}/databases/${id}`, body),
    remove: (ws: string, id: string) => del(`/workspaces/${ws}/databases/${id}`),
    testNew: (ws: string, body: unknown) =>
      post<ConnectionTest>(`/workspaces/${ws}/databases/test`, body),
    test: (ws: string, id: string) =>
      post<ConnectionTest>(`/workspaces/${ws}/databases/${id}/test`),
    sync: (ws: string, id: string) =>
      post<SchemaSyncResult>(`/workspaces/${ws}/databases/${id}/sync-schema`),
    schema: (ws: string, id: string) =>
      get<SchemaTree>(`/workspaces/${ws}/databases/${id}/schema`),
    glossary: (ws: string, id: string) =>
      get<GlossaryTerm[]>(`/workspaces/${ws}/databases/${id}/glossary`),
    addTerm: (ws: string, id: string, body: unknown) =>
      post<GlossaryTerm>(`/workspaces/${ws}/databases/${id}/glossary`, body),
    removeTerm: (ws: string, id: string, termId: string) =>
      del(`/workspaces/${ws}/databases/${id}/glossary/${termId}`),
  },

  chat: {
    send: (ws: string, body: unknown) => post<ChatResponse>(`/workspaces/${ws}/chat`, body),
    conversations: (ws: string) => get<Conversation[]>(`/workspaces/${ws}/conversations`),
    conversation: (ws: string, id: string) =>
      get<ConversationDetail>(`/workspaces/${ws}/conversations/${id}`),
    removeConversation: (ws: string, id: string) =>
      del(`/workspaces/${ws}/conversations/${id}`),
  },

  queries: {
    history: (ws: string, params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString()
      return get<QueryRecord[]>(`/workspaces/${ws}/history${qs ? `?${qs}` : ''}`)
    },
    detail: (ws: string, id: string) => get<QueryRecord>(`/workspaces/${ws}/queries/${id}`),
    validate: (ws: string, body: { sql: string; database_id: string }) =>
      post<ValidateSQLResult>(`/workspaces/${ws}/queries/validate`, body),
    saved: (ws: string) => get<SavedQuery[]>(`/workspaces/${ws}/saved-queries`),
    save: (ws: string, body: unknown) =>
      post<SavedQuery>(`/workspaces/${ws}/saved-queries`, body),
    removeSaved: (ws: string, id: string) => del(`/workspaces/${ws}/saved-queries/${id}`),
  },

  analytics: (ws: string, days = 7) =>
    get<Analytics>(`/workspaces/${ws}/analytics?days=${days}`),
}

/**
 * Stream a chat turn over SSE.
 *
 * Uses fetch rather than EventSource because EventSource cannot send an
 * Authorization header or a POST body.
 */
export async function streamChat(
  workspaceId: string,
  body: unknown,
  handlers: {
    onEvent: (event: StreamEventName, data: unknown) => void
    signal?: AbortSignal
  },
): Promise<void> {
  const send = async (retry: boolean): Promise<Response> => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    const access = tokens.access
    if (access) headers.set('Authorization', `Bearer ${access}`)

    const res = await fetch(`${BASE}/workspaces/${workspaceId}/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: handlers.signal,
    })
    if (res.status === 401 && retry && (await refreshTokens())) return send(false)
    return res
  }

  const res = await send(true)

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    let message = `Stream failed (${res.status})`
    let code = 'STREAM_ERROR'
    try {
      const parsed = JSON.parse(text)
      message = parsed?.error?.message ?? message
      code = parsed?.error?.code ?? code
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(message, code, res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line; a partial frame stays buffered.
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length) {
        try {
          handlers.onEvent(event as StreamEventName, JSON.parse(dataLines.join('\n')))
        } catch {
          handlers.onEvent(event as StreamEventName, null)
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}
