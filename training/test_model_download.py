import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from download_swl_lse import download, download_parallel
from export_ksl_onnx import ordered_labels


class ModelContractTests(unittest.TestCase):
    def test_labels_preserve_numeric_order(self):
        self.assertEqual(ordered_labels({"가": 1, "나": 0}), ["나", "가"])
        for labels in ({"a": 1}, {"a": 0, "b": 0}, {"a": False}, {" ": 0}):
            with self.assertRaises(ValueError):
                ordered_labels(labels)

    def test_resume_and_corruption(self):
        data = b"actual model bytes, not an error page"
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                start, end = map(int, self.headers["Range"].removeprefix("bytes=").split("-"))
                requests.append((start, end)); chunk = data[start:end + 1]
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
                self.send_header("Content-Length", str(len(chunk)))
                self.end_headers(); self.wfile.write(chunk)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "model.bin"
                partial = path.with_name("model.bin.partial"); partial.write_bytes(data[:8])
                digest = hashlib.md5(data).hexdigest()
                url = f"http://127.0.0.1:{server.server_port}/model"
                download(path, len(data), digest, [url], chunk_bytes=8)
                self.assertEqual(min(requests), (8, 15)); self.assertEqual(path.read_bytes(), data)
                self.assertFalse(partial.exists())
                count = len(requests)
                download(path, len(data), digest, [url], chunk_bytes=8)
                self.assertEqual(len(requests), count)
                path.unlink(); partial.write_bytes(b"wrong!!!")
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    download(path, len(data), digest, [url], chunk_bytes=8)
                self.assertFalse(path.exists()); self.assertFalse(partial.exists())
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_parallel_resume_and_corruption(self):
        with patch.dict(globals(), {"download": download_parallel}):
            self.test_resume_and_corruption()

    def test_ignored_or_wrong_ranges_never_append(self):
        for status, header in [(200, None), (206, "bytes 0-7/16")]:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "model.bin"
                partial = path.with_name("model.bin.partial"); partial.write_bytes(b"prefix00")
                with patch("download_swl_lse.urllib.request.urlopen") as open_url, patch("download_swl_lse.time.sleep"):
                    response = open_url.return_value.__enter__.return_value
                    response.status = status; response.headers = {"Content-Range": header}
                    with self.assertRaises(RuntimeError):
                        download(path, 16, "unused", ["https://example.test"], chunk_bytes=8)
                self.assertEqual(partial.read_bytes(), b"prefix00")


if __name__ == "__main__":
    unittest.main()
