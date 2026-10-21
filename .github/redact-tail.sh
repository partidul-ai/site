#!/bin/sh
# Prints a Wrangler log's error lines with emails, Cloudflare account names and ids blanked out.
grep -E '✘|ERROR|[Ee]rror' "$1" | tail -n 20 | sed -E \
  -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+/<email>/g' \
  -e "s/[^ ]*'s Account/<account>/g" \
  -e 's/[0-9a-f]{32}/<id>/g'
