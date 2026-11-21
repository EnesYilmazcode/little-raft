"""Little Raft local tested-release queue.

Watches .releases/queue/<id>/ for candidates (dist/ + candidate.json + candidate.ready),
snapshots each stable candidate, serves the snapshot on a private loopback QA port with
desktop/server.py's handler, runs the candidate's allowlisted checks, and only when every
check exits 0 (and the snapshot is byte-identical afterwards) calls
publish_local.promote(snapshot_dist, label). The live server is never touched; it simply
picks up the new dist/version.json that promote() writes last.

Usage:
  python release_queue.py --watch          # poll every 2s until Ctrl+C
  python release_queue.py --once           # settle-scan twice, process, exit

--once exit codes:
  0  nothing failed (published zero or more candidates)
  1  at least one candidate failed (not published)
  2  another release_queue process holds the lock
  3  setup error (publish_local.py / desktop/server.py missing, bad arguments)
  4  nothing failed, but some ready candidates were still changing (not processed)

Stdlib only. No shell, no git, no network beyond 127.0.0.1.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

QUEUE_VERSION = 1
DEFAULT_QA_PORT = 41902
LIVE_DEFAULT_PORT = 41896
POLL_SECONDS = 2.0
CHECK_TIMEOUT = 180.0
SERVER_START_TIMEOUT = 20.0
INFRA_RETRY_SECONDS = 60.0
OUTPUT_HEAD = 4000
OUTPUT_TAIL = 12000
MAX_CHECKS = 32
MAX_ARGS = 64
MAX_ARG_LEN = 4096
MAX_FILES = 20000
MAX_BYTES = 1024 * 1024 * 1024
MAX_CANDIDATE_JSON = 1024 * 1024

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
# Build ids become "<label>-<digest>" and must satisfy desktop/server.py's
# build regex [A-Za-z0-9_-]{1,80}; keep labels short and in that alphabet.
LABEL_RE = re.compile(r"^[A-Za-z0-9_-]{1,48}$")
ALLOWED_PROGRAMS = ("python", "node", "uv")
SHELLS = {"cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
          "bash", "bash.exe", "sh", "sh.exe", "wsl", "wsl.exe"}

IS_WIN = os.name == "nt"
FILE_ATTRIBUTE_REPARSE_POINT = 0x400


# --------------------------------------------------------------------------- utils
def now_iso(t: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() if t is None else t))


def log(event: str, **fields) -> None:
    rec = {"t": now_iso(), "event": event}
    rec.update(fields)
    print(json.dumps(rec, default=str), flush=True)


def truncate(text: str) -> str:
    if len(text) <= OUTPUT_HEAD + OUTPUT_TAIL:
        return text
    cut = len(text) - OUTPUT_HEAD - OUTPUT_TAIL
    return text[:OUTPUT_HEAD] + f"\n... [{cut} chars truncated] ...\n" + text[-OUTPUT_TAIL:]


def atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        # Windows: os.replace fails if a reader holds the target open; retry briefly.
        for attempt in range(20):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.05 * (attempt + 1))
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def read_json(path: Path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def is_link_or_reparse(st: os.stat_result) -> bool:
    return stat.S_ISLNK(st.st_mode) or bool(getattr(st, "st_file_attributes", 0) & FILE_ATTRIBUTE_REPARSE_POINT)


def inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


# --------------------------------------------------------------------------- process identity
if IS_WIN:
    import ctypes
    from ctypes import wintypes

    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _k32.OpenProcess.restype = wintypes.HANDLE
    _k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    _k32.CloseHandle.argtypes = (wintypes.HANDLE,)
    _k32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    _k32.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _STILL_ACTIVE = 259
    _ERROR_ACCESS_DENIED = 5


def process_token(pid: int) -> str | None:
    """Creation-time token so a recycled PID is not mistaken for the lock owner."""
    if not IS_WIN:
        try:
            with open(f"/proc/{pid}/stat", "r") as f:
                return f.read().rsplit(")", 1)[1].split()[19]
        except (OSError, IndexError):
            return None
    h = _k32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return None
    try:
        c, e, k, u = (wintypes.FILETIME() for _ in range(4))
        if not _k32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(k), ctypes.byref(u)):
            return None
        return str((c.dwHighDateTime << 32) | c.dwLowDateTime)
    finally:
        _k32.CloseHandle(h)


def pid_alive(pid: int, token: str | None = None) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    if IS_WIN:
        h = _k32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            # Access denied means it exists (another user/elevated); anything else: gone.
            return ctypes.get_last_error() == _ERROR_ACCESS_DENIED
        try:
            code = wintypes.DWORD()
            if not _k32.GetExitCodeProcess(h, ctypes.byref(code)) or code.value != _STILL_ACTIVE:
                return False
        finally:
            _k32.CloseHandle(h)
    else:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            pass
    if token is not None:
        current = process_token(pid)
        if current is not None and current != token:
            return False  # PID was recycled by an unrelated process
    return True


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if IS_WIN:
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            pass
    if proc.poll() is None:
        try:
            proc.kill()
        except OSError:
            pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass


# --------------------------------------------------------------------------- lock
class LockHeld(Exception):
    pass


class QueueLock:
    """Single-watcher lock: O_CREAT|O_EXCL file holding pid + creation token."""

    def __init__(self, path: Path):
        self.path = path
        self.me = {"pid": os.getpid(), "token": process_token(os.getpid()),
                   "started": now_iso(), "nonce": os.urandom(8).hex()}
        self.held = False

    def _raw(self, path: Path) -> bytes | None:
        try:
            with open(path, "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None
        except OSError:
            return b""

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(self.me).encode()
        for _ in range(5):
            try:
                fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o644)
            except FileExistsError:
                self._handle_existing()
                continue
            try:
                os.write(fd, payload)
                os.fsync(fd)
            finally:
                os.close(fd)
            self.held = True
            return
        raise LockHeld(self._describe())

    def _describe(self) -> str:
        raw = self._raw(self.path)
        return raw.decode("utf-8", "replace") if raw else "unknown holder"

    def _handle_existing(self) -> None:
        raw = self._raw(self.path)
        if raw is None:
            return  # vanished; retry create
        try:
            info = json.loads(raw.decode("utf-8"))
            pid, token = int(info["pid"]), info.get("token")
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            # Possibly a holder mid-write: only stale if it has been unreadable a while.
            try:
                age = time.time() - self.path.stat().st_mtime
            except OSError:
                return
            if age < 30:
                raise LockHeld("lock file is being written by another process")
            pid, token = -1, None
        if pid_alive(pid, token):
            raise LockHeld(raw.decode("utf-8", "replace"))
        # Stale. Move it aside under a unique name, then confirm we moved the stale one.
        aside = self.path.with_name(f"{self.path.name}.stale-{os.getpid()}-{time.time_ns()}")
        try:
            os.rename(self.path, aside)
        except FileNotFoundError:
            return
        except OSError:
            time.sleep(0.2)
            return
        moved = self._raw(aside)
        if moved != raw:
            # Someone replaced it with a fresh lock between our read and rename: put it back.
            try:
                os.rename(aside, self.path)
            except OSError:
                pass  # a newer lock exists; the displaced owner notices via still_owned()
            return
        try:
            os.remove(aside)
        except OSError:
            pass
        log("stale-lock-removed", previous=raw.decode("utf-8", "replace"))

    def still_owned(self) -> bool:
        raw = self._raw(self.path)
        try:
            return bool(raw) and json.loads(raw.decode("utf-8")).get("nonce") == self.me["nonce"]
        except (ValueError, UnicodeDecodeError, AttributeError):
            return False

    def release(self) -> None:
        if self.held and self.still_owned():
            try:
                os.remove(self.path)
            except OSError:
                pass
        self.held = False


# --------------------------------------------------------------------------- hashing
class Transient(Exception):
    """Files are mid-write / locked; try again next scan."""


def hash_tree(base: Path) -> tuple[str, list[str], int]:
    """Deterministic hash of a directory tree. Returns (hex, problems, file_count).

    Links/junctions are hashed by name only (never followed) and reported as problems.
    """
    h = hashlib.sha256(b"raft-tree-v1\0")
    problems: list[str] = []
    files = 0
    total = 0
    try:
        st = os.lstat(base)
    except FileNotFoundError:
        return "missing", ["missing directory"], 0
    except OSError as e:
        raise Transient(str(e))
    if is_link_or_reparse(st) or not stat.S_ISDIR(st.st_mode):
        return "invalid", ["dist is not a plain directory"], 0
    stack = [""]
    entries: list[tuple[str, str]] = []
    while stack:
        rel_dir = stack.pop()
        try:
            names = sorted(os.listdir(base / rel_dir if rel_dir else base))
        except OSError as e:
            raise Transient(str(e))
        for name in names:
            rel = f"{rel_dir}/{name}" if rel_dir else name
            full = base / rel
            try:
                est = os.lstat(full)
            except FileNotFoundError:
                raise Transient(f"{rel} vanished")
            except OSError as e:
                raise Transient(str(e))
            if is_link_or_reparse(est):
                entries.append(("L", rel))
                problems.append(f"link or junction not allowed: {rel}")
            elif stat.S_ISDIR(est.st_mode):
                entries.append(("D", rel))
                stack.append(rel)
            elif stat.S_ISREG(est.st_mode):
                entries.append(("F", rel))
            else:
                entries.append(("X", rel))
                problems.append(f"special file not allowed: {rel}")
    for kind, rel in sorted(entries, key=lambda e: e[1]):
        h.update(kind.encode() + b"\0" + rel.encode("utf-8", "surrogatepass") + b"\0")
        if kind != "F":
            continue
        files += 1
        if files > MAX_FILES:
            problems.append(f"more than {MAX_FILES} files")
            break
        fh = hashlib.sha256()
        try:
            with open(base / rel, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    fh.update(chunk)
                    total += len(chunk)
        except OSError as e:
            raise Transient(f"{rel}: {e}")
        if total > MAX_BYTES:
            problems.append("candidate dist too large")
            break
        h.update(fh.digest())
    return h.hexdigest(), problems, files


def hash_candidate(cdir: Path) -> tuple[str, str, list[str]]:
    """(source_hash, dist_hash, problems). Excludes the candidate.ready marker."""
    dist_hash, problems, _ = hash_tree(cdir / "dist")
    cj = cdir / "candidate.json"
    try:
        st = os.lstat(cj)
        if is_link_or_reparse(st) or not stat.S_ISREG(st.st_mode):
            problems.append("candidate.json is not a regular file")
            cj_digest = "invalid"
        elif st.st_size > MAX_CANDIDATE_JSON:
            problems.append("candidate.json too large")
            cj_digest = f"large-{st.st_size}"
        else:
            cj_digest = hashlib.sha256(cj.read_bytes()).hexdigest()
    except FileNotFoundError:
        problems.append("candidate.json missing")
        cj_digest = "missing"
    except OSError as e:
        raise Transient(str(e))
    src = hashlib.sha256(f"raft-candidate-v1\0candidate.json\0{cj_digest}\0dist\0{dist_hash}".encode()).hexdigest()
    return src, dist_hash, problems


# --------------------------------------------------------------------------- check validation
class InvalidCandidate(Exception):
    pass


def _reject_inline(program: str, args: list[str]) -> None:
    """Require a script file (or python -m module); forbid inline code / stdin / REPL.

    Every token before the script operand is inspected, so value-taking options
    (python -W x, node -r x) cannot be used to smuggle -c/-e past the check.
    """
    for a in args:
        if a == "-":
            raise InvalidCandidate(f"{program}: reading code from stdin is not allowed")
        if program == "python":
            if a == "-m":
                return
            if not a.startswith("-") and a.lower().endswith(".py"):
                return  # script reached; remaining args belong to the script
            if a.startswith("-") and not a.startswith("--") and "c" in a[1:]:
                raise InvalidCandidate("python -c (inline code) is not allowed")
            if a in ("-i",) or (a.startswith("-") and not a.startswith("--") and "i" in a[1:]):
                raise InvalidCandidate("python interactive mode is not allowed")
        else:  # node
            if not a.startswith("-") and a.lower().endswith((".js", ".mjs", ".cjs")):
                return
            if a in ("-e", "-p", "-pe", "-ep", "--eval", "--print") or a.startswith(("--eval=", "--print=")):
                raise InvalidCandidate("node -e/-p (inline code) is not allowed")
            if a in ("-i", "--interactive"):
                raise InvalidCandidate("node interactive mode is not allowed")
    if program == "python":
        raise InvalidCandidate("python checks must run a .py script or -m module")
    raise InvalidCandidate("node checks must run a .js/.mjs/.cjs script")


def validate_check(argv) -> list[str]:
    if isinstance(argv, str):
        raise InvalidCandidate("checks must be argv arrays; string commands (shell) are forbidden")
    if not isinstance(argv, list) or not argv:
        raise InvalidCandidate("each check must be a non-empty argv array")
    if len(argv) > MAX_ARGS:
        raise InvalidCandidate("check has too many arguments")
    for a in argv:
        if not isinstance(a, str) or not a or len(a) > MAX_ARG_LEN or "\0" in a:
            raise InvalidCandidate(f"invalid argument {a!r}")
    program = argv[0]
    if program not in ALLOWED_PROGRAMS:
        raise InvalidCandidate(f"program {program!r} not allowed (allowed: {', '.join(ALLOWED_PROGRAMS)})")
    for a in argv:
        if a.lower() in SHELLS:
            raise InvalidCandidate(f"shell {a!r} may not appear in a check")
    if program in ("python", "node"):
        _reject_inline(program, argv[1:])
    else:  # uv: only `uv run [--opt[=value]...] <python|node|script.py> ...`
        if len(argv) < 3 or argv[1] != "run":
            raise InvalidCandidate("uv checks must be 'uv run ...'")
        i = 2
        while i < len(argv) and argv[i].startswith("-"):
            if argv[i] == "--":
                i += 1
                break
            i += 1
        if i >= len(argv):
            raise InvalidCandidate("uv run: missing target")
        target = argv[i]
        if target in ("python", "node"):
            _reject_inline(target, argv[i + 1:])
        elif not target.lower().endswith(".py"):
            raise InvalidCandidate(
                f"uv run target {target!r} not allowed (use python, node, or a .py file; "
                "write uv options as --opt=value)")
    return list(argv)


def load_candidate_meta(path: Path) -> tuple[str, list[list[str]]]:
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError) as e:
        raise InvalidCandidate(f"candidate.json unreadable: {e}")
    if not isinstance(meta, dict):
        raise InvalidCandidate("candidate.json must be an object")
    label = meta.get("label")
    if not isinstance(label, str) or not LABEL_RE.match(label):
        raise InvalidCandidate("label must match [A-Za-z0-9_-]{1,48}")
    checks = meta.get("checks")
    if not isinstance(checks, list) or not checks:
        raise InvalidCandidate("checks must be a non-empty array of argv arrays")
    if len(checks) > MAX_CHECKS:
        raise InvalidCandidate(f"at most {MAX_CHECKS} checks")
    return label, [validate_check(c) for c in checks]


def resolve_program(argv: list[str]) -> list[str]:
    program = argv[0]
    if program == "python":
        exe = sys.executable
    else:
        exe = shutil.which(program)
        if not exe:
            raise FileNotFoundError(f"{program} not found on PATH")
    if IS_WIN and Path(exe).suffix.lower() in (".bat", ".cmd"):
        # .cmd/.bat would run through cmd.exe: that is shell execution.
        raise PermissionError(f"{program} resolves to a batch file ({exe}); refusing")
    return [exe] + argv[1:]


# --------------------------------------------------------------------------- QA server
def port_free(port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if IS_WIN and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_get(url: str, timeout: float = 3.0) -> bytes:
    with _NO_PROXY.open(url, timeout=timeout) as r:
        return r.read()


class QAServer:
    """Candidate server subprocess: desktop/server.py's Handler bound to 127.0.0.1:<port>."""

    def __init__(self, root: Path, dist: Path, port: int, log_dir: Path):
        self.root, self.dist, self.port, self.log_dir = root, dist, port, log_dir
        self.proc: subprocess.Popen | None = None
        self.url = f"http://127.0.0.1:{port}/"
        self._log = None

    def start(self) -> None:
        if not port_free(self.port):
            raise RuntimeError(f"QA port {self.port} is already in use on 127.0.0.1")
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._log = open(self.log_dir / "qa-server.log", "wb")
        env = dict(os.environ)
        env.update({"RAFT_DIST": str(self.dist), "RAFT_RELEASE_MODE": "1", "RAFT_PORT": str(self.port),
                    "PYTHONDONTWRITEBYTECODE": "1"})
        argv = [sys.executable, "-I", str(Path(__file__).resolve()), "--_serve",
                "--root", str(self.root), "--dist", str(self.dist), "--qa-port", str(self.port),
                "--_parent", f"{os.getpid()}:{process_token(os.getpid()) or ''}"]
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WIN else 0
        self.proc = subprocess.Popen(argv, cwd=str(self.root), env=env, stdin=subprocess.DEVNULL,
                                     stdout=self._log, stderr=subprocess.STDOUT, creationflags=flags)
        expect_index = (self.dist / "index.html").read_bytes()
        deadline = time.time() + SERVER_START_TIMEOUT
        last = "no response"
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"QA server exited with {self.proc.returncode}: {self.log_tail()}")
            try:
                health = json.loads(http_get(self.url + "health"))
                body = http_get(self.url + "index.html")
                if health.get("app") != "little-raft":
                    raise RuntimeError("unexpected /health payload")
                if body != expect_index:
                    raise RuntimeError("QA server is not serving the candidate snapshot")
                return
            except RuntimeError:
                raise
            except (OSError, ValueError, urllib.error.URLError) as e:
                last = str(e)
            time.sleep(0.2)
        raise RuntimeError(f"QA server did not become ready: {last}")

    def log_tail(self) -> str:
        try:
            return (self.log_dir / "qa-server.log").read_text("utf-8", "replace")[-2000:]
        except OSError:
            return ""

    def stop(self) -> None:
        if self.proc is not None:
            if self.proc.poll() is None:
                try:
                    self.proc.terminate()
                    self.proc.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            kill_tree(self.proc)
            self.proc = None
        if self._log:
            self._log.close()
            self._log = None


def serve_main(root: Path, dist: Path, port: int, parent: str) -> int:
    """Internal subprocess entry: import desktop/server.py and bind loopback only."""
    os.environ["RAFT_DIST"] = str(dist)
    os.environ["RAFT_RELEASE_MODE"] = "1"
    spec = importlib.util.spec_from_file_location("raft_candidate_server", str(root / "desktop" / "server.py"))
    if spec is None or spec.loader is None:
        print("desktop/server.py not found", file=sys.stderr)
        return 3
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # __name__ != "__main__": it will not bind 0.0.0.0 itself
    if Path(mod.ROOT).resolve() != dist.resolve():
        print(f"server ROOT mismatch: {mod.ROOT}", file=sys.stderr)
        return 3
    from http.server import ThreadingHTTPServer

    class LoopbackServer(ThreadingHTTPServer):
        allow_reuse_address = False  # SO_REUSEADDR on Windows permits port hijacking
        daemon_threads = True

        def server_bind(self):
            if IS_WIN and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    pid_s, _, token = parent.partition(":")
    ppid = int(pid_s or 0)

    def watchdog():
        while True:
            time.sleep(2)
            if ppid and not pid_alive(ppid, token or None):
                os._exit(0)  # orphaned: the queue died, don't linger on the port

    threading.Thread(target=watchdog, daemon=True).start()
    try:
        httpd = LoopbackServer(("127.0.0.1", port), mod.Handler)
    except OSError as e:
        print(e, file=sys.stderr)
        return 1
    httpd.serve_forever()
    return 0


# --------------------------------------------------------------------------- queue
class SetupError(Exception):
    pass


class ReleaseQueue:
    def __init__(self, root: Path, qa_port: int, check_timeout: float, keep_work: bool):
        self.root = root.resolve()
        self.base = self.root / ".releases"
        self.queue_dir = self.base / "queue"
        self.status_dir = self.base / "status"
        self.work_dir = self.base / "work"
        self.qa_port = qa_port
        self.check_timeout = check_timeout
        self.keep_work = keep_work
        self.seen: dict[str, str] = {}  # id -> source hash from previous scan
        self.lock = QueueLock(self.base / "release_queue.lock")

    # ---- setup
    def preflight(self) -> None:
        if not (self.root / "publish_local.py").is_file():
            raise SetupError(f"publish_local.py not found in {self.root}")
        if not (self.root / "desktop" / "server.py").is_file():
            raise SetupError(f"desktop/server.py not found in {self.root}")
        live_port = int(os.environ.get("RAFT_PORT", LIVE_DEFAULT_PORT) or LIVE_DEFAULT_PORT)
        if self.qa_port in (live_port, LIVE_DEFAULT_PORT):
            raise SetupError(f"QA port {self.qa_port} collides with the live server port")
        if not (1024 <= self.qa_port <= 65535):
            raise SetupError("QA port must be 1024-65535")
        for d in (self.queue_dir, self.status_dir, self.work_dir):
            d.mkdir(parents=True, exist_ok=True)

    def status_path(self, cid: str) -> Path:
        return self.status_dir / f"{cid}.json"

    # ---- scanning
    def scan(self) -> dict:
        """One pass. Returns counts: published, failed, pending (ready but unstable)."""
        result = {"published": 0, "failed": 0, "pending": 0, "skipped": 0}
        try:
            entries = sorted(self.queue_dir.iterdir())
        except OSError:
            return result
        ready = []
        present = set()
        for d in entries:
            cid = d.name
            if not ID_RE.match(cid) or cid.endswith((".tmp", ".partial")):
                continue
            try:
                st = os.lstat(d)
            except OSError:
                continue
            if is_link_or_reparse(st) or not stat.S_ISDIR(st.st_mode):
                continue
            present.add(cid)
            marker = d / "candidate.ready"
            try:
                mst = os.lstat(marker)
            except OSError:
                self.seen.pop(cid, None)
                continue
            if not stat.S_ISREG(mst.st_mode):
                continue
            ready.append((mst.st_mtime_ns, cid, d))
        for cid in list(self.seen):
            if cid not in present:
                del self.seen[cid]
        for _, cid, d in sorted(ready):  # oldest ready marker first
            try:
                src_hash, dist_hash, problems = hash_candidate(d)
            except Transient as e:
                self.seen.pop(cid, None)
                result["pending"] += 1
                log("candidate-busy", id=cid, reason=str(e))
                continue
            prev = self.seen.get(cid)
            self.seen[cid] = src_hash
            if prev != src_hash:
                result["pending"] += 1  # must be unchanged for one full scan interval
                continue
            if self._already_done(cid, src_hash):
                result["skipped"] += 1
                continue
            outcome = self.process(cid, d, src_hash, dist_hash, problems)
            if outcome in result:
                result[outcome] += 1
        return result

    def _already_done(self, cid: str, src_hash: str) -> bool:
        st = read_json(self.status_path(cid))
        if not isinstance(st, dict) or st.get("source_hash") != src_hash:
            return False
        state = st.get("state")
        if state == "published":
            return True
        if state == "failed":
            if st.get("infra_error"):
                return time.time() - float(st.get("finished_epoch") or 0) < INFRA_RETRY_SECONDS
            return True
        return False  # "testing" left by a crashed run (we hold the lock): redo it

    # ---- one candidate
    def process(self, cid: str, cdir: Path, src_hash: str, dist_hash: str, problems: list[str]) -> str:
        started = time.time()
        status = {
            "queue_version": QUEUE_VERSION, "id": cid, "state": "testing", "label": None,
            "source_hash": src_hash, "dist_hash": dist_hash, "snapshot_hash": None,
            "started_at": now_iso(started), "started_epoch": started,
            "updated_at": now_iso(started), "finished_at": None, "finished_epoch": None,
            "candidate_build": None, "previous_live_build": self._live_build(),
            "build": None, "qa_url": f"http://127.0.0.1:{self.qa_port}/",
            "checks": [], "error": None, "infra_error": False, "pid": os.getpid(),
        }
        prev = read_json(self.status_path(cid))
        status["attempt"] = (prev.get("attempt", 0) + 1) if isinstance(prev, dict) and prev.get("source_hash") == src_hash else 1

        def save():
            status["updated_at"] = now_iso()
            atomic_write_json(self.status_path(cid), status)

        def finish(state: str, error: str | None = None, infra: bool = False) -> str:
            t = time.time()
            status.update(state=state, error=error, infra_error=infra, finished_at=now_iso(t),
                          finished_epoch=t, duration_s=round(t - started, 3))
            save()
            log(f"candidate-{state}", id=cid, label=status["label"], build=status["build"],
                source_hash=src_hash[:16], error=error)
            return "published" if state == "published" else "failed"

        log("candidate-testing", id=cid, source_hash=src_hash[:16])
        save()
        if problems:
            return finish("failed", "; ".join(problems[:10]))

        work = self.work_dir / f"{cid}-{src_hash[:16]}"
        server = None
        try:
            # 1. Snapshot (the source directory may be edited while we test).
            if work.exists():
                self._rmtree(work)
            work.mkdir(parents=True)
            snap_dist = work / "dist"
            shutil.copytree(cdir / "dist", snap_dist, symlinks=True)
            shutil.copy2(cdir / "candidate.json", work / "candidate.json")
            snap_hash, snap_problems, _ = hash_tree(snap_dist)
            snap_src = hashlib.sha256(
                f"raft-candidate-v1\0candidate.json\0{hashlib.sha256((work / 'candidate.json').read_bytes()).hexdigest()}"
                f"\0dist\0{snap_hash}".encode()).hexdigest()
            if snap_hash != dist_hash or snap_src != src_hash or snap_problems:
                self.seen.pop(cid, None)  # changed under us: wait for it to settle again
                self._rmtree(work)
                return finish("failed", "candidate changed while snapshotting; will retry when stable", infra=True)
            status["snapshot_hash"] = snap_hash

            # 2. Validate metadata + contents.
            try:
                label, checks = load_candidate_meta(work / "candidate.json")
            except InvalidCandidate as e:
                return finish("failed", str(e))
            status["label"] = label
            status["checks"] = [{"argv": c, "state": "pending"} for c in checks]
            for required in ("index.html", "game.js"):
                if not (snap_dist / required).is_file():
                    return finish("failed", f"candidate dist/{required} missing")
            vj = read_json(snap_dist / "version.json")
            if isinstance(vj, dict):
                status["candidate_build"] = vj.get("build")
            save()

            # 3. Private loopback QA server on the snapshot.
            server = QAServer(self.root, snap_dist, self.qa_port, work)
            try:
                server.start()
            except Exception as e:  # noqa: BLE001 - infra, not candidate's fault
                return finish("failed", f"QA server: {e}", infra=True)

            # 4. Checks, in order; stop at first failure.
            env = dict(os.environ)
            env.update({
                "RAFT_QA_URL": server.url, "RAFT_DIST": str(snap_dist), "RAFT_PORT": str(self.qa_port),
                "RAFT_CANDIDATE_ID": cid, "RAFT_CANDIDATE_LABEL": label, "RAFT_SOURCE_HASH": src_hash,
                "PYTHONDONTWRITEBYTECODE": "1", "UV_OFFLINE": "1",
            })
            env.pop("RAFT_RELEASE_MODE", None)
            all_ok = True
            for i, argv in enumerate(checks):
                rec = status["checks"][i]
                rec.update(self._run_check(argv, env, work, i))
                save()
                if rec["state"] != "passed":
                    all_ok = False
                    for later in status["checks"][i + 1:]:
                        later["state"] = "skipped"
                    break
            server.stop()
            server = None
            if not all_ok:
                bad = next(c for c in status["checks"] if c["state"] not in ("passed", "skipped", "pending"))
                return finish("failed", f"check failed: {' '.join(bad['argv'])} ({bad['state']})")

            # 5. Rehash snapshot: what we publish must be exactly what was tested.
            after, after_problems, _ = hash_tree(snap_dist)
            if after != snap_hash or after_problems:
                return finish("failed", "snapshot changed during checks; refusing to publish")

            # 6. Publish.
            try:
                promote = self._load_promote()
                build = promote(str(snap_dist), label)
            except Exception as e:  # noqa: BLE001
                return finish("failed", f"publish_local.promote failed: {type(e).__name__}: {e}", infra=True)
            live = self._live_build()
            status["build"] = build if isinstance(build, str) else live
            if isinstance(build, str) and live != build:
                return finish("failed", f"promote returned {build} but dist/version.json has {live}", infra=True)
            status["published_at"] = now_iso()
            return finish("published")
        except Transient as e:
            self.seen.pop(cid, None)
            return finish("failed", f"transient file error: {e}", infra=True)
        except Exception as e:  # noqa: BLE001
            return finish("failed", f"queue error: {type(e).__name__}: {e}", infra=True)
        finally:
            if server is not None:
                server.stop()
            if not self.keep_work and work.exists():
                self._rmtree(work)

    def _run_check(self, argv: list[str], env: dict, work: Path, idx: int) -> dict:
        rec = {"state": "running", "exit_code": None, "timed_out": False, "stdout": "", "stderr": "",
               "started_at": now_iso()}
        t0 = time.time()
        try:
            cmd = resolve_program(argv)
        except (OSError, PermissionError) as e:
            rec.update(state="error", stderr=str(e), duration_s=0.0)
            return rec
        out_p, err_p = work / f"check-{idx}.stdout", work / f"check-{idx}.stderr"
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WIN else 0
        # Output to files, not pipes: grandchildren (browsers) holding a pipe can't hang us.
        with open(out_p, "wb") as fo, open(err_p, "wb") as fe:
            try:
                proc = subprocess.Popen(cmd, cwd=str(self.root), env=env, stdin=subprocess.DEVNULL,
                                        stdout=fo, stderr=fe, shell=False, creationflags=flags)
            except OSError as e:
                rec.update(state="error", stderr=f"could not start: {e}", duration_s=0.0)
                return rec
            try:
                code = proc.wait(timeout=self.check_timeout)
            except subprocess.TimeoutExpired:
                kill_tree(proc)
                code = proc.returncode
                rec["timed_out"] = True
        rec["exit_code"] = code
        rec["duration_s"] = round(time.time() - t0, 3)
        rec["stdout"] = truncate(out_p.read_text("utf-8", "replace"))
        rec["stderr"] = truncate(err_p.read_text("utf-8", "replace"))
        rec["state"] = "timeout" if rec["timed_out"] else ("passed" if code == 0 else "failed")
        return rec

    def _load_promote(self):
        spec = importlib.util.spec_from_file_location("publish_local", str(self.root / "publish_local.py"))
        if spec is None or spec.loader is None:
            raise SetupError("cannot load publish_local.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        promote = getattr(mod, "promote", None)
        if not callable(promote):
            raise SetupError("publish_local.promote missing")
        return promote

    def _live_build(self):
        vj = read_json(self.root / "dist" / "version.json")
        return vj.get("build") if isinstance(vj, dict) else None

    def _rmtree(self, path: Path) -> None:
        if not inside(path, self.work_dir) or path.resolve() == self.work_dir.resolve():
            raise RuntimeError(f"refusing to delete outside work dir: {path}")

        def onerr(func, p, _exc):
            try:
                os.chmod(p, stat.S_IWRITE)
                func(p)
            except OSError:
                pass

        for attempt in range(5):
            if sys.version_info >= (3, 12):
                shutil.rmtree(path, onexc=onerr)
            else:
                shutil.rmtree(path, onerror=onerr)
            if not path.exists():
                return
            time.sleep(0.3 * (attempt + 1))  # Windows: handles from just-killed processes

    # ---- modes
    def run_once(self, interval: float) -> int:
        first = self.scan()  # records hashes
        total = dict(first)
        if first["pending"]:
            time.sleep(interval)
            second = self.scan()
            total = {k: first[k] + second[k] for k in first}
            total["pending"] = second["pending"]
        log("once-done", **total)
        if total["failed"]:
            return 1
        if total["pending"]:
            return 4
        return 0

    def run_watch(self, interval: float) -> int:
        log("watching", queue=str(self.queue_dir), qa_port=self.qa_port, interval=interval)
        while True:
            if not self.lock.still_owned():
                log("lock-lost", detail="another process took the lock; exiting")
                return 2
            self.scan()
            time.sleep(interval)


# --------------------------------------------------------------------------- main
def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Little Raft local tested-release queue")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--watch", action="store_true", help="poll the queue until interrupted")
    mode.add_argument("--once", action="store_true", help="process stable ready candidates and exit")
    mode.add_argument("--_serve", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--root", default=str(Path(__file__).resolve().parent), help="project root (default: script dir)")
    p.add_argument("--qa-port", type=int, default=int(os.environ.get("RAFT_QA_PORT", DEFAULT_QA_PORT)))
    p.add_argument("--interval", type=float, default=POLL_SECONDS, help="poll seconds (default 2)")
    p.add_argument("--check-timeout", type=float, default=CHECK_TIMEOUT, help="seconds per check (max 180)")
    p.add_argument("--keep-work", action="store_true", help="keep .releases/work snapshots for debugging")
    p.add_argument("--dist", help=argparse.SUPPRESS)
    p.add_argument("--_parent", default="", help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    root = Path(a.root).resolve()

    if a._serve:
        return serve_main(root, Path(a.dist).resolve(), a.qa_port, a._parent)

    if not (0 < a.check_timeout <= CHECK_TIMEOUT):
        print(f"--check-timeout must be in (0, {CHECK_TIMEOUT:g}]", file=sys.stderr)
        return 3
    if not (0.2 <= a.interval <= 300):
        print("--interval must be 0.2-300 seconds", file=sys.stderr)
        return 3

    q = ReleaseQueue(root, a.qa_port, a.check_timeout, a.keep_work)
    try:
        q.preflight()
    except SetupError as e:
        log("setup-error", error=str(e))
        return 3
    try:
        q.lock.acquire()
    except LockHeld as e:
        log("lock-held", holder=str(e))
        return 2
    try:
        return q.run_once(a.interval) if a.once else q.run_watch(a.interval)
    except KeyboardInterrupt:
        log("stopped")
        return 0
    finally:
        q.lock.release()


if __name__ == "__main__":
    sys.exit(main())
