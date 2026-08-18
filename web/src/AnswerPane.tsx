import type { Hit, Refusal, RunNode, RunStatus } from './types'
import { claimsExecution, commandFrom, commandLine, countCommands, hitsFrom } from './types'

/** One entry in the source list: a page that was read, or a command that ran. */
type Source =
  | { kind: 'page'; url: string; title: string; snippet?: string }
  | { kind: 'run'; command: string; exitCode: number }

function collectSources(nodes: RunNode[]): Source[] {
  const seen = new Set<string>()
  const sources: Source[] = []
  for (const node of nodes) {
    for (const hit of hitsFrom(node.value) as Hit[]) {
      if (!hit.url || seen.has(hit.url)) continue
      seen.add(hit.url)
      sources.push({ kind: 'page', url: hit.url, title: hit.title || hit.url, snippet: hit.snippet })
    }
    const command = commandFrom(node.value)
    if (command) {
      sources.push({
        kind: 'run',
        command: commandLine(command.command),
        exitCode: command.exit_code ?? -1,
      })
    }
  }
  return sources
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Turn bare URLs in the answer into links back to the source list. */
function Linkified({ text, index }: { text: string; index: Map<string, number> }) {
  const parts = text.split(/(https?:\/\/[^\s,)\]]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="mx-0.5 rounded bg-sky-400/10 px-1 font-mono text-[11px] text-sky-300 no-underline hover:bg-sky-400/20"
          >
            {index.has(part) ? `[${index.get(part)}]` : domain(part)}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

/**
 * What the answer claims, against what the run did.
 *
 * The unhappy case is the one worth building: an answer that describes output
 * it never produced is indistinguishable from a verified one until you check
 * the run. So the check is shown, not left to the reader.
 */
function Provenance({ answer, nodes }: { answer: string; nodes: RunNode[] }) {
  const ran = countCommands(nodes)
  const pages = new Set(nodes.flatMap((n) => hitsFrom(n.value).map((h) => h.url).filter(Boolean))).size
  const claims = claimsExecution(answer)
  const unsupported = claims && ran === 0

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-zinc-400">
          {pages} page{pages === 1 ? '' : 's'} read
        </span>
        <span
          className={`rounded-full px-2 py-0.5 ${
            ran > 0
              ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border border-white/10 text-zinc-500'
          }`}
        >
          {ran} command{ran === 1 ? '' : 's'} run
        </span>
        {claims && (
          <span
            className={`rounded-full px-2 py-0.5 ${
              unsupported
                ? 'border border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {unsupported ? 'claims execution — unsupported' : 'claims execution — verified'}
          </span>
        )}
      </div>

      {unsupported && (
        <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-200">
          This answer describes output from running code, but no command was executed
          in this run. Treat the output below as written, not measured.
        </p>
      )}
    </div>
  )
}

interface Props {
  status: RunStatus
  goal: string | null
  answer: string | null
  error: string | null
  nodes: RunNode[]
  refusals: Refusal[]
}

export function AnswerPane({ status, goal, answer, error, nodes, refusals }: Props) {
  const sources = collectSources(nodes)
  const index = new Map<string, number>()
  sources.forEach((source, i) => {
    if (source.kind === 'page') index.set(source.url, i + 1)
  })

  return (
    <section className="thin-scroll min-h-0 flex-1 overflow-auto px-6 py-5">
      {goal && (
        <p className="mb-5 border-l-2 border-white/15 pl-3 text-[15px] leading-snug text-zinc-300">
          {goal}
        </p>
      )}

      {status === 'idle' && (
        <p className="text-[14px] leading-relaxed text-zinc-600">
          Ask something. Lumen answers with sources you can open, and where a claim
          can be settled by running code, it writes the snippet, runs it, and cites
          the exit code next to the pages.
        </p>
      )}

      {(status === 'starting' || status === 'running') && !answer && (
        <p className="animate-pulse text-[14px] text-zinc-500">working…</p>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">
          {error}
        </div>
      )}

      {answer && <Provenance answer={answer} nodes={nodes} />}

      {answer && (
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-100">
          <Linkified text={answer} index={index} />
        </div>
      )}

      {refusals.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-[11px] uppercase tracking-wider text-amber-500/80">Refused</h3>
          <ul className="space-y-1.5">
            {refusals.map((refusal) => (
              <li
                key={refusal.seq}
                className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200"
              >
                <span className="font-mono text-amber-300">{refusal.node}</span>
                <span className="mx-1.5 text-amber-500/60">—</span>
                {refusal.detail}
                {refusal.rule && (
                  <span className="ml-1.5 font-mono text-amber-400/80">({refusal.rule})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-7">
          <h3 className="mb-2.5 text-[11px] uppercase tracking-wider text-zinc-600">Sources</h3>
          <ol className="space-y-2">
            {sources.map((source, i) =>
              source.kind === 'page' ? (
                <li key={source.url} className="flex gap-2.5">
                  <span className="mt-0.5 font-mono text-[11px] text-zinc-600">[{i + 1}]</span>
                  <div className="min-w-0">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-[13px] text-sky-300 no-underline hover:underline"
                    >
                      {source.title}
                    </a>
                    <span className="text-[11px] text-zinc-600">{domain(source.url)}</span>
                  </div>
                </li>
              ) : (
                <li key={`run-${i}`} className="flex gap-2.5">
                  <span className="mt-0.5 font-mono text-[11px] text-zinc-600">[{i + 1}]</span>
                  <div className="min-w-0">
                    <code className="block truncate font-mono text-[12px] text-emerald-300">
                      $ {source.command}
                    </code>
                    <span className="text-[11px] text-zinc-600">
                      ran locally · exit {source.exitCode}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ol>
        </div>
      )}
    </section>
  )
}
