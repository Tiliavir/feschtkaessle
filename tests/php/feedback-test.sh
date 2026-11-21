#!/usr/bin/env bash
# Runs the built feedback endpoint (public/feschtkaessle-feedback.php) with PHP's built-in
# server against a fake GitHub API. Needs `npm run compile` first; run from the repo root.
set -euo pipefail

ROOT=$(pwd)
WORK=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK"' EXIT
mkdir -p "$WORK/www" "$WORK/fake"
cp public/feschtkaessle-feedback.php "$WORK/www/"
cat > "$WORK/feedback-config.php" <<PHP
<?php
return [
    'token' => 'test-token',
    'repository' => 'Tiliavir/public-feedback',
    'salt' => 'test-salt',
    'api_url' => 'http://127.0.0.1:8792',
    'data_dir' => '$WORK/data',
];
PHP

FAKE_DIR="$WORK/fake" php -S 127.0.0.1:8792 "$ROOT/tests/php/fake-github.php" >/dev/null 2>&1 &
php -S 127.0.0.1:8791 -t "$WORK/www" >/dev/null 2>&1 &
for _ in $(seq 50); do
  curl -s -o /dev/null http://127.0.0.1:8791/ && curl -s -o /dev/null http://127.0.0.1:8792/ && break
  sleep 0.1
done
rm -f "$WORK"/fake/request-*.json

URL=http://127.0.0.1:8791/feschtkaessle-feedback.php
ORIGIN=https://tiliavir.github.io
OLD=$(( $(date +%s) * 1000 - 10000 ))
FAILED=0

post() { curl -s -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' -H "Origin: ${POST_ORIGIN:-$ORIGIN}" "$URL" "$@"; }
check() {
  local name=$1 actual=$2 expected=$3
  if [[ "$actual" == "$expected" ]]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected '$expected', got '$actual'"
    FAILED=1
  fi
}
issues() { find "$WORK/fake" -name 'request-*.json' | wc -l | tr -d ' '; }

TEXT='Kasse @Tiliavir hängt ``` bei https://example.org'
check "valid answers create an issue" "$(post --form-string nutzung=vereinsfest --form-string "nervt=$TEXT" \
  --form-string version=2.3.0 --form-string installiert=ja --form-string geraet=mobil --form-string "started=$OLD")" 201
check "CORS allows the app" "$(grep -i '^access-control-allow-origin' "$WORK/headers" | tr -d '\r' | cut -d' ' -f2)" "$ORIGIN"
check "one issue sent" "$(issues)" 1
ISSUE="$WORK/fake/request-1.json"
check "repository path" "$(php -r 'echo json_decode(file_get_contents($argv[1]), true)["path"];' "$ISSUE")" /repos/Tiliavir/public-feedback/issues
check "token sent" "$(php -r 'echo json_decode(file_get_contents($argv[1]), true)["auth"];' "$ISSUE")" "Bearer test-token"
check "labels" "$(php -r 'echo implode(",", json_decode(file_get_contents($argv[1]), true)["issue"]["labels"]);' "$ISSUE")" "feedback,ungeprüft,feschtkässle"
check "title" "$(php -r 'echo json_decode(file_get_contents($argv[1]), true)["issue"]["title"];' "$ISSUE")" "Feedback vom $(TZ=Europe/Berlin date +%d.%m.%Y)"
BODY=$(php -r 'echo json_decode(file_get_contents($argv[1]), true)["issue"]["body"];' "$ISSUE")
check "choice as label" "$(grep -c '^Vereinsfest$' <<<"$BODY")" 1
check "free text fenced longer than its backticks" "$(grep -c '^````text$' <<<"$BODY")" 1
check "free text kept verbatim" "$(grep -cF "$TEXT" <<<"$BODY")" 1
check "tech details" "$(grep -c -e '^- Version: 2.3.0$' -e '^- Installiert: ja$' -e '^- Gerät: mobil$' <<<"$BODY")" 3

check "honeypot answers ok" "$(post --form-string nervt=x --form-string website=spam --form-string "started=$OLD")" 201
check "too fast answers ok" "$(post --form-string nervt=x --form-string "started=$(( $(date +%s) * 1000 ))")" 201
check "missing timestamp answers ok" "$(post --form-string nervt=x)" 201
check "link spam answers ok" "$(post --form-string 'nervt=http://a http://b www.c' --form-string "started=$OLD")" 201
check "...without issues" "$(issues)" 1

check "no answer is rejected" "$(post --form-string version=2.3.0 --form-string "started=$OLD")" 400
check "unknown option is rejected" "$(post --form-string nutzung=hack --form-string "started=$OLD")" 400
check "too long text is rejected" "$(post --form-string "nervt=$(printf 'x%.0s' $(seq 2001))" --form-string "started=$OLD")" 400
check "GET is not allowed" "$(curl -s -o /dev/null -w '%{http_code}' "$URL")" 405
check "foreign origin is rejected" "$(POST_ORIGIN=https://evil.example post --form-string nervt=x --form-string "started=$OLD")" 403
check "unknown tech values" "$(post --form-string nervt=y --form-string version=1 --form-string installiert=x --form-string "started=$OLD")" 201
check "...are stored as unbekannt" "$(php -r 'echo json_decode(file_get_contents($argv[1]), true)["issue"]["body"];' "$WORK/fake/request-2.json" | grep -c 'unbekannt')" 3

echo 500 > "$WORK/fake/status.txt"
check "GitHub failure is reported" "$(post --form-string nervt=z --form-string "started=$OLD")" 502
rm "$WORK/fake/status.txt"
check "rate limit per address" "$(post --form-string nervt=z --form-string "started=$OLD")" 429

[[ -n "${SHOW_ISSUE:-}" ]] && php -r 'echo json_decode(file_get_contents($argv[1]), true)["issue"]["body"];' "$ISSUE"
exit $FAILED
