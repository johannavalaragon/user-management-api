#!/bin/bash

set -euo pipefail

#
# Make a user admin
# Invoke with 'username'
#
if (( $# != 1 )) then
  echo "Usage: $0 username" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/.env"

USERNAME="$1"
DB_PATH="${DBFILE}"
if [[ "${DB_PATH}" != /* ]]; then
  DB_PATH="${REPO_DIR}/${DB_PATH}"
fi

if [[ ! -f "${DB_PATH}" ]]; then
  echo "Database file not found: ${DB_PATH}" >&2
  exit 1
fi

TMP_FILE="$(mktemp "${DB_PATH}.tmp.XXXXXX")"
trap 'rm -f "${TMP_FILE}"' EXIT

if awk -v username="${USERNAME}" '
BEGIN {
  found = 0
}
NR == 1 {
  print
  next
}
{
  line = $0

  c1 = index(line, ",")
  if (c1 == 0) { print line; next }
  rest1 = substr(line, c1 + 1)

  c2rel = index(rest1, ",")
  if (c2rel == 0) { print line; next }
  c2 = c1 + c2rel
  rest2 = substr(line, c2 + 1)

  c3rel = index(rest2, ",")
  if (c3rel == 0) { print line; next }
  c3 = c2 + c3rel

  name = substr(line, c2 + 1, c3 - c2 - 1)
  if (name == username) {
    found = 1
    admin = substr(line, c1 + 1, c2 - c1 - 1)
    if (admin != "true") {
      line = substr(line, 1, c1) "true" substr(line, c2)
      changed = 1
    }
  }

  print line
}
END {
  if (!found) exit 2
}
' "${DB_PATH}" > "${TMP_FILE}"; then
  mv "${TMP_FILE}" "${DB_PATH}"
  trap - EXIT
  echo "User '${USERNAME}' is now admin in ${DB_PATH}"
else
  status=$?
  if (( status == 2 )); then
    echo "User not found: ${USERNAME}" >&2
  else
    echo "Failed to update ${DB_PATH}" >&2
  fi
  exit 1
fi
