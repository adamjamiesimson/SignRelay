"""Download pinned SWL-LSE files using bounded, resumable HTTP ranges."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from http.client import IncompleteRead
from pathlib import Path
import time
import shutil
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


def download_parallel(path, size, md5, urls, *, chunk_bytes=32 * 1024 * 1024, workers=3):
    """Bounded range transfers with durable chunk files and atomic assembly.

    Reuses the earlier sequential prefix. A cancelled process retains verified
    length/range chunks; the publisher checksum still gates the assembled file.
    """
    if size <= 0 or chunk_bytes <= 0 or not urls or not 1 <= workers <= 4:
        raise ValueError("Positive sizes, URLs and 1–4 workers required")
    if matches(path, size, md5):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    if partial.exists() and partial.stat().st_size > size:
        partial.unlink()
    offset = partial.stat().st_size if partial.exists() else 0
    parts = path.with_name(path.name + f".{md5}.ranges")
    parts.mkdir(exist_ok=True)
    ranges = [(start, min(start + chunk_bytes, size) - 1) for start in range(offset, size, chunk_bytes)]

    def transfer(start, end):
        destination = parts / f"{start}-{end}"
        count = end - start + 1
        if destination.is_file() and destination.stat().st_size == count:
            return count
        pending = destination.with_suffix(".pending")
        try:
            for attempt in range(6):
                request = urllib.request.Request(urls[attempt % len(urls)], headers={"Range": f"bytes={start}-{end}"})
                try:
                    with urllib.request.urlopen(request, timeout=45) as response:
                        if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{size}":
                            raise ValueError("Wrong or ignored byte range")
                        chunk = response.read(count + 1)
                        if len(chunk) != count:
                            raise ValueError("Incomplete or oversized range")
                    pending.write_bytes(chunk)
                    pending.replace(destination)
                    return count
                except (OSError, ValueError, IncompleteRead) as error:
                    if attempt == 5:
                        raise RuntimeError(f"Download failed at byte {start}: {path.name}") from error
                    print(f"Retry {attempt + 1}: {path.name} bytes {start}-{end}: {type(error).__name__}", flush=True)
                    time.sleep(min(2 ** attempt, 16))
        finally:
            pending.unlink(missing_ok=True)

    pool = ThreadPoolExecutor(max_workers=workers)
    futures = [pool.submit(transfer, start, end) for start, end in ranges]
    try:
        completed = offset
        for future in as_completed(futures):
            completed += future.result()
            print(f"{path.name}: {completed}/{size} bytes cached", flush=True)
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    assembled = path.with_name(path.name + ".assembling")
    try:
        with assembled.open("wb") as destination:
            if offset:
                with partial.open("rb") as source:
                    shutil.copyfileobj(source, destination)
            for start, end in ranges:
                with (parts / f"{start}-{end}").open("rb") as source:
                    shutil.copyfileobj(source, destination)
        if not matches(assembled, size, md5):
            partial.unlink(missing_ok=True)
            shutil.rmtree(parts)
            raise ValueError(f"Published checksum mismatch: {path.name}; discarded corrupt cache")
        assembled.replace(path)
        partial.unlink(missing_ok=True)
        shutil.rmtree(parts)
    finally:
        assembled.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=3)
    args = parser.parse_args()
    for name, (size, digest) in FILES.items():
        downloader = download_parallel if size > 32 * 1024 * 1024 else download
        options = {"workers": args.workers} if downloader is download_parallel else {}
        downloader(args.directory / name, size, digest, [
            f"https://zenodo.org/api/records/13691887/files/{name}/content",
            f"https://zenodo.org/records/13691887/files/{name}?download=1",
        ], **options)
