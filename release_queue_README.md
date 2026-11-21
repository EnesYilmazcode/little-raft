# release_queue.py: local tested-release queue

`release_queue.py` lives in the project root, next to `publish_local.py`. It watches
`.releases/queue/` for candidates. For each one, it tests a private snapshot on a loopback QA
server and publishes through `publish_local.promote()` only if every check passed. The
live `desktop/server.py` (`RAFT_RELEASE_MODE=1`, port 41896) is never started, stopped or
modified. Clients that are already open pick up the new `dist/version.json` on their next
6-second poll, and `live.js` swaps the game in place.

It uses only the standard library. It runs no shell, git, cloud or network commands. The
only HTTP traffic is to `127.0.0.1:<qa-port>`.

## Running

```powershell
python release_queue.py --watch            # poll every 2 s until Ctrl+C
python release_queue.py --once             # scan, wait one interval, scan again, process, exit
```

Options: `--qa-port 41902` (or env `RAFT_QA_PORT`), `--interval 2`, `--check-timeout 180`
(the maximum is 180), `--keep-work` (keeps snapshots and check logs for debugging) and
`--root <dir>` (the default is the script's own folder).

`--once` exit codes:

| code | meaning |
|---|---|
| 0 | nothing failed (zero or more candidates published) |
| 1 | at least one candidate failed and was **not** published |
| 2 | another queue process holds the lock |
| 3 | setup error (`publish_local.py` or `desktop/server.py` missing, bad args, QA port = live port) |
| 4 | nothing failed, but a ready candidate was still changing and was left for later |

The queue prints one JSON log line per event to stdout.

## Enqueuing a candidate (coordinator, after integration)

1. Choose an id matching `[A-Za-z0-9][A-Za-z0-9._-]{0,79}`, e.g. `20261120-1532-wave3`.
2. Write everything into a temp folder **on the same drive**:
   `.releases/queue/<id>.tmp/` (the queue ignores names ending in `.tmp` / `.partial`):
   - `dist/`: a full copy of the integrated game (it must contain `index.html` and `game.js`;
     no symlinks or junctions).
   - `candidate.json`:
     ```json
     {
       "label": "wave3",
       "checks": [
         ["python", "check_game.py"],
         ["python", "check_hook.py"],
         ["node", "tools/smoke.mjs"],
         ["uv", "run", "--with=playwright", "python", "check_multiplayer.py"]
       ]
     }
     ```
3. Rename `<id>.tmp` to `<id>`, then create the empty marker `candidate.ready` **last**:
   ```powershell
   Rename-Item .releases\queue\20261120-1532-wave3.tmp 20261120-1532-wave3
   New-Item .releases\queue\20261120-1532-wave3\candidate.ready -ItemType File
   ```
4. Poll `.releases/status/<id>.json` until `state` is `published` or `failed`. You can also run
   `python release_queue.py --once` and check the exit code.

To resubmit, just change the files (or replace the folder). A new content hash is tested
again; the same hash is never re-run once it is `published` or `failed`. You can delete
finished candidate folders at any time. Candidates are processed in order of their
`candidate.ready` modification time, oldest first.

## Candidate rules

- `label` must match `[A-Za-z0-9_-]{1,48}`. `promote()` turns it into the build id
  `<label>-<digest>`, which has to satisfy `server.py`'s `?build=` regex.
- `checks` must be a non-empty array (at most 32) of non-empty argv arrays of strings. A
  check written as a plain string is rejected, and nothing runs with `shell=True`.
- `argv[0]` must be exactly `python`, `node` or `uv`:
  - `python` runs as the queue's own `sys.executable`. It must run a `.py` script or
    `-m module`. `-c`, `-i` and stdin (`-`) are rejected. Pass option values as separate
    tokens (`-W ignore`, not `-Wignore`).
  - `node` must run a `.js`/`.mjs`/`.cjs` script. `-e`, `-p`, `--eval`, `--print`, `-i` and
    stdin are rejected.
  - `uv` must be `uv run [--opt=value ...] <python|node|file.py> ...`, with the same rules
    for the target. It runs with `UV_OFFLINE=1`.
  - Shell names (`cmd`, `powershell`, `pwsh`, `bash`, `sh`, `wsl`) may not appear in any
    argument. A program that resolves to a `.bat`/`.cmd` is refused.
- A check passes only on exit code 0. A check that runs longer than 180 s is killed along
  with its whole process tree (`taskkill /T /F`) and counts as a failure. Checks run in
  order, and the first failure stops the rest.

## What happens for each candidate

1. **Stability**: the candidate is considered only once `candidate.ready` exists and the
   content hash (`candidate.json` plus every file path and byte under `dist/`; the marker
   itself is excluded) is the same on two consecutive scans. Locked or vanishing files
   just mean "try again later".
2. **Snapshot**: the candidate is copied to `.releases/work/<id>-<hash16>/` and rehashed.
   If the hash differs, it waits until the candidate settles again.
3. **QA server**: a subprocess `python -I release_queue.py --_serve` imports
   `desktop/server.py` with `RAFT_DIST=<snapshot>/dist` and `RAFT_RELEASE_MODE=1`. It uses
   that server's own `Handler`, so `?build=` rewriting, MIME types and `/health` are
   identical, but it binds only to **127.0.0.1:41902**, with `SO_EXCLUSIVEADDRUSE` and no
   address reuse. The queue confirms that `/health` answers and that `/index.html` is the
   snapshot's file byte for byte. If the queue dies, the server exits on its own.
4. **Checks**: they run with `cwd` = project root and this environment:
   `RAFT_QA_URL=http://127.0.0.1:41902/`, `RAFT_DIST=<snapshot dist>`, `RAFT_PORT=41902`,
   `RAFT_CANDIDATE_ID`, `RAFT_CANDIDATE_LABEL`, `RAFT_SOURCE_HASH`. `RAFT_RELEASE_MODE` is
   removed. Output goes to files rather than pipes, so leftover browser processes can't
   hang the queue.
5. **Rehash**: the snapshot is hashed again after the checks. If anything changed, the
   candidate fails and nothing is published.
6. **Publish**: the queue imports the root `publish_local.py` by file path and calls
   `promote(<snapshot dist>, label)`. That writes the immutable files and then
   `dist/version.json` last. The queue then confirms that `dist/version.json` holds the
   returned build.

A candidate that fails is never published.

## Status files: `.releases/status/<id>.json`

Each file is written atomically (temp file, fsync, `os.replace`, with retries if Windows
reports the file as in use). Fields:

`state` (`testing` | `failed` | `published`), `label`, `source_hash`, `dist_hash`,
`snapshot_hash`, `attempt`, `started_at`/`finished_at`/`updated_at` (UTC ISO) plus
`*_epoch`, `duration_s`, `candidate_build` (from the candidate's own version.json),
`previous_live_build`, `build` (the build that was published), `published_at`, `qa_url`,
`error`, `infra_error`, and `checks[]` with `argv`, `state`
(`passed`/`failed`/`timeout`/`error`/`skipped`), `exit_code`, `timed_out`,
`duration_s`, and `stdout`/`stderr` (the first 4 KB plus the last 12 KB).

`infra_error: true` means the problem was not the candidate's fault: QA port busy,
`promote()` raised, files changed during the snapshot, or a queue bug. These are retried
automatically after 60 s for the same hash. Real check or validation failures are final
for that hash. A `testing` status left behind by a crashed run is redone on the next scan.

## Single watcher lock

The lock is `.releases/release_queue.lock`, created with `O_CREAT|O_EXCL`. It holds the
pid, the process creation time (from `GetProcessTimes`, so a recycled PID is not mistaken
for the owner) and a random nonce.

- A lock whose process is dead, or whose pid now belongs to a different process, is stale.
  The queue renames it to a unique `*.stale-*` name, confirms it moved the stale lock and
  not a fresh one, and deletes it.
- A lock file that can't be parsed counts as stale only after 30 s, because the owner may
  still be writing it.
- `--watch` checks every cycle that the lock still holds its nonce, and exits with code 2
  if not.
- The lock is removed on exit only if it is still the queue's own.

## Files

```
.releases/queue/<id>/{dist/, candidate.json, candidate.ready}   # input (coordinator)
.releases/status/<id>.json                                       # output
.releases/work/<id>-<hash16>/                                    # temporary snapshot, logs
.releases/release_queue.lock
```
