"""Index PopSign ASL v2.1 (CC BY 4.0) game videos from the official HTTPS directory listing.

Writes a deterministic JSON manifest: one row per published mp4 with split, sign
directory, signer id (4-hex participant prefix), recording timestamp, listed size.
No video bytes are fetched here.
"""
import html, json, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

BASE = "https://signdata.cc.gatech.edu/data/popsign_v2_1/game"
ROW = re.compile(r'href="([^"]+)"[^<]*</a>/?</td><td class="m">([^<]*)</td><td class="s">([^<]*)</td>')
NAME = re.compile(r"^([0-9a-f]{4})-(.+)-(\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}\.\d{3})-(\d+)(?:-done)?\.mp4$")

def get(url):
    # curl is used because Python's http.client intermittently truncated listings through the egress proxy.
    for attempt in range(6):
        r = subprocess.run(["curl", "-sS", "--fail", "-m", "90", "-A", "SignRelay-research-indexer", url], capture_output=True)
        text = r.stdout.decode("utf-8", "replace")
        if r.returncode == 0 and "</html>" in text.lower():
            return text
        time.sleep(2 ** attempt)
    raise RuntimeError(f"listing failed: {url}")

def entries(url):
    return [(html.unescape(a).rstrip("/"), m, s) for a, m, s in ROW.findall(get(url)) if a != "../"]

def size_bytes(s):
    s = s.replace("&nbsp;", "").strip()
    if not s or s == "-": return None
    mult = {"K": 1024, "M": 1024**2, "G": 1024**3}.get(s[-1])
    return int(float(s[:-1]) * mult) if mult else int(float(s))

def main(out):
    jobs = [(split, sign) for split in ("train", "val", "test") for sign, _, _ in entries(f"{BASE}/{split}/")]
    def one(job):
        split, sign = job
        rows = []
        for name, mtime, size in entries(f"{BASE}/{split}/{sign}/"):
            m = NAME.match(name)
            rows.append({"split": split, "sign": sign, "file": name, "signer": m.group(1) if m else None,
                         "recorded": m.group(3) if m else None, "label_in_name": m.group(2) if m else None,
                         "listed_size": size_bytes(size), "url": f"{BASE}/{split}/{sign}/{name}"})
        return rows
    rows = []
    with ThreadPoolExecutor(8) as ex:
        for r in ex.map(one, jobs): rows.extend(r)
    rows.sort(key=lambda r: (r["split"], r["sign"], r["file"]))
    json.dump(rows, open(out, "w"), indent=0)
    print(len(rows), "rows")

if __name__ == "__main__":
    main(sys.argv[1])
