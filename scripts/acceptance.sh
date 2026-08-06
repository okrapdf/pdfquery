#!/bin/sh
# shellcheck shell=sh

set -eu

mode=${1:-}
tarball=${2:-}
report=${3:-}
installer=${4:-}
expected='Quarterly revenue'
server_pid=''

usage() {
  printf '%s\n' \
    'Usage:' \
    '  acceptance.sh npx PDFQUERY_TARBALL REPORT_PDF' \
    '  acceptance.sh install PDFQUERY_TARBALL REPORT_PDF INSTALL_SH' >&2
  exit 2
}

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$acceptance_tmp"
}

fail() {
  printf 'Acceptance failed: %s\n' "$*" >&2
  if [ -s "$stderr_file" ]; then
    sed 's/^/  /' "$stderr_file" >&2 || true
  fi
  exit 1
}

[ "$mode" = npx ] || [ "$mode" = install ] || usage
[ -f "$tarball" ] || usage
[ -f "$report" ] || usage
if [ "$mode" = install ]; then
  [ -f "$installer" ] || usage
fi

command -v node >/dev/null 2>&1 || { printf 'Node.js is required.\n' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { printf 'npm is required.\n' >&2; exit 1; }
if command -v pdfquery >/dev/null 2>&1; then
  printf 'Acceptance requires a clean PATH with no existing pdfquery executable.\n' >&2
  exit 1
fi

tarball=$(cd "$(dirname "$tarball")" && pwd -P)/$(basename "$tarball")
report=$(cd "$(dirname "$report")" && pwd -P)/$(basename "$report")
if [ "$mode" = install ]; then
  installer=$(cd "$(dirname "$installer")" && pwd -P)/$(basename "$installer")
fi

acceptance_tmp=$(mktemp -d "${TMPDIR:-/tmp}/pdfquery-acceptance.XXXXXX")
stderr_file=$acceptance_tmp/stderr.log
trap cleanup 0 1 2 15
unset NODE_PATH npm_config_prefix NPM_CONFIG_PREFIX
export npm_config_cache="$acceptance_tmp/npm-cache"
export npm_config_update_notifier=false

if [ "$mode" = npx ]; then
  command -v npx >/dev/null 2>&1 || fail 'npx is required.'
  output=$(cd "$acceptance_tmp" && npx --yes --package "$tarball" -- pdfquery "$report" H1 2>"$stderr_file") \
    || fail 'the packed npx command exited non-zero.'
  [ "$output" = "$expected" ] \
    || fail "expected '$expected', got '$output'."
  printf 'npx acceptance ok: %s\n' "$output"
  exit 0
fi

command -v curl >/dev/null 2>&1 || fail 'curl is required for installer acceptance.'
server_root=$acceptance_tmp/http
prefix=$acceptance_tmp/prefix
port_file=$acceptance_tmp/port
mkdir -p "$server_root"
cp "$tarball" "$server_root/pdfquery.tgz"
cp "$installer" "$server_root/install.sh"

node -e '
  const fs = require("node:fs");
  const http = require("node:http");
  const path = require("node:path");
  const root = process.argv[1];
  const portFile = process.argv[2];
  const allowed = new Set(["install.sh", "pdfquery.tgz"]);
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).slice(1);
    if (!allowed.has(name)) {
      response.writeHead(404).end("not found\n");
      return;
    }
    const stream = fs.createReadStream(path.join(root, name));
    stream.on("error", () => response.writeHead(500).end("read error\n"));
    stream.pipe(response);
  });
  server.listen(0, "127.0.0.1", () => {
    fs.writeFileSync(portFile, String(server.address().port));
  });
' "$server_root" "$port_file" >"$acceptance_tmp/server.log" 2>&1 &
server_pid=$!

attempt=0
while [ ! -s "$port_file" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -le 100 ] || fail 'local HTTP server did not start.'
  kill -0 "$server_pid" 2>/dev/null || fail 'local HTTP server exited early.'
  sleep 0.1
done
port=$(cat "$port_file")
base_url=http://127.0.0.1:$port

curl -fsS "$base_url/install.sh" -o "$acceptance_tmp/fetched-install.sh" \
  || fail 'curl could not fetch install.sh over HTTP.'
PDFQUERY_PACKAGE=$base_url/pdfquery.tgz \
PDFQUERY_PREFIX=$prefix \
  sh "$acceptance_tmp/fetched-install.sh" >"$acceptance_tmp/install.log" 2>"$stderr_file" \
  || fail 'the curl-fetched installer exited non-zero.'

[ -x "$prefix/bin/pdfquery" ] || fail 'the isolated prefix has no pdfquery executable.'
output=$(cd "$acceptance_tmp" && "$prefix/bin/pdfquery" "$report" H1 2>"$stderr_file") \
  || fail 'the installed pdfquery command exited non-zero.'
[ "$output" = "$expected" ] \
  || fail "expected '$expected', got '$output'."
printf 'installer acceptance ok: %s\n' "$output"
