#!/usr/bin/env bash
# Repeats the v4 harness run N times, judged by the SAME immutable acceptance
# used for the Pi control.
#
# Why: the Pi control has n=3, the original v4 run has n=1. Without repeating
# v4 we cannot tell whether its off-spec result was caused by the harness
# instruction ("tests are FROZEN and CORRECT") or was simply a bad sample.
#
# Everything except the harness is held fixed: same model, same llama-server,
# same task file, same pristine baseline.
#
# Usage: harness/run-v4-repeat.sh [N]   (default 3)

set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="${HARNESS_DIR}/petdesk-work"
ARTIFACTS="${HARNESS_DIR}/artifacts"
SUMMARY="${HARNESS_DIR}/v4-variance-summary.tsv"
TASK_FILE="${HARNESS_DIR}/petdesk_task.txt"

N="${1:-3}"

# Match the original v4 run: llama-server over the OpenAI-compatible endpoint.
export AGENT_BACKEND=openai
export AGENT_BASE_URL=http://127.0.0.1:8090
export AGENT_MODEL=local

if [[ ! -f "${SUMMARY}" ]]; then
  printf 'run\tacceptance\tvitest\tlint\tbuild\tsteps\tseconds\n' > "${SUMMARY}"
fi

for (( i = 1; i <= N; i++ )); do
  RUN_DIR="${ARTIFACTS}/v4-run${i}"
  LOG="${HARNESS_DIR}/run-v4-repeat-run${i}.log"
  mkdir -p "${RUN_DIR}"

  echo "############ V4 RUN ${i} ############" | tee "${LOG}"

  git -C "${WORKDIR}" checkout -- . >/dev/null 2>&1
  git -C "${WORKDIR}" clean -fd >/dev/null 2>&1

  STARTED=$(date +%s)
  python3 "${HARNESS_DIR}/ornith_agent_v4.py" "${WORKDIR}" "${TASK_FILE}" 90 >> "${LOG}" 2>&1
  ELAPSED=$(( $(date +%s) - STARTED ))

  cd "${WORKDIR}" || exit 2

  # The arbiter — the same suite that judged the Pi runs.
  "${HARNESS_DIR}/run-acceptance.sh" >> "${LOG}" 2>&1
  if [[ $? -eq 0 ]]; then ACCEPT="PASS"; else ACCEPT="FAIL"; fi

  # The agent's own gate, measured independently of what it claims.
  if npx vitest run >> "${LOG}" 2>&1; then VITEST="PASS"; else VITEST="FAIL"; fi
  if npm run lint  >> "${LOG}" 2>&1; then LINT="PASS";   else LINT="FAIL";   fi
  if npm run build >> "${LOG}" 2>&1; then BUILD="PASS";  else BUILD="FAIL";  fi

  STEPS=$(rg -c '^===== STEP ' "${LOG}" 2>/dev/null || echo 0)

  cp "${WORKDIR}/src/engine/stats.ts"     "${RUN_DIR}/" 2>/dev/null
  cp "${WORKDIR}"/tests/engine.stats*.ts  "${RUN_DIR}/" 2>/dev/null
  cp "${WORKDIR}/tests/stats.e2e.test.ts" "${RUN_DIR}/" 2>/dev/null
  cp -r "${WORKDIR}/src/app/api/stats"    "${RUN_DIR}/api-stats" 2>/dev/null
  cp "${LOG}"                             "${RUN_DIR}/run.log" 2>/dev/null

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "${i}" "${ACCEPT}" "${VITEST}" "${LINT}" "${BUILD}" "${STEPS}" "${ELAPSED}" \
    | tee -a "${SUMMARY}"
done

echo
echo "=== v4 variance summary ==="
column -t "${SUMMARY}"
