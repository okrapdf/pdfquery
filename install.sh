#!/bin/sh

set -eu

package=${PDFQUERY_PACKAGE:-pdfquery@latest}
if [ -n "${PDFQUERY_PREFIX:-}" ]; then
  prefix=$PDFQUERY_PREFIX
else
  [ -n "${HOME:-}" ] || {
    printf 'Error: HOME is not set; set PDFQUERY_PREFIX to a user-owned absolute path.\n' >&2
    exit 1
  }
  [ "$HOME" != / ] || {
    printf 'Error: refusing to derive an install prefix from HOME=/. Set PDFQUERY_PREFIX explicitly.\n' >&2
    exit 1
  }
  prefix=$HOME/.local
fi

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || die 'Node.js >= 20.16 is required but was not found on PATH.'
command -v npm >/dev/null 2>&1 || die 'npm is required but was not found on PATH.'

node_version=$(node --version 2>/dev/null || true)
node_version=${node_version#v}
node_major=${node_version%%.*}
node_rest=${node_version#*.}
node_minor=${node_rest%%.*}
case $node_major:$node_minor in
  *[!0-9:]* | :* | *:) die "could not parse Node.js version: $node_version" ;;
esac
if [ "$node_major" -lt 20 ] || { [ "$node_major" -eq 20 ] && [ "$node_minor" -lt 16 ]; }; then
  die "Node.js >= 20.16 is required; found $node_version."
fi
case $package in
  -*) die 'PDFQUERY_PACKAGE must be a package name, tarball path, or URL, not an option.' ;;
esac
case $prefix in
  /) die 'refusing to use / as PDFQUERY_PREFIX.' ;;
  /*) ;;
  *) die 'PDFQUERY_PREFIX must be an absolute, user-owned path.' ;;
esac

npm_log=$(mktemp "${TMPDIR:-/tmp}/pdfquery-install.XXXXXX") || die 'could not create a temporary npm log.'
trap 'rm -f "$npm_log"' EXIT HUP INT TERM

say "Installing $package..."
if ! npm install --global --prefix "$prefix" --no-fund --no-audit --loglevel=error -- "$package" >"$npm_log" 2>&1; then
  sed 's/^/  /' "$npm_log" >&2 || true
  die 'npm install failed. No sudo was attempted; set PDFQUERY_PREFIX to another user-owned directory and retry.'
fi
bin_dir=$prefix/bin

executable=$bin_dir/pdfquery
[ -x "$executable" ] || die "npm completed but $executable is not executable."
installed_version=$($executable --version 2>/dev/null) || die 'pdfquery was installed but failed its version check.'

say "Installed pdfquery $installed_version at $executable"
case :${PATH:-}: in
  *:"$bin_dir":*) ;;
  *) say "Add $bin_dir to PATH to run: pdfquery report.pdf 'H1'" ;;
esac
