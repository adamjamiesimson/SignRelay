#!/usr/bin/env bash
# signdata.cc.gatech.edu (PopSign) serves its leaf certificate without its
# intermediates, so OpenSSL cannot build a chain. Follow each certificate's own
# Authority Information Access "CA Issuers" URL (at most four levels) until
# leaf -> intermediates -> a system root verifies, and only then write a CA file
# containing the system roots plus those intermediates. Verification stays on.
# Usage: complete-ca-chain.sh host output.pem
set -euo pipefail
host="$1"; out="$2"
work="$(mktemp -d)"
openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null | openssl x509 > "$work/leaf.pem"
: > "$work/chain.pem"
current="$work/leaf.pem"
for level in 1 2 3 4; do
  if openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$work/chain.pem" "$work/leaf.pem" >/dev/null 2>&1; then
    break
  fi
  issuer="$(openssl x509 -in "$current" -noout -ext authorityInfoAccess 2>/dev/null | sed -n 's/.*CA Issuers - URI:\(http[^ ]*\).*/\1/p' | head -1)"
  test -n "$issuer" || { echo "No AIA issuer at level $level" >&2; exit 1; }
  curl -fsSL --retry 3 -o "$work/$level.bin" "$issuer"
  # Issuers are served as DER, PEM or a PKCS#7 bundle (.p7c) of cross-signs.
  openssl x509 -inform DER -in "$work/$level.bin" -out "$work/$level.pem" 2>/dev/null \
    || openssl x509 -in "$work/$level.bin" -out "$work/$level.pem" 2>/dev/null \
    || openssl pkcs7 -inform DER -in "$work/$level.bin" -print_certs -out "$work/$level.pem" 2>/dev/null \
    || openssl pkcs7 -in "$work/$level.bin" -print_certs -out "$work/$level.pem"
  grep '^subject=' "$work/$level.pem" || openssl x509 -in "$work/$level.pem" -noout -subject
  cat "$work/$level.pem" >> "$work/chain.pem"
  current="$work/$level.pem"
done
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$work/chain.pem" "$work/leaf.pem"
cat /etc/ssl/certs/ca-certificates.crt "$work/chain.pem" > "$out"
echo "CA file with verified intermediates for $host: $out"
