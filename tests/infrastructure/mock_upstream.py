#!/usr/bin/env python3
"""Minimal HTTP server for Nginx routing tests.

Usage:
    python mock_upstream.py <service_name> <port>

Examples:
    python mock_upstream.py backend 8000
    python mock_upstream.py frontend 3000
"""
import json
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

SERVICE_NAME = sys.argv[1] if len(sys.argv) > 1 else "unknown"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8080


class Handler(BaseHTTPRequestHandler):
    """Mock upstream handler that echoes request details as JSON."""

    def _build_response(self, method):
        """Build a standard JSON response with request metadata."""
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        parsed = urlparse(self.path)
        response = {
            "service": SERVICE_NAME,
            "path": self.path,
            "uri": parsed.path,
            "query": parse_qs(parsed.query),
            "method": method,
            "headers": dict(self.headers),
            "timestamp": time.time(),
        }
        if body:
            try:
                response["body"] = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                response["body_length"] = len(body)

        return response

    def _send_json(self, status_code, data):
        """Send a JSON response."""
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Mock-Service", SERVICE_NAME)
        self.end_headers()
        self.wfile.write(payload)

    def _handle_special_paths(self):
        """Handle special test endpoints. Returns True if handled."""
        parsed = urlparse(self.path)
        path = parsed.path

        # Slow endpoint for timeout testing
        if path == "/slow":
            params = parse_qs(parsed.query)
            delay = float(params.get("delay", ["5"])[0])
            time.sleep(delay)
            self._send_json(200, {"service": SERVICE_NAME, "delayed": delay})
            return True

        # Error endpoint for 5xx testing
        if path == "/error":
            params = parse_qs(parsed.query)
            code = int(params.get("code", ["500"])[0])
            self._send_json(code, {"service": SERVICE_NAME, "error": True, "code": code})
            return True

        # Large response for buffer testing
        if path == "/large":
            params = parse_qs(parsed.query)
            size_kb = int(params.get("size", ["100"])[0])
            data = {"service": SERVICE_NAME, "data": "x" * (size_kb * 1024)}
            self._send_json(200, data)
            return True

        return False

    def do_GET(self):
        if self._handle_special_paths():
            return
        self._send_json(200, self._build_response("GET"))

    def do_POST(self):
        if self._handle_special_paths():
            return
        self._send_json(200, self._build_response("POST"))

    def do_PUT(self):
        if self._handle_special_paths():
            return
        self._send_json(200, self._build_response("PUT"))

    def do_DELETE(self):
        if self._handle_special_paths():
            return
        self._send_json(200, self._build_response("DELETE"))

    def do_PATCH(self):
        if self._handle_special_paths():
            return
        self._send_json(200, self._build_response("PATCH"))

    def do_OPTIONS(self):
        self._send_json(200, self._build_response("OPTIONS"))

    def do_HEAD(self):
        """HEAD returns headers only (no body)."""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Mock-Service", SERVICE_NAME)
        self.end_headers()

    def log_message(self, format, *args):
        """Suppress default logging to keep test output clean."""
        pass


def main():
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        sys.exit(0)

    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Mock {SERVICE_NAME} listening on :{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\nMock {SERVICE_NAME} shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
