"""Shared helpers for the tests/e2e tools: a quiet static server and a Chromium launcher.

Chromium is launched without channel='chrome' and with --use-angle=swiftshader so WebGL works
on GPU-less cloud machines. If the Playwright-managed browser is missing (download blocked),
it falls back to $RAFT_CHROMIUM or the preinstalled /opt/pw-browsers/chromium.

Exit-code contract shared by every tool: 0 = pass, 1 = a game invariant/budget failed,
2 = the harness itself could not run (infra). Each tool prints one JSON object on stdout last.
"""
import functools, http.server, os, socketserver, threading
from pathlib import Path

CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
FALLBACK_EXES = [os.environ.get('RAFT_CHROMIUM'), '/opt/pw-browsers/chromium']


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class StaticServer:
    """Serve a dist folder on 127.0.0.1 with an ephemeral port. Use as a context manager."""

    def __init__(self, directory, port=0):
        self.directory = str(Path(directory).resolve())
        socketserver.ThreadingTCPServer.allow_reuse_address = True
        socketserver.ThreadingTCPServer.daemon_threads = True
        self.srv = socketserver.ThreadingTCPServer(('127.0.0.1', port), functools.partial(_Quiet, directory=self.directory))
        self.port = self.srv.server_address[1]
        self.url = f'http://127.0.0.1:{self.port}/'

    def __enter__(self):
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.srv.shutdown()
        self.srv.server_close()


def launch_chromium(p, headless=True, extra_args=()):
    """Launch Chromium via a sync_playwright() handle `p`."""
    args = CHROMIUM_ARGS + list(extra_args)
    try:
        return p.chromium.launch(headless=headless, args=args)
    except Exception as first:
        for exe in FALLBACK_EXES:
            if exe and Path(exe).exists():
                return p.chromium.launch(headless=headless, args=args, executable_path=exe)
        raise first
