"""Seekable read-only file over HTTPS byte ranges (curl), for reading single
members of a large remote zip without downloading the whole archive."""
import io, subprocess, time

class RemoteFile(io.RawIOBase):
    def __init__(self, url, size=None, block=1 << 20):
        self.url, self.pos, self.block, self.cache = url, 0, block, {}
        if size is None:
            h = subprocess.run(["curl", "-sSI", "-m", "60", url], capture_output=True, text=True).stdout
            size = int([l.split(":")[1] for l in h.splitlines() if l.lower().startswith("content-length")][-1])
        self.size = size
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def _range(self, a, b):
        for attempt in range(6):
            r = subprocess.run(["curl", "-sS", "--fail", "-m", "300", "-r", f"{a}-{b}", self.url], capture_output=True)
            if r.returncode == 0 and len(r.stdout) == b - a + 1: return r.stdout
            time.sleep(2 ** attempt)
        raise IOError(f"range {a}-{b} failed")
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0: return b""
        if n > 4 * self.block:  # large member read: fetch directly
            data = self._range(self.pos, self.pos + n - 1); self.pos += n; return data
        out = bytearray()
        while n > 0:
            b = self.pos // self.block
            if b not in self.cache:
                if len(self.cache) > 64: self.cache.clear()
                a = b * self.block
                self.cache[b] = self._range(a, min(self.size, a + self.block) - 1)
            chunk = self.cache[b][self.pos - b * self.block:][:n]
            out += chunk; self.pos += len(chunk); n -= len(chunk)
        return bytes(out)
    def readinto(self, buf):
        d = self.read(len(buf)); buf[:len(d)] = d; return len(d)
