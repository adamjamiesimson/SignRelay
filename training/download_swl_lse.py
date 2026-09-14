"""Download pinned SWL-LSE files using bounded, resumable HTTP ranges."""
import argparse
import hashlib
from http.client import IncompleteRead
from pathlib import Path
import time
import urllib.request

FILES = {
    "MEDIAPIPE.zip": (3499865422, "e128df76232e0c7dcd7a74935cd38335"),
    "ANNOTATIONS.zip": (62423, "b235d2e43b8ef0f9e83e6f485cd8e68e"),
    "videos_ref_annotations.csv": (9820, "2df5f818fe6550f60abf8af2edaea2c1"),
}


def matches(path, size, md5):
    if not path.is_file() or path.stat().st_size != size:
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "md5").hexdigest() == md5


def download(path, size, md5, urls, *, chunk_bytes=32 * 1024 * 1024):
    if size <= 0 or chunk_bytes <= 0 or not urls:
        raise ValueError("Positive sizes and source URLs required")
    if matches(path, size, md5):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    if partial.exists() and partial.stat().st_size > size:
        partial.unlink()
    offset = partial.stat().st_size if partial.exists() else 0
    next_progress = offset
    while offset < size:
        end = min(offset + chunk_bytes, size) - 1
        count = end - offset + 1
        for attempt in range(6):
            request = urllib.request.Request(urls[attempt % len(urls)], headers={"Range": f"bytes={offset}-{end}"})
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    if response.status == 206:
                        if response.headers.get("Content-Range") != f"bytes {offset}-{end}/{size}":
                            raise ValueError("Wrong byte range")
                    elif response.status != 200 or offset != 0 or count != size:
                        raise ValueError("Server ignored bounded range")
                    chunk = response.read(count + 1)
                    if len(chunk) != count:
                        raise ValueError("Incomplete or oversized range")
                # Interrupted requests never append partially received chunks.
                with partial.open("ab") as stream:
                    stream.write(chunk)
                offset += count
                break
            except (OSError, ValueError, IncompleteRead) as error:
                if attempt == 5:
                    raise RuntimeError(f"Download failed at byte {offset}: {path.name}") from error
                time.sleep(min(2 ** attempt, 16))
        if offset >= next_progress or offset == size:
            print(f"{path.name}: {offset}/{size} bytes", flush=True)
            next_progress = offset + 256 * 1024 * 1024
    if not matches(partial, size, md5):
        partial.unlink(missing_ok=True)
        raise ValueError(f"Published checksum mismatch: {path.name}; discarded partial file")
    partial.replace(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    for name, (size, digest) in FILES.items():
        download(args.directory / name, size, digest, [
            f"https://zenodo.org/api/records/13691887/files/{name}/content",
            f"https://zenodo.org/records/13691887/files/{name}?download=1",
        ])
