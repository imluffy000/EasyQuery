/** Types mirroring the backend response models in app/schemas/api.py. */

export interface ApiError {
  error: { code: string; message: string; request_id?: string | null }
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
}

export interface User {
  id: string
  email: string
  full_name: string
  is_active: boolean
}

export interface Workspace {
  id: string
  name: string
  slug: string
  max_rows: number
  query_timeout_seconds: number
}

export interface Membership {
  workspace: Workspace
  role: 'owner' | 'admin' | 'analyst' | 'viewer'
  permissions: string[]
}

export type DatabaseStatus = 'pending' | 'connected' | 'error'

export interface DatabaseConnection {
  id: string
  name: string
  engine: string
  environment: 'development' | 'staging' | 'production'
  host: string
  port: number
  database_name: string
  username: string
  ssl_mode: string
  read_only: boolean
  allowed_schemas: string[]
  query_timeout_seconds: number
  max_rows: number
  status: DatabaseStatus
  last_error: string | null
  last_tested_at: string | null
  last_synced_at: string | null
  schema_version: number
  created_at: string
}

export interface ConnectionTest {
  ok: boolean
  message: string
  server_version?: string | null
  latency_ms?: number | null
  is_read_only_role?: boolean | null
}

export interface SchemaSyncResult {
  tables: number
  columns: number
  schema_changed: boolean
  schema_version: number
  synced_at: string
}

export interface ColumnMeta {
  name: string
  data_type: string
  nullable: boolean
  is_primary_key: boolean
  is_unique: boolean
  comment: string | null
  sensitivity: 'none' | 'low' | 'high'
  default?: string | null
}

export interface ForeignKeyMeta {
  column: string
  references_schema: string
  references_table: string
  references_column: string
  constraint_name: string
}

export interface IndexMeta {
  name: string
  columns: string[]
  is_unique: boolean
  is_primary: boolean
  method: string | null
}

export interface TableMeta {
  name: string
  kind: string
  description: string
  estimated_rows: number | null
  column_count: number
  columns: ColumnMeta[]
  foreign_keys: ForeignKeyMeta[]
  indexes: IndexMeta[]
}

export interface SchemaTree {
  database_id: string
  last_synced_at: string | null
  schema_version: number
  schemas: { name: string; tables: TableMeta[] }[]
}

export interface ClarificationOption {
  label: string
  value: string
  description?: string | null
}

export interface Clarification {
  question: string | null
  dimension: string | null
  options: ClarificationOption[]
  allow_free_text: boolean
}

export type Row = Record<string, unknown>

export interface QueryResult {
  columns: string[]
  rows: Row[]
  row_count: number
  duration_ms: number
  truncated: boolean
}

export type ChartType =
  | 'table'
  | 'kpi'
  | 'line'
  | 'bar'
  | 'area'
  | 'pie'
  | 'histogram'
  | 'scatter'

export interface Visualization {
  type: ChartType
  x: string | null
  y: string | null
  series: string | null
  title: string
}

export interface CostAssessment {
  total_cost: number
  estimated_rows: number
  is_expensive: boolean
  has_sequential_scan: boolean
  warnings: string[]
  scanned_relations: string[]
}

export interface ChatResponse {
  conversation_id: string
  query_id: string
  answer: string | null
  generated_sql: string | null
  executed_sql: string | null
  awaiting_clarification: boolean
  clarification: Clarification | null
  awaiting_confirmation: boolean
  cost: CostAssessment | null
  result: QueryResult | null
  visualization: Visualization | null
  warnings: string[]
  errors: { stage: string; code: string; message: string }[]
  tables_used: string[]
}

/** Operational status events streamed over SSE. Status only, never reasoning. */
export type StreamEventName =
  | 'connected'
  | 'understanding_question'
  | 'retrieving_schema'
  | 'clarification_required'
  | 'planning_query'
  | 'generating_sql'
  | 'validating_sql'
  | 'checking_cost'
  | 'confirmation_required'
  | 'executing_query'
  | 'analyzing_results'
  | 'complete'
  | 'error'
  | 'result'

export interface QueryRecord {
  id: string
  question: string
  generated_sql: string | null
  executed_sql: string | null
  status: string
  error_code: string | null
  error_message: string | null
  row_count: number | null
  duration_ms: number | null
  retry_count: number
  was_blocked: boolean
  required_clarification: boolean
  tables_used: string[]
  assumptions: string[]
  cost_usd: number
  model: string | null
  database_id: string | null
  created_at: string
}

export interface SavedQuery {
  id: string
  name: string
  description: string
  sql: string
  tags: string[]
  database_id: string | null
  run_count: number
  last_run_at: string | null
  created_at: string
}

export interface ValidateSQLResult {
  ok: boolean
  safe_sql: string | null
  errors: { code: string; message: string }[]
  warnings: string[]
  tables: string[]
  join_count: number
}

export interface GlossaryTerm {
  id: string
  term: string
  definition: string
  maps_to: string | null
  created_at: string
}

export interface AnalyticsSummary {
  queries_today: number
  success_rate: number
  avg_latency_ms: number
  p95_latency_ms: number
  avg_llm_latency_ms: number
  llm_cost_usd: number
  clarification_rate: number
  correction_rate: number
  blocked_count: number
  timeout_count: number
  error_count: number
}

export interface Analytics {
  summary: AnalyticsSummary
  query_volume: { bucket: string; value: number }[]
  latency_distribution: { bucket: string; value: number }[]
  status_breakdown: Record<string, number>
  top_tables: { table: string; count: number }[]
}

export interface Conversation {
  id: string
  title: string
  database_id: string | null
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload: {
    clarification?: Clarification
    confirmation?: { estimated_rows: number; estimated_cost: number; relations: string[] }
    visualization?: Visualization
  }
  query_id: string | null
  created_at: string
}

export interface ConversationDetail extends Conversation {
  messages: Message[]
}
