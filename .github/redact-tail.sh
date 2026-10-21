#!/bin/sh
# Prints the end of a Wrangler log with emails and Cloudflare account names blanked out.
tail -n 40 "$1" | sed -E \
  -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+/<email>/g' \
  -e "s/[^│|]*'s Account/<account>/g" \
  -e 's/[0-9a-f]{32}/<id>/g'
