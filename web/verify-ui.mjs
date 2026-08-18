// Drive the built app the way a browser does: mount it, click Ask, replay a
// recorded event stream, and assert what a reader would actually see.
//
// Asserting that elements exist proves nothing about whether they behaved. Each
// case here goes through the real code path — fetch, EventSource, React state —
// and reads the rendered text at the end.
import { JSDOM } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const bundle = readFileSync(
  `dist/assets/${readdirSync('dist/assets').find((f) => f.endsWith('.js'))}`,
  'utf8',
)

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms))

/** Mount the app with a scripted backend, run one question, return the DOM. */
async function drive({ frames, answer }) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:5173/',
  })
  const { window } = dom
  const errors = []
  window.addEventListener('error', (e) => errors.push(String(e.error || e.message)))

  window.fetch = async (url, init) => {
    const path = String(url)
    if (path.endsWith('/api/ask')) {
      return { ok: true, json: async () => ({ run_id: 'test-run', goal: JSON.parse(init.body).question }) }
    }
    if (/\/api\/runs\/[^/]+$/.test(path)) {
      return { ok: true, json: async () => ({ status: 'finished', result: { answer }, error: null }) }
    }
    return { ok: true, json: async () => ({}) }
  }

  // Replay the recorded frames as soon as the app subscribes.
  window.EventSource = class {
    constructor() {
      this.onmessage = null
      setTimeout(() => {
        for (const frame of frames) this.onmessage?.({ data: JSON.stringify(frame) })
      }, 10)
    }
    close() {}
  }

  window.eval(bundle)
  await tick(300)

  const root = window.document.getElementById('root')
  const ask = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ask')
  const input = root.querySelector('input')

  // React tracks the input's value internally; set it the way the browser does.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'does it run?')
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  await tick(60)
  ask.click()
  await tick(500)

  return { text: root.textContent, errors }
}

const RAN = [
  { type: 'RUN_STARTED', seq: 1 },
  { type: 'STEP_STARTED', seq: 2, stepName: 'run_stability_test' },
  {
    type: 'STEP_FINISHED', seq: 3, source_kind: 'task_succeeded', stepName: 'run_stability_test',
    delta: {
      op: 'add', path: '/results/run_stability_test',
      value: { command: 'python stability_test.py', exit_code: 0, ok: true, timed_out: false, stdout: "[('blue', 1)]", stderr: '' },
    },
  },
  { type: 'RUN_FINISHED', seq: 4 },
]

const SEARCHED_ONLY = [
  { type: 'RUN_STARTED', seq: 1 },
  { type: 'STEP_STARTED', seq: 2, stepName: 'research_it' },
  {
    type: 'STEP_FINISHED', seq: 3, source_kind: 'task_succeeded', stepName: 'research_it',
    delta: {
      op: 'add', path: '/results/research_it',
      value: { hits: [{ title: 'Sorting HOWTO', url: 'https://docs.python.org/3/howto/sorting.html', snippet: '…' }] },
    },
  },
  { type: 'RUN_FINISHED', seq: 4 },
]

const CLAIM = 'When this code is executed, the output is: [(\'blue\', 1)]'

const cases = [
  {
    name: 'a command that ran renders its exit code',
    frames: RAN, answer: CLAIM,
    expect: ['python stability_test.py', 'exit 0', '1 command run', 'claims execution — verified'],
    reject: ['claims execution — unsupported'],
  },
  {
    name: 'an answer claiming execution with no command is flagged',
    frames: SEARCHED_ONLY, answer: CLAIM,
    expect: ['0 commands run', 'claims execution — unsupported', 'no command was executed in this run'],
    reject: ['claims execution — verified'],
  },
  {
    name: 'a plain answer is not accused of anything',
    frames: SEARCHED_ONLY, answer: 'Python guarantees sorted() is stable.',
    expect: ['1 page read', 'Sorting HOWTO'],
    reject: ['claims execution', 'no command was executed'],
  },
]

let failed = 0
for (const testCase of cases) {
  const { text, errors } = await drive(testCase)
  const missing = testCase.expect.filter((phrase) => !text.includes(phrase))
  const present = testCase.reject.filter((phrase) => text.includes(phrase))
  const ok = !missing.length && !present.length && !errors.length
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`)
  if (missing.length) console.log('   missing :', missing)
  if (present.length) console.log('   present but should not be:', present)
  if (errors.length) console.log('   errors  :', errors)
}

console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} passed`)
process.exit(failed ? 1 : 0)
