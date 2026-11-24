"""Fetch selected landmark clips out of the ISLR competition bundle without downloading the bundle.

The competition's `download-all` archive is ~40 GB. On a laptop that is either too large to store or
too slow to stream just to keep a few signers' folders, but the download supports HTTP range requests,
and a zip is random-access by design: the central directory at the end lists every member and where
its bytes live. So this reads the directory, then fetches only the byte ranges of the members that
were asked for — a few signers of 250-sign data instead of the whole corpus.

  python fetch_islr_subset.py --signers 49445 61333 36257 --out ~/data/islr
  python fetch_islr_subset.py --from-csv ~/data/islr/train.csv --signers 49445 --out ~/data/islr --limit 200

Authentication uses ~/.kaggle/kaggle.json, the same file the Kaggle CLI reads. The competition rules
must have been accepted on the website, otherwise the server answers 403.
"""
import argparse, json, os, struct, sys, time, urllib.error, urllib.request, zlib

API = "https://www.kaggle.com/api/v1/competitions/data/download-all"
URL = f"{API}/asl-signs"
EOCD, ZIP64_LOCATOR, ZIP64_EOCD, CENTRAL = 0x06054B50, 0x07064B50, 0x06064B50, 0x02014B50


def credentials(path=None):
    path = path or os.path.expanduser("~/.kaggle/kaggle.json")
    data = json.load(open(path))
    return data["username"], data["key"]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The API answers with a 302 to a pre-signed URL, and that URL rejects our Authorization header.
    Following it automatically would forward the Kaggle credentials and earn a 404, so the redirect is
    handled by hand: the Location is re-requested with the Range header only."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


# Kaggle's edge answers the default Python user agent with 404 on this endpoint and the curl one with
# 302, so the user agent is part of the contract rather than decoration.
USER_AGENT = "SignRelay-ISLR-fetch/1.0 (+https://github.com/friendlyfoe241-cyber/SignRelay)"


def request(auth, start=None, end=None):
    headers = {"User-Agent": USER_AGENT}
    if start is not None:
        headers["Range"] = f"bytes={start}-{end if end is not None else ''}"
    import base64
    token = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
    req = urllib.request.Request(URL, headers={**headers, "Authorization": f"Basic {token}"})
    try:
        return _OPENER.open(req, timeout=120)
    except urllib.error.HTTPError as error:
        if error.code in (301, 302, 303, 307, 308):
            location = error.headers.get("Location")
            error.close()
            if not location:
                raise SystemExit("redirect without a Location header")
            follow = urllib.request.Request(location, headers={**headers, "User-Agent": USER_AGENT})
            return urllib.request.urlopen(follow, timeout=300)
        raise SystemExit(f"HTTP {error.code} — accept the competition rules at "
                         f"https://www.kaggle.com/competitions/asl-signs/rules first") from None


def archive_size(auth):
    with request(auth, 0, 0) as response:
        return int(response.headers["Content-Range"].split("/")[1])


def read_range(auth, start, end, attempts=5):
    """Range reads reset under parallel load; a retry is normal here rather than an error path."""
    last = None
    for attempt in range(attempts):
        try:
            with request(auth, start, end) as response:
                return response.read()
        except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
            last = error
            time.sleep(min(8.0, 0.4 * (2 ** attempt)))
    raise SystemExit(f"range read {start}-{end} failed after {attempts} attempts: {last}")


def central_directory(auth, size):
    """Locate and parse the zip central directory, including the ZIP64 form a 40 GB archive uses."""
    tail = read_range(auth, max(0, size - 65536), size - 1)
    index = tail.rfind(struct.pack("<I", EOCD))
    if index < 0:
        raise SystemExit("no end-of-central-directory record found; the download may be gated")
    entries, directory_size, directory_offset = struct.unpack("<HII", tail[index + 10:index + 20])
    if entries == 0xFFFF or directory_size == 0xFFFFFFFF or directory_offset == 0xFFFFFFFF:
        locator = tail.rfind(struct.pack("<I", ZIP64_LOCATOR))
        if locator < 0:
            raise SystemExit("zip64 archive without a zip64 locator")
        zip64_offset = struct.unpack("<Q", tail[locator + 8:locator + 16])[0]
        record = read_range(auth, zip64_offset, zip64_offset + 55)
        if struct.unpack("<I", record[:4])[0] != ZIP64_EOCD:
            raise SystemExit("zip64 end-of-central-directory record not found")
        entries = struct.unpack("<Q", record[32:40])[0]
        directory_size = struct.unpack("<Q", record[40:48])[0]
        directory_offset = struct.unpack("<Q", record[48:56])[0]
    directory = read_range(auth, directory_offset, directory_offset + directory_size - 1)
    members, cursor = {}, 0
    while cursor + 46 <= len(directory) and struct.unpack("<I", directory[cursor:cursor + 4])[0] == CENTRAL:
        record = directory[cursor:cursor + 46]
        flags, = struct.unpack_from("<H", record, 8)
        method, = struct.unpack_from("<H", record, 10)
        compressed, uncompressed = struct.unpack_from("<II", record, 20)
        name_length, extra_length, comment_length = struct.unpack_from("<HHH", record, 28)
        local_offset, = struct.unpack_from("<I", record, 42)
        name = directory[cursor + 46:cursor + 46 + name_length].decode("utf-8", "replace")
        extra = directory[cursor + 46 + name_length:cursor + 46 + name_length + extra_length]
        if 0xFFFFFFFF in (compressed, uncompressed, local_offset):
            # ZIP64 extended information: values appear in a fixed order, only for the fields that
            # overflowed, so they must be consumed in sequence rather than indexed by name.
            position, values = 0, []
            while position + 4 <= len(extra):
                tag, length = struct.unpack("<HH", extra[position:position + 4])
                if tag == 0x0001:
                    data = extra[position + 4:position + 4 + length]
                    for slot in range(0, len(data) - 7, 8):
                        values.append(struct.unpack("<Q", data[slot:slot + 8])[0])
                    break
                position += 4 + length
            if uncompressed == 0xFFFFFFFF and values: uncompressed = values.pop(0)
            if compressed == 0xFFFFFFFF and values: compressed = values.pop(0)
            if local_offset == 0xFFFFFFFF and values: local_offset = values.pop(0)
        members[name] = {"method": method, "compressed": compressed, "size": uncompressed,
                         "offset": local_offset, "flags": flags}
        cursor += 46 + name_length + extra_length + comment_length
    return members


def fetch_member(auth, member, path, attempts=4):
    """Read one member by its local header and write the decompressed bytes to `path`."""
    last = None
    for attempt in range(attempts):
        try:
            return _fetch_member_once(auth, member, path)
        except Exception as error:  # resets are common under parallel load; retry rather than fail the run
            last = error
            time.sleep(0.5 * (2 ** attempt))
    raise SystemExit(f"could not fetch {path}: {last}")


def _fetch_member_once(auth, member, path):
    head = read_range(auth, member["offset"], member["offset"] + 30)
    if struct.unpack("<I", head[:4])[0] != 0x04034B50:
        raise SystemExit(f"bad local header for {path}")
    name_length, extra_length = struct.unpack("<HH", head[26:30])
    start = member["offset"] + 30 + name_length + extra_length
    payload = read_range(auth, start, start + member["compressed"] - 1)
    if member["method"] == 8:
        payload = zlib.decompress(payload, -15)
    elif member["method"] != 0:
        raise SystemExit(f"unsupported compression method {member['method']} for {path}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(payload)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--signers", nargs="+", required=True, help="participant ids to fetch")
    parser.add_argument("--out", default=os.path.expanduser("~/data/islr"))
    parser.add_argument("--limit", type=int, default=0, help="fetch at most this many clips in total")
    parser.add_argument("--csv", default=None, help="train.csv, so clips can be chosen per sign rather than by name")
    parser.add_argument("--per-class", type=int, default=0,
                        help="with --csv: at most this many clips of each sign per signer")
    parser.add_argument("--workers", type=int, default=6, help="parallel downloads")
    parser.add_argument("--signs", nargs="*", default=None, help="only these sign labels (e.g. hello water)")
    parser.add_argument("--list", action="store_true", help="list matching members and stop")
    args = parser.parse_args()

    auth = credentials()
    size = archive_size(auth)
    print(f"archive {size / 1e9:.1f} GB, reading central directory")
    members = central_directory(auth, size)
    print(f"{len(members)} members")

    sign_of = {}
    if args.csv:
        import csv
        with open(args.csv, newline="") as handle:
            for row in csv.DictReader(handle):
                sign_of[(row["participant_id"], row["sequence_id"])] = row["sign"]

    wanted = []
    for name in members:
        parts = name.split("/")
        if len(parts) != 3 or parts[0] != "train_landmark_files" or parts[1] not in args.signers:
            continue
        if args.per_class and args.csv:
            sequence = parts[2].replace(".parquet", "")
            if (parts[1], sequence) not in sign_of:
                continue
        wanted.append(name)
    wanted.sort()
    if args.per_class and args.csv:
        # Balanced rather than alphabetical: a sign with many recordings would otherwise fill the quota
        # on its own and leave the rest of the vocabulary unrepresented.
        per, kept = {}, []
        for name in wanted:
            parts = name.split("/")
            key = (parts[1], sign_of[(parts[1], parts[2].replace(".parquet", ""))])
            if per.get(key, 0) >= args.per_class:
                continue
            per[key] = per.get(key, 0) + 1
            kept.append(name)
        wanted = kept
        print(f"{len(per)} (signer, sign) pairs kept, {len(wanted)} clips")
    if args.limit:
        wanted = wanted[:args.limit]
    print(f"{len(wanted)} clips for signers {', '.join(args.signers)}")
    if args.list:
        for name in wanted[:20]:
            print("  ", name, members[name]["size"], "bytes")
        return
    todo = []
    skipped = 0
    for name in wanted:
        path = os.path.join(args.out, name)
        if os.path.exists(path) and os.path.getsize(path) == members[name]["size"]:
            skipped += 1
            continue
        todo.append(name)
    print(f"fetching {len(todo)} clips, {skipped} already present")
    started = time.time()
    done = [0]
    from concurrent.futures import ThreadPoolExecutor

    def work(name):
        fetch_member(auth, members[name], os.path.join(args.out, name))
        done[0] += 1
        if done[0] % 200 == 0:
            elapsed = time.time() - started
            print(f"  {done[0]}/{len(todo)} clips, {elapsed / 60:.1f} min, {done[0] / elapsed:.1f}/s", flush=True)

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        list(pool.map(work, todo))
    print(f"fetched {done[0]}, already present {skipped}, in {(time.time() - started) / 60:.1f} min")


if __name__ == "__main__":
    main()
