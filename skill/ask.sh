#!/usr/bin/env bash
# asku agent client. Needs bash, curl and OpenSSL >= 1.1.1.
# ponytail: LibreSSL (macOS /usr/bin/openssl) lacks `dgst -macopt hexkey`; hand-rolled HMAC if macOS agents matter.
set -euo pipefail

SPKI_P256=3059301306072a8648ce3d020106082a8648ce3d030107034200

hex()    { od -An -v -tx1 | tr -d ' \n'; }
unhex()  { printf "$(sed 's/../\\x&/g')"; }
b64()    { openssl base64 -A; }
unb64()  { openssl base64 -d -A; }
sha256() { openssl dgst -sha256 -binary | hex; }
hmac()   { openssl dgst -sha256 -mac HMAC -macopt "hexkey:$1" -binary | hex; } # <key hex> < msg

# derive <key.pem> <peer pub b64> -> K hex
derive() {
  local peer k
  peer=$(mktemp)
  { echo "-----BEGIN PUBLIC KEY-----"
    { printf %s "$SPKI_P256" | unhex; printf %s "$2" | unb64; } | openssl base64
    echo "-----END PUBLIC KEY-----"; } > "$peer"
  k=$(openssl pkeyutl -derive -inkey "$1" -peerkey "$peer" | sha256) || { rm -f "$peer"; return 1; }
  rm -f "$peer"
  printf %s "$k"
}

# tag <kMac hex> <sid> <dir> <seq> <iv hex> <ct b64> -> hex
tag() { { printf 'v1|%s|%s|%s|' "$2" "$3" "$4"; printf %s "$5" | unhex; printf %s "$6" | unb64; } | hmac "$1"; }

# seal <K hex> <sid> <dir> <seq> [iv hex] < plaintext -> envelope json
seal() {
  local ke km iv ct
  ke=$(printf enc | hmac "$1"); km=$(printf mac | hmac "$1")
  iv=${5:-$(openssl rand -hex 16)}
  ct=$(openssl enc -aes-256-cbc -K "$ke" -iv "$iv" | b64)
  printf '{"v":1,"seq":%d,"dir":"%s","iv":"%s","ct":"%s","tag":"%s"}' "$4" "$3" \
    "$(printf %s "$iv" | unhex | b64)" "$ct" "$(tag "$km" "$2" "$3" "$4" "$iv" "$ct" | unhex | b64)"
}

# open <K hex> <sid> <dir> <seq> <iv b64> <ct b64> <tag b64> -> plaintext, fails on bad tag.
# dir and seq are what the caller expects, never read from the envelope: a replayed or reflected envelope fails the tag.
open() {
  local ke km iv
  ke=$(printf enc | hmac "$1"); km=$(printf mac | hmac "$1")
  iv=$(printf %s "$5" | unb64 | hex)
  # double-HMAC compare, so string comparison timing leaks nothing useful
  [ "$(tag "$km" "$2" "$3" "$4" "$iv" "$6" | hmac "$km")" = "$(printf %s "$7" | unb64 | hex | hmac "$km")" ] \
    || { echo "asku: bad tag" >&2; return 1; }
  printf %s "$6" | unb64 | openssl enc -d -aes-256-cbc -K "$ke" -iv "$iv"
}

# fragment <pubA b64> <T hex> -> "<sha256(pubA) hex>.<T hex>"
fragment() { printf '%s.%s' "$(printf %s "$1" | unb64 | sha256)" "$2"; }

# bindok <T hex> <pubB b64> <bind b64>: succeeds if bind == HMAC(T, pubB)
bindok() { [ "$(printf %s "$2" | unb64 | hmac "$1" | hmac "$1")" = "$(printf %s "$3" | unb64 | hex | hmac "$1")" ]; }
