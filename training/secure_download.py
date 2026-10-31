"""Bounded, verified HTTPS reads for the official PopSign source.

Frozen fingerprints authenticate reviewed bytes. Hashes of newly sampled clips
are recorded provenance, not a claim that an unfrozen dataset is immutable.
"""
from __future__ import annotations

import hashlib
import http.client
import os
import re
import ssl
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

HOST = "signdata.cc.gatech.edu"
MAX_BYTES = 100 * 1024 * 1024
ATTEMPTS, TIMEOUT, ATTEMPT_SECONDS = 3, 20, 60


class ExternalDataError(RuntimeError):
    """The upstream source or configured trust cannot supply valid data."""


def official_url(url: str) -> None:
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != HOST or parsed.port not in (None, 443)
            or parsed.username or parsed.password or parsed.fragment):
        raise ValueError("Only HTTPS on the reviewed official PopSign host is supported")


class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        official_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def get(url: str, start: int | None = None, size: int | None = None,
        *, sha256: str | None = None) -> bytes:
    official_url(url)
    if start is not None and (type(start) is not int or start < 0 or type(size) is not int or not 0 < size <= MAX_BYTES):
        raise ValueError("Invalid source byte range")
    if start is None and size is not None:
        raise ValueError("A range size requires an offset")
    if sha256 is not None and not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("Expected a frozen SHA-256 fingerprint")
    limit = size if start is not None else 2 * 1024 * 1024
    try:
        context = ssl.create_default_context()
    except (OSError, ssl.SSLError) as error:
        raise ExternalDataError(f"Cannot load runner CA configuration: {error}") from error
    opener = build_opener(OfficialRedirect(), HTTPSHandler(context=context))
    headers = {"User-Agent": "SignRelay/1.0 (CC BY 4.0 PopSign evaluation)", "Accept-Encoding": "identity"}
    if start is not None:
        headers["Range"] = f"bytes={start}-{start + size - 1}"
    for attempt in range(ATTEMPTS):
        try:
            deadline = time.monotonic() + ATTEMPT_SECONDS
            with opener.open(Request(url, headers=headers), timeout=TIMEOUT) as response:
                official_url(response.geturl())
                if response.headers.get("Content-Encoding", "identity") != "identity":
                    raise ValueError("Encoded source responses are not byte-addressable")
                if start is not None:
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                    if (response.status != 206 or not match
                            or tuple(map(int, match.group(1, 2))) != (start, start + size - 1)
                            or int(match[3]) < start + size):
                        raise ValueError("Source must return the exact requested Content-Range with status 206")
                elif response.status != 200:
                    raise ValueError("Source listing must return status 200")
                length = response.headers.get("Content-Length")
                if length is not None and (int(length) > limit or (start is not None and int(length) != size)):
                    raise ValueError("Source Content-Length differs from the allowed size")
                chunks, count = [], 0
                while True:
                    if time.monotonic() > deadline:
                        raise TimeoutError("Source exceeded the per-attempt download deadline")
                    # read1 performs at most one socket read. read(n) could keep
                    # waiting for n bytes while a slow peer resets its timeout.
                    chunk = response.read1(min(64 * 1024, limit + 1 - count))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    count += len(chunk)
                    if count > limit:
                        raise ValueError("Source exceeded the allowed response size")
                data = b"".join(chunks)
                if start is not None and len(data) != size:
                    raise http.client.IncompleteRead(data, size - len(data))
                if sha256 is not None and hashlib.sha256(data).hexdigest() != sha256:
                    raise ValueError("Clip SHA-256 differs from the frozen manifest; refusing source bytes")
                return data
        except (URLError, OSError, http.client.HTTPException) as error:
            reason = getattr(error, "reason", error)
            if isinstance(reason, ssl.SSLCertVerificationError):
                trust = os.environ.get("SSL_CERT_FILE", "system roots")
                raise ExternalDataError(
                    f"TLS verification failed for {HOST}: {reason}; CA source: {trust}. "
                    "No data accepted. Repair the upstream chain or provide a verified CA bundle; "
                    "frozen clips can be recovered from a local --clip-cache. Repeated retries cannot repair trust."
                ) from error
            if isinstance(error, HTTPError) and error.code not in (408, 429, 500, 502, 503, 504):
                raise ExternalDataError(f"Official PopSign source returned HTTP {error.code}; no fallback source used") from error
            if attempt + 1 == ATTEMPTS:
                raise ExternalDataError(
                    f"Official PopSign source unavailable after {ATTEMPTS} attempts "
                    f"(socket timeout {TIMEOUT}s, attempt deadline {ATTEMPT_SECONDS}s): {reason}"
                ) from error
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")
