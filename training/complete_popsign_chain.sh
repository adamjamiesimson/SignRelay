#!/usr/bin/env bash
# Build a CA file that lets OpenSSL verify signdata.cc.gatech.edu (PopSign),
# whose server omits its intermediates. Candidate intermediates come from each
# certificate's AIA issuer URL and, when that host is unreachable, from public
# Certificate Transparency logs (crt.sh) by exact issuer name. Nothing is
# trusted unless leaf -> candidates -> a system root verifies.
# Usage: complete_popsign_chain.sh output.pem
set -euo pipefail
out="$1"; host=signdata.cc.gatech.edu
work="$(mktemp -d)"
openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null | openssl x509 > "$work/leaf.pem"
: > "$work/chain.pem"
verifies() { openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$work/chain.pem" "$work/leaf.pem" >/dev/null 2>&1; }
current="$work/leaf.pem"
for level in 1 2 3 4; do
  verifies && break
  issuer_cn="$(openssl x509 -in "$current" -noout -issuer -nameopt multiline | sed -n 's/^ *commonName *= *//p')"
  aia="$(openssl x509 -in "$current" -noout -ext authorityInfoAccess 2>/dev/null | sed -n 's/.*CA Issuers - URI:\(http[^ ]*\).*/\1/p' | head -1)"
  : > "$work/candidates.pem"
  if [ -n "$aia" ] && curl -fsSL --retry 3 --retry-all-errors --max-time 30 -o "$work/aia.bin" "$aia"; then
    { openssl x509 -inform DER -in "$work/aia.bin" 2>/dev/null || openssl x509 -in "$work/aia.bin" 2>/dev/null \
      || openssl pkcs7 -inform DER -in "$work/aia.bin" -print_certs 2>/dev/null || true; } >> "$work/candidates.pem"
  fi
  if ! grep -q "BEGIN CERTIFICATE" "$work/candidates.pem"; then
    echo "AIA unavailable at level $level; looking up '$issuer_cn' in Certificate Transparency logs" >&2
    ids="$(curl -fsSL --retry 5 --retry-all-errors --max-time 60 -G "https://crt.sh/" --data-urlencode "CN=$issuer_cn" --data-urlencode output=json \
      | python3 -c "import json,sys; print(' '.join(str(x['id']) for x in json.load(sys.stdin)[:12]))")"
    for id in $ids; do curl -fsSL --retry 3 --retry-all-errors --max-time 30 "https://crt.sh/?d=$id" >> "$work/candidates.pem" || true; echo >> "$work/candidates.pem"; done
  fi
  grep -q "BEGIN CERTIFICATE" "$work/candidates.pem" || { echo "No candidate issuer for '$issuer_cn'" >&2; exit 1; }
  cat "$work/candidates.pem" >> "$work/chain.pem"
  # Continue from the first candidate whose subject is the issuer we looked for.
  awk '/BEGIN CERT/{n++} {print > ("'"$work"'/cand-" n ".pem")}' "$work/candidates.pem"
  for candidate in "$work"/cand-*.pem; do
    if openssl x509 -in "$candidate" -noout -subject -nameopt multiline 2>/dev/null | grep -q "commonName *= *$issuer_cn\$"; then current="$candidate"; break; fi
  done
  echo "level $level: added candidates for '$issuer_cn'" >&2
done
verifies || { openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$work/chain.pem" "$work/leaf.pem"; exit 1; }
cat /etc/ssl/certs/ca-certificates.crt "$work/chain.pem" > "$out"
echo "Verified chain for $host written to $out"
