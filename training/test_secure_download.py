import hashlib
import io
import json
import os
from pathlib import Path
import ssl
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

import secure_download as download
from fetch_evaluation_clips import fetch

URL = "https://signdata.cc.gatech.edu/data/popsign_v1_0/game/test/hello.tar"
DATA = b"licensed frozen clip bytes"
DIGEST = hashlib.sha256(DATA).hexdigest()


class Response(io.BytesIO):
    def __init__(self, data=DATA, *, status=206, content_range=None, length=None, url=URL):
        super().__init__(data)
        self.status, self.url = status, url
        self.headers = {"Content-Range": content_range or f"bytes 10-{9+len(DATA)}/1000",
                        "Content-Length": str(len(DATA) if length is None else length)}

    def geturl(self):
        return self.url


class SecureDownloadTests(unittest.TestCase):
    def run_get(self, responses):
        opener = Mock()
        opener.open.side_effect = responses
        with patch.object(download, "build_opener", return_value=opener), patch.object(download.time, "sleep"):
            result = download.get(URL, 10, len(DATA), sha256=DIGEST)
        return result, opener

    def test_exact_range_and_checksum(self):
        data, opener = self.run_get([Response()])
        self.assertEqual(data, DATA)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.headers["Range"], f"bytes=10-{9+len(DATA)}")
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 20)

    def test_default_context_requires_hostname_and_trust(self):
        with patch.object(download, "build_opener", return_value=Mock(open=Mock(return_value=Response()))) as build:
            download.get(URL, 10, len(DATA))
        context = build.call_args.args[1]._context
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_tls_errors_fail_without_retries(self):
        opener = Mock(open=Mock(side_effect=URLError(ssl.SSLCertVerificationError(1, "missing issuer"))))
        with patch.object(download, "build_opener", return_value=opener), patch.object(download.time, "sleep") as sleep:
            with self.assertRaisesRegex(download.ExternalDataError, "TLS verification failed.*No data accepted"):
                download.get(URL, 10, len(DATA))
        self.assertEqual(opener.open.call_count, 1)
        sleep.assert_not_called()

    def test_transient_resets_recover(self):
        data, opener = self.run_get([URLError(ConnectionResetError()), Response()])
        self.assertEqual(data, DATA)
        self.assertEqual(opener.open.call_count, 2)

    def test_transport_retries_bounded(self):
        opener = Mock(open=Mock(side_effect=URLError(TimeoutError())))
        with patch.object(download, "build_opener", return_value=opener), patch.object(download.time, "sleep"):
            with self.assertRaisesRegex(download.ExternalDataError, "after 3 attempts"):
                download.get(URL, 10, len(DATA))
        self.assertEqual(opener.open.call_count, 3)

    def test_reject_bad_range_length_bytes_or_redirect(self):
        cases = [Response(status=200), Response(content_range="bytes 11-35/1000"),
                 Response(length=len(DATA)+1), Response(data=b"x" * len(DATA)),
                 Response(url="http://signdata.cc.gatech.edu/"), Response(data=DATA+b"x")]
        for response in cases:
            with self.subTest(response=response), self.assertRaises(ValueError):
                self.run_get([response])

    def test_truncated_response_retries_then_fails(self):
        with self.assertRaises(download.ExternalDataError):
            self.run_get([Response(data=DATA[:-1]) for _ in range(3)])

    def test_http_404_does_not_retry(self):
        with self.assertRaisesRegex(download.ExternalDataError, "HTTP 404"):
            self.run_get([HTTPError(URL, 404, "missing", {}, None)])

    def test_reject_insecure_foreign_or_invalid_sources_before_network(self):
        for url in ("http://signdata.cc.gatech.edu/", "https://other.invalid/", "https://user@signdata.cc.gatech.edu/"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                download.get(url)
        for start, size in ((-1, 1), (0, 0), (0, download.MAX_BYTES+1)):
            with self.assertRaises(ValueError):
                download.get(URL, start, size)

    def test_redirect_handler_rejects_downgrade(self):
        with self.assertRaises(ValueError):
            download.OfficialRedirect().redirect_request(None, None, 302, "", {}, "http://signdata.cc.gatech.edu/")


class FrozenRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cwd = Path.cwd()
        os.chdir(self.temp.name)
        self.row = {"trial_id": "existing-development", "file": "evaluation/videos/clip.mp4", "license": "CC BY 4.0",
                    "source": URL, "archive_offset": 10, "bytes": len(DATA), "recording_sha256": DIGEST}
        Path("lock.json").write_text(json.dumps({"manifests": []}))
        self.cache = Path("private-cache")
        self.cache.mkdir()

    def tearDown(self):
        os.chdir(self.cwd)
        self.temp.cleanup()

    def run_fetch(self):
        Path("manifest.json").write_text(json.dumps([self.row]))
        fetch(Path("manifest.json"), Path("lock.json"), clip_cache=self.cache)

    def test_recovery_checks_frozen_bytes_and_never_contacts_network(self):
        (self.cache / f"{DIGEST}.mp4").write_bytes(DATA)
        with patch("fetch_evaluation_clips.get") as get:
            self.run_fetch()
        get.assert_not_called()
        self.assertEqual(Path(self.row["file"]).read_bytes(), DATA)

    def test_corrupt_cache_refused_without_output(self):
        (self.cache / f"{DIGEST}.mp4").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "frozen size/SHA-256"):
            self.run_fetch()
        self.assertFalse(Path(self.row["file"]).exists())

    def test_sealed_fingerprints_block_renamed_manifest_even_with_cache(self):
        Path("sealed.json").write_text(json.dumps([self.row]))
        Path("lock.json").write_text(json.dumps({"manifests": [{"role": "sealed-holdout", "file": "sealed.json"}]}))
        with self.assertRaisesRegex(ValueError, "sealed holdout"):
            self.run_fetch()

    def test_license_and_containment_preserved(self):
        self.row["license"] = "unknown"
        with self.assertRaisesRegex(ValueError, "license"):
            self.run_fetch()
        self.row["license"] = "CC BY 4.0"
        self.row["file"] = "evaluation/videos/../../elsewhere.mp4"
        with self.assertRaisesRegex(ValueError, "stay in"):
            self.run_fetch()


if __name__ == "__main__":
    unittest.main()
