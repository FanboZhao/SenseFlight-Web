"""Preview the presentation locally with video byte-range support."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent / 'dist'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.remaining = None
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        file = Path(self.translate_path(self.path))
        if not file.is_file():
            if file.is_dir():
                file = file / 'index.html'
            if not file.is_file():
                self.send_error(404)
                return None
        stream = file.open('rb')
        size = file.stat().st_size
        start, end = 0, size - 1
        request_range = self.headers.get('Range')
        if request_range:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', request_range)
            if not match or not any(match.groups()):
                stream.close(); self.send_error(416); return None
            left, right = match.groups()
            if left:
                start = int(left)
                if right: end = min(int(right), end)
            else:
                start = max(0, size - int(right))
            if start > end or start >= size:
                stream.close(); self.send_error(416); return None
        self.send_response(206 if request_range else 200)
        self.send_header('Content-Type', self.guess_type(str(file)))
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-store')
        if request_range:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        stream.seek(start)
        self.remaining = end - start + 1
        return stream

    def copyfile(self, source, output):
        try:
            while self.remaining:
                chunk = source.read(min(65536, self.remaining))
                if not chunk: break
                output.write(chunk)
                self.remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_request(self, *args):
        pass

if __name__ == '__main__':
    print('SenseFlight preview: http://127.0.0.1:8091/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8091), Handler).serve_forever()
