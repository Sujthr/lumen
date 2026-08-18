import { useState } from 'react'
import { AnswerPane } from './AnswerPane'
import { RunPane } from './RunPane'
import { useRun } from './useRun'

const EXAMPLES = [
  'Which Python version made dict ordering an official language guarantee?',
  'Is Python’s sorted() stable? Verify it by running code.',
  'What does `git -c core.pager=id log` actually execute, and why is that a problem?',
]

export default function App() {
  const run = useRun()
  const [question, setQuestion] = useState('')
  const busy = run.status === 'starting' || run.status === 'running'

  function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setQuestion(trimmed)
    void run.ask(trimmed)
  }

  return (
    <div className="grid h-full grid-rows-[auto_1fr] bg-[#0b0d10]">
      <header className="flex items-center gap-3 border-b border-white/10 px-6 py-3">
        <span className="text-[15px] font-semibold tracking-tight text-zinc-100">Lumen</span>
        <span className="text-[12px] text-zinc-600">
          answers with sources, and with the runs that verified them
        </span>
        {run.runId && (
          <code className="ml-auto font-mono text-[11px] text-zinc-600">{run.runId}</code>
        )}
      </header>

      <main className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="flex min-h-0 flex-col">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit(question)
            }}
            className="border-b border-white/10 px-6 py-4"
          >
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a research question…"
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3.5 py-2.5 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/50"
              />
              <button
                type="submit"
                disabled={busy || !question.trim()}
                className="rounded-md bg-sky-500 px-4 py-2.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
              >
                {busy ? 'Running…' : 'Ask'}
              </button>
            </div>

            {run.status === 'idle' && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => submit(example)}
                    className="rounded-full border border-white/10 px-2.5 py-1 text-[11.5px] text-zinc-500 hover:border-white/25 hover:text-zinc-300"
                  >
                    {example.length > 62 ? `${example.slice(0, 62)}…` : example}
                  </button>
                ))}
              </div>
            )}
          </form>

          <AnswerPane
            status={run.status}
            goal={run.goal}
            answer={run.answer}
            error={run.error}
            nodes={run.nodes}
            refusals={run.refusals}
          />
        </div>

        <RunPane
          status={run.status}
          nodes={run.nodes}
          patches={run.patches}
          now={run.now}
          startedAt={run.startedAt}
        />
      </main>
    </div>
  )
}
