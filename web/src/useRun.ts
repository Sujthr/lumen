import { useCallback, useEffect, useRef, useState } from 'react'
import type { AguiEvent, Patch, Refusal, RunNode, RunStatus } from './types'
import { refusalFrom } from './types'

interface RunState {
  runId: string | null
  goal: string | null
  status: RunStatus
  nodes: RunNode[]
  patches: Patch[]
  refusals: Refusal[]
  answer: string | null
  error: string | null
  startedAt: number | null
  /** Re-renders while a run is live so elapsed times tick rather than freeze. */
  now: number
}

const EMPTY: RunState = {
  runId: null, goal: null, status: 'idle', nodes: [], patches: [],
  refusals: [], answer: null, error: null, startedAt: null, now: Date.now(),
}

export function useRun() {
  const [state, setState] = useState<RunState>(EMPTY)
  const source = useRef<EventSource | null>(null)

  // A long run with no visible clock reads as a hang. 27 seconds is a short
  // run here, so the pane must keep moving even between events.
  useEffect(() => {
    if (state.status !== 'running' && state.status !== 'starting') return
    const timer = window.setInterval(() => setState((s) => ({ ...s, now: Date.now() })), 200)
    return () => window.clearInterval(timer)
  }, [state.status])

  useEffect(() => () => source.current?.close(), [])

  const finish = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/runs/${runId}`)
      const record = await response.json()
      setState((s) => ({
        ...s,
        status: record.status === 'failed' ? 'failed' : 'finished',
        answer: record.result?.answer ?? null,
        error: record.error ?? null,
      }))
    } catch (error) {
      setState((s) => ({ ...s, status: 'failed', error: String(error) }))
    }
  }, [])

  const consume = useCallback((event: AguiEvent, runId: string) => {
    setState((s) => {
      const at = Date.now()
      switch (event.type) {
        case 'RUN_STARTED':
          return { ...s, status: 'running', startedAt: s.startedAt ?? at }
        case 'STEP_STARTED':
          if (!event.stepName) return s
          return {
            ...s,
            nodes: [...s.nodes, { name: event.stepName, status: 'running', startedAt: at, seq: event.seq }],
          }
        case 'STEP_FINISHED': {
          const value = event.delta?.value
          const refused = refusalFrom(value)
          const failed = event.source_kind === 'task_failed'
          return {
            ...s,
            nodes: s.nodes.map((n) =>
              n.name === event.stepName && n.status === 'running'
                ? { ...n, status: failed ? 'failed' : 'succeeded', finishedAt: at, value }
                : n,
            ),
            refusals: refused
              ? [...s.refusals, { seq: event.seq, at, node: event.stepName ?? '?', ...refused }]
              : s.refusals,
          }
        }
        case 'STATE_DELTA': {
          const reason = event.delta?.reason
          if (!reason) return s
          return { ...s, patches: [...s.patches, { seq: event.seq, at, reason }] }
        }
        case 'LUMEN_ERROR':
          return { ...s, status: 'failed', error: event.detail ?? 'stream error' }
        case 'RUN_FINISHED':
          void finish(runId)
          return s
        default:
          return s
      }
    })
  }, [finish])

  const ask = useCallback(async (question: string) => {
    source.current?.close()
    setState({ ...EMPTY, status: 'starting', now: Date.now() })
    let runId: string
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
      const body = await response.json()
      runId = body.run_id
      setState((s) => ({ ...s, runId, goal: body.goal }))
    } catch (error) {
      setState((s) => ({ ...s, status: 'failed', error: String(error) }))
      return
    }

    // The proxy holds this open through the ~4.5s before the run reaches the
    // store, so there is nothing to retry here.
    const stream = new EventSource(`/api/runs/${runId}/events`)
    source.current = stream
    stream.onmessage = (message) => {
      try {
        consume(JSON.parse(message.data) as AguiEvent, runId)
      } catch {
        /* keepalive comments never arrive here; a malformed frame is not fatal */
      }
    }
    stream.onerror = () => {
      // EventSource reconnects on its own. Only a finished run closes it.
      setState((s) => (s.status === 'finished' ? s : s))
    }
  }, [consume])

  return { ...state, ask }
}
