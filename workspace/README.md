# The agent's workspace

Point `S17_WORKSPACE` at this directory. It is the only place the agent may
write, and `S17_PROTECTED_PATHS` decides what it may not touch even here.

```
workspace/
├── average.py            the demo bug: the docstring promises 0, the code raises
├── conftest.py           so pytest puts this directory on sys.path
├── sources/              fetched evidence — PROTECTED, read-only to the agent
└── tests/
    └── test_average.py   the judge — PROTECTED, so it cannot be deleted to fake a pass
```

`average.py` ships broken on purpose. That is the red-to-green demo:

```
$ pytest tests/test_average.py     1 failed, 1 passed     <- red
  the agent reads average.py and edits it
$ pytest tests/test_average.py     2 passed               <- green
```

`tests/**` is protected, so the cheap ways out — delete the test, skip it,
weaken the assertion — are refused before the edit is attempted. The only route
to green is fixing the code.

Re-arm it between takes with `./lumen.sh arm` (or `.\lumen.ps1 arm`), which
restores the bug and then proves pytest is actually red.

`sources/` is where a research run writes the pages an answer cites. It is
protected for the same reason `tests/` is: the agent may cite the evidence, it
may not edit the evidence.
