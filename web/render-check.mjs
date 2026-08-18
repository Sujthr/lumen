// Execute the production bundle in jsdom and report whether React mounted.
// Catches the class of failure a served-200 module check cannot see.
import { JSDOM } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const assets = readdirSync('dist/assets')
const bundle = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.js'))}`, 'utf8')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost:5173/',
})

const errors = []
dom.window.addEventListener('error', (e) => errors.push(String(e.error || e.message)))
dom.window.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) })
dom.window.EventSource = class {
  close() {}
}

try {
  dom.window.eval(bundle)
} catch (e) {
  errors.push(`${e.name}: ${e.message}`)
}

// React 19 schedules its first commit, so reading the DOM synchronously after
// eval reports an empty root even on a healthy app. Let the scheduler run.
await new Promise((resolve) => setTimeout(resolve, 800))

const root = dom.window.document.getElementById('root')
console.log('root children :', root.children.length)
console.log('text length   :', root.textContent.trim().length)
console.log('first 220     :', JSON.stringify(root.textContent.trim().slice(0, 220)))
if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
