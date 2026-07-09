#!/usr/bin/env bash
# Corre el experimento definitivo (Qwen3.6-27B dense + harness v3) en una GPU cloud.
# Diseñado para una instancia Ubuntu con GPU NVIDIA (RunPod / Vast.ai / Lambda).
#
# Uso:
#   git clone https://github.com/rubenaros/AgentCode.git && cd AgentCode/harness
#   MODEL_TAG=hf.co/unsloth/Qwen3.6-27B-GGUF:Q8_0 bash run-cloud-experiment.sh    # 48GB card
#   # o, para 24GB (con compromiso de contexto):
#   MODEL_TAG=hf.co/unsloth/Qwen3.6-27B-GGUF:Q4_K_M NUM_CTX=16384 bash run-cloud-experiment.sh
#
# El harness usa Ollama (/api/chat) sin cambios — el mismo que corrimos local.
set -euo pipefail

# --- config (override por env) ---
MODEL_TAG="${MODEL_TAG:-hf.co/unsloth/Qwen3.6-27B-GGUF:Q6_K}"   # Q6_K=22.5GB (48GB card). Q4_K_M=~16GB (24GB card).
NUM_CTX="${NUM_CTX:-32768}"
MAX_STEPS="${MAX_STEPS:-90}"
WORKDIR="${WORKDIR:-/workspace/petdesk}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> 1/5 Ollama"
command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh
pgrep -x ollama >/dev/null 2>&1 || { nohup ollama serve >/tmp/ollama.log 2>&1 & sleep 6; }

echo "==> 2/5 modelo ($MODEL_TAG) — descarga grande (~16-35GB según quant)"
ollama pull "$MODEL_TAG"

echo "==> 3/5 Node 22 + git + python3"
if ! node --version 2>/dev/null | grep -qE 'v(2[0-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
fi
apt-get install -y git python3 >/dev/null 2>&1 || true

echo "==> 4/5 clonar petdesk-v2 @ v8-baseline + deps"
rm -rf "$WORKDIR"
git clone --quiet --branch v8-baseline --single-branch https://github.com/rubenaros/petdesk-v2.git "$WORKDIR"
( cd "$WORKDIR" && npm install --no-audit --no-fund )

echo "==> 5/5 correr harness v3 (directed verify loop)"
cd "$HERE"
AGENT_MODEL="$MODEL_TAG" AGENT_THINK=false AGENT_TEMP=0.6 AGENT_TOPP=0.8 AGENT_TOPK=20 \
AGENT_NUMCTX="$NUM_CTX" AGENT_NUMPREDICT=8192 \
  python3 ornith_agent_v3.py "$WORKDIR" petdesk_task.txt "$MAX_STEPS" 2>&1 | tee /workspace/run.log

echo ""
echo "==> RESULTADO — aceptación final sobre el código producido:"
( cd "$WORKDIR" && echo "--- git status ---" && git status --porcelain && \
  echo "--- npm test ---" && npm test 2>&1 | tail -5 && \
  echo "--- npm run build ---" && npm run build 2>&1 | tail -3 )
