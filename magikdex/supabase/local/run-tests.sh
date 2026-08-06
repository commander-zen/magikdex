#!/usr/bin/env bash
# run-tests.sh — rebuild the local database from scratch and run every pgTAP file
#
# Usage, from the magikdex/ directory:
#   bash supabase/local/run-tests.sh          # rebuild + run everything
#   bash supabase/local/run-tests.sh 025      # rebuild + run only tests matching 025
#
# Requires PGPASSWORD in magikdex/.env and PostgreSQL 17 installed. Never touches
# the hosted project — everything happens in a throwaway local database that is
# dropped and recreated on every run.
#
# WHY REBUILD EVERY TIME. A test suite that runs against a database someone has
# been poking at by hand tests the poking, not the migrations. Dropping the
# database is the only way to know that what passed is what is in version
# control. It costs about four seconds.

set -uo pipefail

DB="${DB:-magikdex}"
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/17/bin}"
PSQL="$PGBIN/psql.exe"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(cd "$HERE/.." && pwd)"
FILTER="${1:-}"

# PGPASSWORD comes from .env and is never echoed.
if [ -f "$SUPA/../.env" ]; then
  set -a; . "$SUPA/../.env"; set +a
fi
if [ -z "${PGPASSWORD:-}" ]; then
  echo "PGPASSWORD not set. Add it to magikdex/.env" >&2
  exit 1
fi
export PGPASSWORD

pg() { "$PSQL" -U postgres -h 127.0.0.1 -d "$1" -q -v ON_ERROR_STOP=1 "${@:2}"; }

echo "── rebuilding $DB ──────────────────────────────────────────"
"$PSQL" -U postgres -h 127.0.0.1 -d postgres -q \
  -c "drop database if exists $DB;" -c "create database $DB;" || exit 1

# The shim supplies what Supabase provides and a stock Postgres does not: the
# anon/authenticated/service_role roles, the auth schema, auth.uid(), the
# extensions schema, and Supabase's default privileges. Without that last part
# "no policy" would read as denied here and as zero-rows in production, and every
# 42501 assertion would pass for the wrong reason.
for f in "$HERE/00_supabase_shim.sql" "$HERE/pgtap--1.3.4.sql"; do
  if err=$(pg "$DB" -f "$f" 2>&1 | grep -i "^psql.*error" | head -3); [ -n "$err" ]; then
    echo "FAIL  $(basename "$f")"; echo "$err"; exit 1
  fi
  printf 'ok    %s\n' "$(basename "$f")"
done

echo "── migrations ──────────────────────────────────────────────"
# Sorted, so the replay order is the filename order. archive/ is excluded by the
# glob: those are history, and four of them are not idempotent.
for f in $(ls "$SUPA"/migrations/*.sql | sort); do
  if err=$(pg "$DB" -f "$f" 2>&1 | grep -i "^psql.*error" | head -3); [ -n "$err" ]; then
    echo "FAIL  $(basename "$f")"; echo "$err"; exit 1
  fi
  printf 'ok    %s\n' "$(basename "$f")"
done

echo "── tests ───────────────────────────────────────────────────"
total=0; failed=0; files=0
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

for t in $(ls "$SUPA"/tests/*.sql | sort); do
  base="$(basename "$t" .sql)"
  [ -n "$FILTER" ] && case "$base" in *"$FILTER"*) ;; *) continue ;; esac

  # pgTAP is loaded into public locally rather than installed as an extension
  # (writing share/extension needs admin). The test files are left untouched so
  # they still work verbatim in the hosted SQL editor; the create-extension line
  # is neutralised only in this throwaway copy.
  sed 's/^create extension if not exists pgtap.*/-- pgtap preloaded locally/' "$t" > "$tmp"

  out=$("$PSQL" -U postgres -h 127.0.0.1 -d "$DB" -tAq -f "$tmp" 2>&1)
  ok=$(printf '%s\n' "$out" | grep -c '^ok ')
  nok=$(printf '%s\n' "$out" | grep -c '^not ok ')
  err=$(printf '%s\n' "$out" | grep -ci 'ERROR:')

  total=$((total + ok)); failed=$((failed + nok)); files=$((files + 1))
  printf '%-40s %3d ok  %d failed  %d errors\n' "$base" "$ok" "$nok" "$err"

  # Only the failures and errors are printed, not 54 lines of ok.
  if [ "$nok" -gt 0 ] || [ "$err" -gt 0 ]; then
    printf '%s\n' "$out" | grep -E '^not ok |ERROR:|^#' | head -20 | sed 's/^/    /'
  fi
done

echo "────────────────────────────────────────────────────────────"
printf '%d files, %d assertions, %d failed\n' "$files" "$total" "$failed"
[ "$failed" -eq 0 ] || exit 1
