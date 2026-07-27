#!/usr/bin/env bash
# Repeats phase 1 of the Pi control run N times to measure variance.
#
# The single-run result (acceptance 23/23) came from one sample of a stochastic
# decoder, so it cannot separate "the harness fixed spec comprehension" from
# "we drew a lucky sample". Each repetition is fully independent: pristine work
# tree, fresh Pi session, same task, same server.
#
# Per run it records the immutable-acceptance verdict (the arbiter) plus the
# agent's own gate (test/lint/build), and archives the produced code.
#
# Usage: harness/run-pi-repeat.sh [N]   (default 2)

set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="${HARNESS_DIR}/petdesk-work"
SESSION_DIR="${HARNESS_DIR}/pi-sessions"
ARTIFACTS="${HARNESS_DIR}/artifacts"
SUMMARY="${HARNESS_DIR}/pi-variance-summary.tsv"

PROVIDER_EXT="${HARNESS_DIR}/pi-local-provider.js"
MODEL="local/qwen3.6-35b-a3b"
N="${1:-2}"

TASK="$(<"${HARNESS_DIR}/petdesk_task.txt")"

# Run 1 was executed manually before this script existed; start numbering at 2.
START="${START_AT:-2}"

if [[ ! -f "${SUMMARY}" ]]; then
  printf 'run\tacceptance\tvitest\tlint\tbuild\tevents\tseconds\n' > "${SUMMARY}"
fi

for (( i = START; i < START + N; i++ )); do
  RUN_DIR="${ARTIFACTS}/pi-phase1-run${i}"
  LOG="${HARNESS_DIR}/run-pi-repeat-run${i}.log"
  mkdir -p "${RUN_DIR}"

  echo "############ RUN ${i} ############" | tee "${LOG}"

  # --- pristine state, fresh session ---
  git -C "${WORKDIR}" checkout -- . >/dev/null 2>&1
  git -C "${WORKDIR}" clean -fd >/dev/null 2>&1
  rm -rf "${SESSION_DIR}"
  mkdir -p "${SESSION_DIR}"

  STARTED=$(date +%s)
  cd "${WORKDIR}" || exit 2

  # -nc is mandatory: without it Pi walks up and loads AgentCode/CLAUDE.md,
  # which documents this experiment and its expected answer.
  LOCAL_KEY=dummy pi \
    -e "${PROVIDER_EXT}" \
    --provider local \
    --model "${MODEL}" \
    -nc \
    --session-dir "${SESSION_DIR}" \
    -p "${TASK}" >> "${LOG}" 2>&1

  ELAPSED=$(( $(date +%s) - STARTED ))

  # --- the arbiter ---
  "${HARNESS_DIR}/run-acceptance.sh" >> "${LOG}" 2>&1
  if [[ $? -eq 0 ]]; then ACCEPT="PASS"; else ACCEPT="FAIL"; fi

  # --- the agent's own gate, measured independently of its claims ---
  if npx vitest run >> "${LOG}" 2>&1; then VITEST="PASS"; else VITEST="FAIL"; fi
  if npm run lint  >> "${LOG}" 2>&1; then LINT="PASS";   else LINT="FAIL";   fi
  if npm run build >> "${LOG}" 2>&1; then BUILD="PASS";  else BUILD="FAIL";  fi

  EVENTS=$(wc -l < "$(ls "${SESSION_DIR}"/*.jsonl 2>/dev/null | head -1)" 2>/dev/null || echo 0)

  # --- archive what this run produced ---
  cp "${WORKDIR}/src/engine/stats.ts"       "${RUN_DIR}/" 2>/dev/null
  cp "${WORKDIR}"/tests/engine.stats*.ts    "${RUN_DIR}/" 2>/dev/null
  cp "${WORKDIR}/tests/stats.e2e.test.ts"   "${RUN_DIR}/" 2>/dev/null
  cp -r "${WORKDIR}/src/app/api/stats"      "${RUN_DIR}/api-stats" 2>/dev/null
  cp "${SESSION_DIR}"/*.jsonl               "${RUN_DIR}/session.jsonl" 2>/dev/null

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "${i}" "${ACCEPT}" "${VITEST}" "${LINT}" "${BUILD}" "${EVENTS}" "${ELAPSED}" \
    | tee -a "${SUMMARY}"
done

echo
echo "=== variance summary ==="
column -t "${SUMMARY}"
