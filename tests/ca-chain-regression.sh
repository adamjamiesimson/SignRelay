#!/usr/bin/env bash
# Offline TLS regression: all certificates and keys are disposable test fixtures.
set -euo pipefail
repo="$(pwd)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
real_openssl="$(command -v openssl)"
cd "$work"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=fixture-root -keyout root.key -out root.pem >/dev/null 2>&1
openssl req -new -newkey rsa:2048 -nodes -subj /CN=fixture-intermediate -keyout intermediate.key -out intermediate.csr >/dev/null 2>&1
printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n' > ca.ext
openssl x509 -req -in intermediate.csr -CA root.pem -CAkey root.key -CAcreateserial -days 1 -extfile ca.ext -out intermediate.pem >/dev/null 2>&1
openssl req -new -newkey rsa:2048 -nodes -subj /CN=signdata.cc.gatech.edu -keyout leaf.key -out leaf.csr >/dev/null 2>&1
printf 'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:signdata.cc.gatech.edu\nextendedKeyUsage=serverAuth\n' > leaf.ext
openssl x509 -req -in leaf.csr -CA intermediate.pem -CAkey intermediate.key -CAcreateserial -days 1 -extfile leaf.ext -out leaf.pem >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=untrusted-extra-root -keyout rogue.key -out rogue.pem >/dev/null 2>&1
mkdir bin
cat > bin/openssl <<'EOF'
#!/usr/bin/env bash
if [ "$1" = s_client ]; then cat "$FIXTURE_PEER"; else exec "$REAL_OPENSSL" "$@"; fi
EOF
chmod +x bin/openssl
export REAL_OPENSSL="$real_openssl" FIXTURE_PEER="$work/peer.pem" SIGNRELAY_SYSTEM_CA_FILE="$work/root.pem"
export PATH="$work/bin:$PATH"
cat leaf.pem intermediate.pem rogue.pem > peer.pem
bash "$repo/training/complete_popsign_chain.sh" "$work/result.pem"
# Valid peer chain succeeds; unrelated attacker-controlled roots are excluded.
if openssl verify -CAfile result.pem rogue.pem >/dev/null 2>&1; then
  echo 'Unexpected trust in unrelated root' >&2; exit 1
fi
openssl verify -purpose sslserver -verify_hostname signdata.cc.gatech.edu -CAfile result.pem leaf.pem
# Missing intermediates fail and remove even a stale prior successful output.
cp leaf.pem peer.pem
if bash "$repo/training/complete_popsign_chain.sh" "$work/result.pem"; then
  echo 'Missing chain unexpectedly passed' >&2; exit 1
fi
test ! -e result.pem
# Explicit reviewed intermediates recover the same valid server chain.
export SIGNRELAY_CA_INTERMEDIATES="$work/intermediate.pem"
bash "$repo/training/complete_popsign_chain.sh" "$work/result.pem"
# A chain-valid certificate for a different hostname must still fail.
printf 'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:wrong.invalid\nextendedKeyUsage=serverAuth\n' > wrong.ext
openssl x509 -req -in leaf.csr -CA intermediate.pem -CAkey intermediate.key -CAcreateserial -days 1 -extfile wrong.ext -out peer.pem >/dev/null 2>&1
if bash "$repo/training/complete_popsign_chain.sh" "$work/result.pem"; then
  echo 'Wrong hostname unexpectedly passed' >&2; exit 1
fi
test ! -e result.pem
echo 'CA chain regression passed: anchored chain, omitted intermediate recovery, unrelated-root rejection, hostname rejection, stale-output removal.'
