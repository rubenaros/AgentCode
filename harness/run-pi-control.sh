#!/usr/bin/env bash
# Control run for the "modelos locales agenticos" arc: same model, same server,
# same task as the v4 run — only the harness changes (ornith_agent_v4.py -> Pi).
#
# Phase 1 (measurement): the agent works against its own gate (npm test/lint/
# build) exactly as in v4. It is not told that an external acceptance exists.
# When it finishes, harness/run-acceptance.sh delivers the verdict.
#
# Phase 2 (intervention) is driven separately with `pi --continue`.
#
# -nc is MANDATORY: without it Pi walks up the tree and loads
# ../../CLAUDE.md — the AgentCode research notes, which describe this very
# experiment and its expected answer. That would void the run.

set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="${HARNESS_DIR}/petdesk-work"
SESSION_DIR="${HARNESS_DIR}/pi-sessions"
LOG="${HARNESS_DIR}/run-pi-control-phase1.log"

PROVIDER_EXT="${HARNESS_DIR}/pi-local-provider.js"
MODEL="local/qwen3.6-35b-a3b"

mkdir -p "${SESSION_DIR}"

TASK="$(<"${HARNESS_DIR}/petdesk_task.txt")"

echo "=== Pi control run — phase 1 (measurement) ===" | tee "${LOG}"
echo "workdir : ${WORKDIR}" | tee -a "${LOG}"
echo "model   : ${MODEL} (llama-server 127.0.0.1:8090)" | tee -a "${LOG}"
echo "session : ${SESSION_DIR}" | tee -a "${LOG}"
echo | tee -a "${LOG}"

cd "${WORKDIR}" || exit 2

LOCAL_KEY=dummy pi \
  -e "${PROVIDER_EXT}" \
  --provider local \
  --model "${MODEL}" \
  -nc \
  --session-dir "${SESSION_DIR}" \
  -p "${TASK}" 2>&1 | tee -a "${LOG}"

echo | tee -a "${LOG}"
echo "=== agent finished — running the immutable acceptance ===" | tee -a "${LOG}"
"${HARNESS_DIR}/run-acceptance.sh" 2>&1 | tee -a "${LOG}"
