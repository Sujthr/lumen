// Shapes taken from a recorded run, not from documentation.
// See lumen/proofs/EVENT_SCHEMA.md.

export type EventType =
  | 'RUN_STARTED'
  | 'STATE_DELTA'
  | 'STEP_STARTED'
  | 'STEP_FINISHED'
  | 'RUN_FINISHED'
  | 'STATE_SNAPSHOT'
  | 'LUMEN_ERROR'

export interface AguiEvent {
  type: EventType
  seq: number
  source_kind?: string
  stepName?: string
  detail?: string
  delta?: {
    op?: string
    path?: string
    reason?: string
    trigger?: number
    value?: Record<string, unknown>
  }
}

export interface Hit {
  title?: string
  url?: string
  snippet?: string
}

/** A run_command result, as the coding surface returns it. */
export interface CommandResult {
  command?: string[] | string
  exit_code?: number
  stdout?: string
  stderr?: string
  timed_out?: boolean
}

export type NodeStatus = 'running' | 'succeeded' | 'failed'

export interface RunNode {
  name: string
  status: NodeStatus
  startedAt: number
  finishedAt?: number
  seq: number
  value?: Record<string, unknown>
}

/** A planner patch — why the graph grew. The legibility worth rendering. */
export interface Patch {
  seq: number
  at: number
  reason: string
}

export interface Refusal {
  seq: number
  at: number
  node: string
  detail: string
  rule?: string
}

export type RunStatus = 'idle' | 'starting' | 'running' | 'finished' | 'failed'

/** Pull search hits out of whatever a capability returned. */
export function hitsFrom(value: unknown): Hit[] {
  if (!value || typeof value !== 'object') return []
  const hits = (value as { hits?: unknown }).hits
  if (!Array.isArray(hits)) return []
  return hits.filter((h): h is Hit => !!h && typeof h === 'object')
}

/** Recognise a command result without knowing every capability's shape. */
export function commandFrom(value: unknown): CommandResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as CommandResult
  if (v.exit_code === undefined && v.command === undefined) return null
  return v
}

/** A refusal is a result that says no: the guard, the allowlist, the budget. */
export function refusalFrom(value: unknown): { detail: string; rule?: string } | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const refused = v.refused ?? v.error ?? v.denied
  if (!refused) return null
  const detail = typeof refused === 'string' ? refused : JSON.stringify(refused)
  const rule = typeof v.pattern === 'string' ? v.pattern : undefined
  return { detail, rule }
}

export function commandLine(command: CommandResult['command']): string {
  if (Array.isArray(command)) return command.join(' ')
  return command ?? ''
}

/** Phrases that assert something was actually executed. */
const EXECUTION_CLAIMS: RegExp[] = [
  /when (?:this|the) (?:code|script|snippet) is (?:executed|run)/i,
  /running (?:this|the) (?:code|script|snippet)/i,
  /execution output/i,
  /the output is/i,
  /this (?:yields|produces|prints|outputs)/i,
  /\bI ran\b/i,
  /\bexit code\b/i,
]

/**
 * Whether the answer tells the reader that code was executed.
 *
 * Worth checking against what the run actually did. A model asked to verify a
 * claim by running something will, when it cannot, write a fluent "Execution
 * Output" section describing output it never produced. That reads exactly like
 * a verified answer, which is the failure mode this product exists to avoid —
 * so the discrepancy is shown rather than left for the reader to catch.
 */
export function claimsExecution(answer: string | null): boolean {
  if (!answer) return false
  return EXECUTION_CLAIMS.some((pattern) => pattern.test(answer))
}

export function countCommands(nodes: RunNode[]): number {
  return nodes.filter((node) => commandFrom(node.value) !== null).length
}
