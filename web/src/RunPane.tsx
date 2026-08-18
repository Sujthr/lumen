import { useState } from 'react'
import type { Patch, RunNode, RunStatus } from './types'
import { commandFrom, commandLine, hitsFrom } from './types'

function elapsed(from: number, to: number): string {
  const seconds = Math.max(0, (to - from) / 1000)
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

function StatusDot({ status }: { status: RunNode['status'] }) {
  const colour =
    status === 'running' ? 'bg-sky-400 animate-pulse'
      : status === 'failed' ? 'bg-rose-500'
        : 'bg-emerald-400'
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${colour}`} />
}

/** A command result gets the whole treatment: argv, exit code, captured output.
 *  This is the thing a black box structurally cannot show. */
function CommandBlock({ value }: { value: Record<string, unknown> }) {
  const command = commandFrom(value)
  if (!command) return null
  const failed = (command.exit_code ?? 0) !== 0
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-white/10">
      <div className="flex items-center justify-between gap-3 bg-black/40 px-3 py-1.5">
        <code className="truncate font-mono text-[12px] text-zinc-300">
          $ {commandLine(command.command)}
        </code>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] ${
            failed ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'
          }`}
        >
          exit {command.exit_code ?? '?'}
        </span>
      </div>
      {(command.stdout || command.stderr) && (
        <pre className="thin-scroll max-h-56 overflow-auto bg-black/60 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-zinc-400">
          {command.stdout}
          {command.stderr && <span className="text-rose-300">{command.stderr}</span>}
        </pre>
      )}
      {command.timed_out && (
        <div className="bg-amber-500/10 px-3 py-1 text-[11px] text-amber-300">timed out</div>
      )}
    </div>
  )
}

function NodeRow({ node, now }: { node: RunNode; now: number }) {
  const [open, setOpen] = useState(false)
  const hits = hitsFrom(node.value)
  const command = commandFrom(node.value)
  const took = elapsed(node.startedAt, node.finishedAt ?? now)

  return (
    <li className="border-b border-white/5 px-4 py-2.5 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <StatusDot status={node.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[13px] text-zinc-200">{node.name}</span>
          {hits.length > 0 && (
            <span className="text-[11px] text-zinc-500">{hits.length} results</span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-500">{took}</span>
      </button>

      {command && <CommandBlock value={node.value as Record<string, unknown>} />}

      {open && node.value && !command && (
        <pre className="thin-scroll mt-2 max-h-60 overflow-auto rounded-md bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-400">
          {JSON.stringify(node.value, null, 2)}
        </pre>
      )}
    </li>
  )
}

interface Props {
  status: RunStatus
  nodes: RunNode[]
  patches: Patch[]
  now: number
  startedAt: number | null
}

export function RunPane({ status, nodes, patches, now, startedAt }: Props) {
  const idle = status === 'idle'

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-white/10 bg-[#0e1116]">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-[13px] font-medium tracking-wide text-zinc-300">Run</h2>
        <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-500">
          {startedAt && <span className="tabular-nums">{elapsed(startedAt, now)}</span>}
          <span
            className={
              status === 'running' || status === 'starting' ? 'text-sky-400'
                : status === 'failed' ? 'text-rose-400'
                  : status === 'finished' ? 'text-emerald-400' : ''
            }
          >
            {status}
          </span>
        </div>
      </header>

      {idle ? (
        <p className="px-4 py-6 text-[13px] leading-relaxed text-zinc-600">
          Every node the agent adds, every capability it calls and every command it
          runs appears here as it happens — including the ones that fail.
        </p>
      ) : (
        <div className="thin-scroll min-h-0 flex-1 overflow-auto">
          {patches.length > 0 && (
            <ul className="border-b border-white/5">
              {patches.map((patch) => (
                <li key={patch.seq} className="px-4 py-2">
                  <span className="text-[11px] uppercase tracking-wider text-zinc-600">
                    planner
                  </span>
                  <p className="text-[12px] leading-snug text-zinc-400">{patch.reason}</p>
                </li>
              ))}
            </ul>
          )}
          <ul>
            {nodes.map((node) => (
              <NodeRow key={`${node.name}-${node.seq}`} node={node} now={now} />
            ))}
          </ul>
          {nodes.length === 0 && (
            <p className="px-4 py-4 font-mono text-[12px] text-zinc-600">
              waiting for the first node…
            </p>
          )}
        </div>
      )}
    </section>
  )
}
