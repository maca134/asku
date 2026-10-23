#!/usr/bin/env bash
# asku agent client. Needs bash, curl and OpenSSL >= 1.1.1.
# ponytail: LibreSSL (macOS /usr/bin/openssl) lacks `dgst -macopt hexkey`; hand-rolled HMAC if macOS agents matter.
set -euo pipefail

VERSION=1.0.0 # keep in step with ask.ps1

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

# bindmac <T hex> <pub b64> -> HMAC(T, pub) b64: the agent's binding when it joins a browser-created session
bindmac() { printf %s "$2" | unb64 | hmac "$1" | unhex | b64; }

# ---- CLI ----------------------------------------------------------------------------------------
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0 # sourced (tests): functions only

S=${ASKU_HOME:-$HOME/.asku}/${ASKU_SESSION:-default}
BASE=$(cat "$S/url" 2>/dev/null || echo "${ASKU_URL:-https://asku.dev}") # a joined session lives on its link's relay
WAIT=${ASKU_WAIT:-500} # no new poll after this many seconds; agent tool timeouts are ~600s
AUTH=$S/auth
command -v cygpath >/dev/null && AUTH=$(cygpath -m "$AUTH") # native curl.exe on Git Bash can't read /c/... paths
umask 077

die() { echo "asku: $*" >&2; exit 1; }
pending() { printf 'PENDING\n%s\nRun again to keep waiting: %s wait\n' "$1" "$0"; exit 2; }
jget() { sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\).*/\1/p"; } # flat JSON of base64 and ints only
state() { cat "$S/$1" 2>/dev/null || echo "${2:-}"; }

# req <method> <path> [json] -> CODE, BODY. Returns 1 only on network errors.
req() {
  local out args=(-sS --max-time 40 -X "$1" -w '\n%{http_code}' -H 'content-type: application/json')
  [ -f "$S/auth" ] && args+=(-H "@$AUTH")
  out=$(printf %s "${3:-}" | curl "${args[@]}" ${3:+--data-binary @-} "$BASE$2") || return 1
  CODE=${out##*$'\n'}
  BODY=${out%$'\n'*}
}

keygen() {
  mkdir -p "$S"
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$S/a.pem" 2>/dev/null
  openssl pkey -in "$S/a.pem" -pubout -outform DER | tail -c 65 | b64 > "$S/pub"
  printf %s "$BASE" > "$S/url"
}

save_session() { # <sid> <write key>
  printf %s "$1" > "$S/sid"
  printf 'authorization: Bearer %s\n' "$2" > "$S/auth"
}

start() {
  [ -f "$S/sid" ] && return
  keygen
  openssl rand -hex 16 > "$S/T"
  req POST /s "{\"pub\":\"$(state pub)\"}" || { rm -rf "$S"; die "relay unreachable: $BASE"; }
  [ "$CODE" = 201 ] || { rm -rf "$S"; die "create failed ($CODE): $BODY"; }
  save_session "$(printf %s "$BODY" | jget sid)" "$(printf %s "$BODY" | jget key)"
}

# join <agent link>: join a session the user started on the website. resume then prints their opening note.
join() {
  [ ! -f "$S/sid" ] || die "session '${ASKU_SESSION:-default}' is in use; run: $0 close, or set ASKU_SESSION"
  [[ ${1:-} =~ ^(https?://[^/#]+)/j/([A-Za-z0-9_-]{22})#([0-9a-f]{64})\.([0-9a-f]{32})$ ]] || die "not an asku agent link: ${1:-}"
  BASE=${BASH_REMATCH[1]}
  local sid=${BASH_REMATCH[2]} hash=${BASH_REMATCH[3]} t=${BASH_REMATCH[4]} pub
  req GET "/s/$sid" || die "relay unreachable: $BASE"
  [ "$CODE" = 200 ] || die "session not found ($CODE); ask the user for a new link"
  pub=$(printf %s "$BODY" | jget pub)
  [ "$(printf %s "$BODY" | jget role)" = browser ] || die "that is a link for the user, not for the agent"
  [ "$(printf %s "$pub" | unb64 | sha256)" = "$hash" ] || die "the link doesn't match its session; ask the user for a new one"
  keygen
  req POST "/s/$sid/bind" "{\"pub\":\"$(state pub)\",\"mac\":\"$(bindmac "$t" "$(state pub)")\"}" || { rm -rf "$S"; die "relay unreachable: $BASE"; }
  [ "$CODE" = 201 ] || { rm -rf "$S"; die "join failed ($CODE): $BODY"; } # 409: someone already joined
  save_session "$sid" "$(printf %s "$BODY" | jget key)"
  derive "$S/a.pem" "$pub" > "$S/K"
  echo 0 > "$S/seq"
  echo -1 > "$S/answered" # the opening note arrives as answer 0
}

link() { printf '%s/a/%s#%s' "$BASE" "$(state sid)" "$(fragment "$(state pub)" "$(state T)")"; }
gone() { rm -rf "$S"; die "session expired or closed"; }

# Waits for the bind, sends the pending question, waits for its answer and prints it.
resume() {
  [ -f "$S/sid" ] || die "no session; run: $0 ask <file>"
  local sid seq pub deadline=$((SECONDS + WAIT))
  sid=$(state sid)
  while [ ! -f "$S/K" ]; do
    [ $SECONDS -lt $deadline ] || pending "The user has not opened the link yet. Give them: $(link)"
    req GET "/s/$sid/bind" || { sleep 2; continue; }
    case $CODE in
      200) pub=$(printf %s "$BODY" | jget pub)
           if ! bindok "$(state T)" "$pub" "$(printf %s "$BODY" | jget mac)"; then
             req DELETE "/s/$sid" || true; rm -rf "$S"
             die "the link was opened without the right token; session closed, start a new one"
           fi
           derive "$S/a.pem" "$pub" > "$S/K" ;;
      204) ;;
      404) gone ;;
      *) die "bind poll failed ($CODE): $BODY" ;;
    esac
  done
  seq=$(state seq 0)
  if [ -f "$S/pending" ]; then
    seq=$((seq + 1))
    BODY=$(seal "$(state K)" "$sid" q "$seq" < "$S/pending")
    until req POST "/s/$sid/q" "$BODY"; do sleep 2; done
    [ "$CODE" = 204 ] || [ "$CODE" = 409 ] || die "send failed ($CODE): $BODY" # 409: an earlier run already sent it
    echo "$seq" > "$S/seq"
    rm "$S/pending"
  fi
  [ "$seq" != "$(state answered 0)" ] || die "no question pending; run: $0 ask <file>"
  while :; do
    [ $SECONDS -lt $deadline ] || pending "The user has not answered yet."
    req GET "/s/$sid/a?after=$((seq - 1))" || { sleep 2; continue; }
    case $CODE in
      200) open "$(state K)" "$sid" a "$seq" "$(printf %s "$BODY" | jget iv)" "$(printf %s "$BODY" | jget ct)" \
             "$(printf %s "$BODY" | jget tag)" || die "answer failed verification"
           echo
           echo "$seq" > "$S/answered"
           return ;;
      204) ;;
      404) gone ;;
      *) die "answer poll failed ($CODE): $BODY" ;;
    esac
  done
}

case "${1:-}" in
  ask)
    [ ! -f "$S/pending" ] && [ "$(state seq 0)" = "$(state answered 0)" ] || die "a question is still pending; run: $0 wait"
    fresh=; [ -f "$S/sid" ] || fresh=1
    start
    cat "${2:--}" > "$S/pending"
    [ -z "$fresh" ] || pending "Give the user this link: $(link)"
    resume ;;
  join) join "${2:-}"; resume ;;
  wait) resume ;;
  version) echo "$VERSION" ;;
  close)
    if [ -f "$S/sid" ]; then req DELETE "/s/$(state sid)" || true; fi
    rm -rf "$S" ;;
  *)
    cat >&2 <<USAGE
usage: $0 ask <questions.json | ->   send a question, print the answer JSON
       $0 join <agent link>          join a session the user started, print their opening note
       $0 wait                       keep waiting after PENDING
       $0 close                      end the session
       $0 version                    print the client version
exit: 0 answered, 1 error, 2 PENDING (run wait)
env: ASKU_URL ASKU_SESSION ASKU_HOME ASKU_WAIT
USAGE
    exit 1 ;;
esac
