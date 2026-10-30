#!/usr/bin/env bash
# signdata.cc.gatech.edu (PopSign) serves its leaf certificate without the
# intermediate, so OpenSSL cannot build a chain. Fetch the intermediate from the
# leaf's own Authority Information Access URL, require that leaf -> intermediate
# -> a system root verifies, and only then write a CA file containing the
# system roots plus that intermediate. TLS verification stays on.
# Usage: complete-ca-chain.sh host output.pem
set -euo pipefail
host="$1"; out="$2"
work="$(mktemp -d)"
openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null | openssl x509 > "$work/leaf.pem"
issuer="$(openssl x509 -in "$work/leaf.pem" -noout -ext authorityInfoAccess | sed -n 's/.*CA Issuers - URI:\(http[^ ]*\).*/\1/p' | head -1)"
test -n "$issuer"
curl -fsSL --retry 3 -o "$work/issuer.bin" "$issuer"
openssl x509 -inform DER -in "$work/issuer.bin" -out "$work/issuer.pem" 2>/dev/null \
  || openssl x509 -in "$work/issuer.bin" -out "$work/issuer.pem"
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$work/issuer.pem" "$work/leaf.pem"
cat /etc/ssl/certs/ca-certificates.crt "$work/issuer.pem" > "$out"
echo "CA file with verified intermediate for $host: $out"
