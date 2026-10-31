#!/usr/bin/env bash
# Usage: complete-ca-chain.sh host output.pem
# Certificate candidates are untrusted until OpenSSL verifies the complete
# server-auth chain AND hostname against the runner's existing system roots.
# No certificate fetched from AIA is installed as a new trust anchor.
set -euo pipefail
host="$1"; out="$2"
test "$host" = signdata.cc.gatech.edu || { echo 'Only the reviewed PopSign host is supported' >&2; exit 64; }
roots="${SIGNRELAY_SYSTEM_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}"
test -s "$roots" || { echo "System CA bundle missing: $roots; install ca-certificates" >&2; exit 78; }
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
# Never leave a stale successful bundle behind when this attempt fails.
rm -f -- "$out"
# s_client obtains public certificate candidates only, never dataset bytes.
# Its verification diagnostics are retained; the explicit verify below is the
# acceptance gate, including server purpose, expiry and the requested hostname.
if ! timeout 25 openssl s_client -connect "$host:443" -servername "$host" -CAfile "$roots" -showcerts </dev/null > "$work/peer" 2> "$work/tls.log"; then
  cat "$work/tls.log" >&2
  echo 'PopSign TLS handshake unavailable (25s limit); no CA bundle written' >&2
  exit 75
fi
awk '/BEGIN CERTIFICATE/{n++} n==1 {print} /END CERTIFICATE/ && n==1 {exit}' "$work/peer" > "$work/leaf.pem"
awk '/BEGIN CERTIFICATE/{n++} n>1 && /BEGIN CERTIFICATE/,/END CERTIFICATE/ {print}' "$work/peer" > "$work/chain.pem"
# The current outage is also a root-program distrust incident, not merely AIA
# availability. Never reconstruct this removed hierarchy using an old runner
# root store or a manually supplied cross-sign. Publisher reissuance is needed.
# https://blog.google/security/protecting-chrome-and-android-users-from-compromised-emudhra-intermediate-ca-certificates/
allowed_certificate() {
  if openssl x509 -in "$1" -noout -subject -issuer -nameopt RFC2253 \
      | grep -Eq 'CN=emSign (ECC Root CA - G3|Root TLS CA - G3)(,|$)'; then
    echo 'PopSign uses the distrusted emSign G3 hierarchy. Publisher must reissue under an unaffected hierarchy; do not restore this root or cross-sign. Frozen licensed local clips remain usable with --clip-cache.' >&2
    return 1
  fi
}
allowed_chain() {
  allowed_certificate "$work/leaf.pem" || return 1
  if [ -s "$work/chain.pem" ]; then
    awk -v dir="$work" '/BEGIN CERTIFICATE/{n++; active=1} active {print > (dir "/check-" n ".pem")} /END CERTIFICATE/{active=0}' "$work/chain.pem"
    for certificate in "$work"/check-*.pem; do allowed_certificate "$certificate" || return 1; done
  fi
}
# Administrator-provided INTERMEDIATES remain untrusted input to verification.
if [ -n "${SIGNRELAY_CA_INTERMEDIATES:-}" ]; then
  cat "$SIGNRELAY_CA_INTERMEDIATES" >> "$work/chain.pem"
fi
if ! allowed_chain; then exit 78; fi
verifies() {
  allowed_chain || return 1
  args=()
  if [ -s "$work/chain.pem" ]; then args=(-untrusted "$work/chain.pem"); fi
  openssl verify -purpose sslserver -verify_hostname "$host" -CAfile "$roots" "${args[@]}" "$work/leaf.pem"
}
current="$work/leaf.pem"
for level in 1 2 3 4; do
  if verifies > "$work/verify.log" 2>&1; then break; fi
  issuer="$(openssl x509 -in "$current" -noout -ext authorityInfoAccess 2>/dev/null | sed -n 's/.*CA Issuers - URI:\(http[^ ]*\).*/\1/p' | head -1)"
  test -n "$issuer" || break
  # AIA often publishes http URLs. Try the same issuer over HTTPS only; an
  # unreachable issuer is an external blocker, never grounds to weaken TLS.
  issuer="${issuer/#http:\/\//https:\/\/}"
  if ! curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 20 \
      --retry 1 --retry-max-time 45 --max-filesize 1048576 -o "$work/issuer.bin" "$issuer"; then
    echo "AIA issuer unavailable at level $level: $issuer" >&2
    break
  fi
  if ! { openssl x509 -inform DER -in "$work/issuer.bin" -out "$work/$level.pem" 2>/dev/null \
      || openssl x509 -in "$work/issuer.bin" -out "$work/$level.pem" 2>/dev/null \
      || openssl pkcs7 -inform DER -in "$work/issuer.bin" -print_certs -out "$work/$level.pem" 2>/dev/null; }; then
    echo 'AIA response is not a supported certificate' >&2; break
  fi
  cat "$work/$level.pem" >> "$work/chain.pem"
  if ! allowed_chain; then exit 78; fi
  current="$work/$level.pem"
done
if ! verifies; then
  openssl x509 -in "$work/leaf.pem" -noout -issuer -subject -dates >&2
  echo "PopSign chain cannot anchor to $roots. No CA bundle or data accepted." >&2
  echo 'Repair/reissue the upstream certificate under an unaffected trusted hierarchy. For unrelated missing-intermediate failures only, SIGNRELAY_CA_INTERMEDIATES supplies untrusted candidates. Never restore a distrusted root or cross-sign.' >&2
  exit 78
fi
# Do not promote unrelated certificates supplied by a peer/AIA bundle into
# roots. Include only CA certificates which independently chain to OS roots.
cp -- "$roots" "$work/verified.pem"
if [ -s "$work/chain.pem" ]; then
  awk -v dir="$work" '/BEGIN CERTIFICATE/{n++; active=1} active {print > (dir "/candidate-" n ".pem")} /END CERTIFICATE/{active=0}' "$work/chain.pem"
  for candidate in "$work"/candidate-*.pem; do
    if openssl x509 -in "$candidate" -noout -ext basicConstraints 2>/dev/null | grep -q 'CA:TRUE' \
        && openssl verify -CAfile "$roots" -untrusted "$work/chain.pem" "$candidate" >/dev/null 2>&1; then
      cat "$candidate" >> "$work/verified.pem"
    fi
  done
fi
mv -- "$work/verified.pem" "$out"
echo "Verified server-auth chain and hostname for $host: $out"
