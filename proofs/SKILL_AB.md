# Skill A/B — the honest result

Same question, same model (`gemini-flash-latest`), same everything except
`S17_SKILLS_DIR`. The question deliberately says nothing about running code, so
the skill is the only thing that could cause verification:

> Is Python's sorted() stable?

| Arm | `S17_SKILLS_DIR` | Nodes | Commands run | Time | Outcome |
|---|---|---|---|---|---|
| A | unset | 2 | 0 | 113.5s | searched, then answered with two real citations |
| B | set | 1 | 0 | 39.0s | answered directly; **"no information available to answer"** |
| B (repeat) | set | 1 | 0 | 51.6s | answered directly again |

Raw records: `ab_skill_off.json`, `ab_skill_on.json`, `ab_skill_on_2.json`.

## The skill made it worse, not better

The lesson's own A/B shows a skill turning a broken page into a working one.
Ours did the opposite, twice, and the honest reading is not "skills don't work".

**The skill was discovered and offered.** Verified directly:

```
SkillManager.discover('d:/EAG/EAG/15_Aug/skills')
errors: []
skill: cited-research | Answer a research question with sources the reader can open, …
```

`load_skill` was in the registry and the one-line listing was in the planner's
context. The planner read it and declined:

> Arm B: "Directly answer the question using answer_with_evidence as Python's
> sorted() stability is a well-established property requiring no external tools."
>
> Arm B repeat: "Direct conceptual question about Python's built-in behaviour."

Then, having gathered no evidence, arm B answered:

> "Based on the provided evidence, there is no information available to answer
> whether Python's `sorted()` function is stable."

Which is the evidence critic working exactly as designed — it refused to
synthesize a fact it had no source for. The bad decision was upstream: skipping
research at all.

## Why: progressive disclosure has a trigger problem

Three levels, and only the first is always in context:

| Level | Carried | When |
|---|---|---|
| listing | name + description | always |
| body | the full instructions | only after `load_skill` |
| references | extra files | only if asked |

The sentence that would have changed the decision is in the **body**:

> "Documentation describes intent. A run reports behaviour. Where a claim is
> about behaviour … do not argue it from documentation alone."

But the decision to load the body is made from the **description** alone. The
model has to want the skill before it can read the argument for wanting it.

Our description — "Answer a research question with sources the reader can
open…" — reads like it is *for* research questions. A planner that has already
decided this is a settled conceptual question does not think it has a research
question, so the skill does not appear relevant, so the body is never read.

**A skill's description is not documentation. It is the trigger, and it is the
only part that competes for the decision.**

## The untested fix

`SKILL.md.sharpened` keeps the body byte-for-byte and rewrites only the
description to attack the exact reasoning that skipped it:

> Load this before answering ANY question of fact, including ones that look
> settled or conceptual. It governs how sources are cited and requires that
> behavioural claims be verified by running code rather than argued from
> documentation.

**This was never run.** The daily quota was exhausted before arm C. It is
recorded as a prediction, not a result, and the shipped `SKILL.md` is still the
version the table above actually tested.

## What this does not show

- n=1 per arm for A, n=2 for B. The planner is nondeterministic. Arm B's
  behaviour repeated, arm A's did not get a repeat at all.
- One question, on one model. A question that obviously needs a tool would
  likely load the skill in both arms and show nothing.
- It says nothing about whether the skill's *body* is any good, because on this
  question the body was never read.

## What it does show

The lesson's closing caveat, reproduced from the other side:

> "Nothing about writing an instruction in markdown makes it binding, only the
> runtime refuses."

A skill can fail without ever being wrong. Ours was never read.
