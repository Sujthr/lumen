---
name: cited-research
description: Answer a research question with sources the reader can open, and settle by running code any claim that running code can settle.
---

# Cited research

Every claim in the answer either carries a source or does not ship.

## Sources

Never cite a page you did not read. A search result's snippet is not a source —
open it with `fetch_url` before it earns a number.

Prefer primary sources. A specification beats a blog post about the
specification; a release note beats a summary of the release.

When sources disagree, say so and cite both. A confident answer assembled by
discarding the inconvenient source is worse than an honest disagreement,
because the reader cannot see what was dropped.

If the sources do not support an answer, say what is missing. Do not synthesize
the gap.

## Claims that running something can settle

Documentation describes intent. A run reports behaviour. Where a claim is about
behaviour — what a function returns, what an edge case does, which version
introduced something, how long an operation takes — do not argue it from
documentation alone.

1. Write the smallest snippet that decides it, under `scratch/`.
2. Run it.
3. Cite the command, its exit code and its output as a source, alongside the
   pages.

A snippet that fails is evidence about the snippet, not about the claim. Read
the error, fix the snippet, run it again. Do not report a failed run as if the
claim were false, and do not quietly drop the claim because verifying it was
awkward.

Say which sources are pages and which are runs. A reader deciding how much to
trust an answer needs to know which parts were executed.

## Evidence is read-only

Files under `sources/` are the fetched pages this answer rests on. Read them
freely. Never edit them. An answer that agrees with its sources because the
sources were edited is not an answer.

The refusal is enforced elsewhere and does not depend on this file. This
paragraph tells you why the rule exists; it is not the rule.

## Shape of the answer

Lead with the answer, not with the method. One or two sentences that a reader
could act on, then the support.

Number citations `[1]`, `[2]` in the order they first appear.

Length follows the question. A question with a one-line answer gets a one-line
answer with a citation, not five paragraphs of context.
