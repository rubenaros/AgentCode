#!/usr/bin/env bash
# Runs the immutable acceptance suite against whatever is currently in the work tree.
#
# The suite lives in harness/acceptance/ — outside the work tree — so the agent
# under test never sees it, cannot read it, and cannot edit it. This script
# injects it, runs it, and removes it again, leaving no trace in the tree.
#
# Usage: harness/run-acceptance.sh [WORKDIR]
#        WORKDIR defaults to harness/petdesk-work

set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCEPTANCE_DIR="${HARNESS_DIR}/acceptance"
WORKDIR="${1:-${HARNESS_DIR}/petdesk-work}"

if [[ ! -d "${WORKDIR}" ]]; then
  echo "FATAL: work tree not found: ${WORKDIR}" >&2
  exit 2
fi

mapfile -t SUITES < <(cd "${ACCEPTANCE_DIR}" && ls ./*.acceptance.test.ts)
if [[ ${#SUITES[@]} -eq 0 ]]; then
  echo "FATAL: no acceptance suites in ${ACCEPTANCE_DIR}" >&2
  exit 2
fi

CONFIG_NAME="vitest.acceptance.config.ts"

INJECTED=()
cleanup() {
  for f in "${INJECTED[@]:-}"; do
    [[ -n "${f}" ]] && rm -f "${WORKDIR}/tests/${f}"
  done
  rm -f "${WORKDIR}/${CONFIG_NAME}"
}
trap cleanup EXIT

echo "=== injecting acceptance suite into ${WORKDIR}/tests/ ==="
TARGETS=()
for suite in "${SUITES[@]}"; do
  name="$(basename "${suite}")"
  if [[ -e "${WORKDIR}/tests/${name}" ]]; then
    echo "FATAL: ${name} already exists in the work tree — the agent may have" >&2
    echo "       authored a file with the acceptance name. Refusing to overwrite." >&2
    exit 2
  fi
  cp "${ACCEPTANCE_DIR}/${name}" "${WORKDIR}/tests/${name}"
  INJECTED+=("${name}")
  TARGETS+=("tests/${name}")
  echo "  + ${name}"
done

cp "${ACCEPTANCE_DIR}/${CONFIG_NAME}" "${WORKDIR}/${CONFIG_NAME}"
echo "  + ${CONFIG_NAME} (adds the @/* alias the baseline vitest config omits)"

echo
echo "=== running acceptance (agent tests are NOT part of this verdict) ==="
cd "${WORKDIR}" || exit 2
npx vitest run --config "${CONFIG_NAME}" "${TARGETS[@]}" --disableConsoleIntercept
STATUS=$?

echo
if [[ ${STATUS} -eq 0 ]]; then
  echo ">>> ACCEPTANCE PASS — implementation matches the spec"
else
  echo ">>> ACCEPTANCE FAIL — implementation deviates from the spec (exit ${STATUS})"
fi
exit ${STATUS}
