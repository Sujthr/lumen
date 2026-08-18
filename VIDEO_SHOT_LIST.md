# Video shot list — 9 minutes, unlisted

Record the failure segment **first**, while you have slack. It is the segment
most likely to need retakes and worth the most marks.

**Before every take:** check quota. One run is 10–20 gateway calls and the free
tier gives 20 per day per model per key. `lumen/proofs/record_run.py` output is
replayable from disk if a live run dies mid-recording.

---

| Time | Shot | What to say |
|---|---|---|
| 0:00 | The product answering one question, end to end. No narration. | — |
| 0:50 | Point at the run pane. | "Every node, every command, every refusal, as it happens. That legibility is the only thing a black box can't give you." |
| 1:40 | A claim being settled by running code: `$ python stability_test.py → exit 0`, then the same output quoted in the answer, cited as `[2] ran locally`. | "Real Perplexity can tell you what the docs say. It can't run the thing." |
| 3:00 | **The failure.** Same run, scroll up: seven planner attempts failing as the model discovers `;` has no meaning without a shell, then it writes a file and runs it. | "Nobody staged this. The command runner refuses a shell, and it took the agent seven tries to believe that." |
| 4:30 | The `sources/**` refusal. | "Protected paths in a research tool aren't tests. They're the evidence. It may cite the evidence; it may not edit it." |
| 5:15 | The honesty badge: an answer claiming execution with zero commands run, flagged `claims execution — unsupported`. | "Before I fixed bug G, this is what every answer looked like — fluent, plausible, and describing output that never existed." |
| 6:15 | Architecture: 8111 / 8113 / 8115 / 5173, and where the token is *not*. | "Vite inlines every VITE_ variable into the shipped bundle. A token there is a published credential." |
| 7:00 | The seven bugs, 30 seconds on F and G. | "These two are why nothing could be verified. Both were found by the product failing, not by reading code." |
| 8:00 | `node verify-ui.mjs` — three cases green. | "Asserting an element exists proves nothing about whether it behaved. These replay real event streams through the real components." |
| 8:30 | What it still gets wrong. | "It will describe output it never produced. A skill is advice; only the runtime refuses. And the free tier is twenty requests a day." |

---

## Have on screen before recording

- Four services up: `8111`, `8113`, `8115`, `5173` (`/api/health` shows
  `s17_reachable` and the declared side effects).
- A recorded successful run in `proofs/` as a fallback.
- `BUGS.md` open for the bug segment.

## Do not

- Do not claim the agent wrote something you wrote, or the reverse. The README
  has an explicit authorship section; keep the video consistent with it.
- Do not cut the failing attempts. They are the most valuable footage you have.
