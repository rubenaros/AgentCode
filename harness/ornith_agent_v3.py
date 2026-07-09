#!/usr/bin/env python3
"""Robust harness v2 for small local coding models.

Adds CODE-SIDE guardrails (phase enforcement, loop-breaking, scope guard,
forced verification) with only SHORT injected nudges — testing whether a
context-EFFICIENT strong harness can rescue a weak model, i.e. whether the
context<->harness double bind is escapable by putting intelligence in code
rather than in a giant system prompt.

Targets the observed failure modes:
  - SWE-Next: 90 steps of pure read-loop, never wrote a file  -> phase forcing
  - Gemma: off-scope divagation (wrangler/playwright)          -> scope guard
  - all: never ran acceptance / no test->fix                    -> forced verify
  - repeated identical actions                                  -> loop breaker

Usage: ornith_agent_v2.py <workdir> <task_file> [max_steps]
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

OLLAMA = "http://localhost:11434/api/chat"
MODEL = os.environ.get("AGENT_MODEL", "hf.co/mradermacher/SWE-Next-14B-GGUF:Q4_K_M")
TEMP = float(os.environ.get("AGENT_TEMP", "0.6"))
TOP_P = float(os.environ.get("AGENT_TOPP", "0.8"))
TOP_K = int(os.environ.get("AGENT_TOPK", "20"))
NUM_CTX = int(os.environ.get("AGENT_NUMCTX", "16384"))
THINK = os.environ.get("AGENT_THINK", "false").lower() == "true"
NUM_PREDICT = int(os.environ.get("AGENT_NUMPREDICT", "8192"))
MAX_OUT = 5000

# Lean system prompt — the enforcement lives in code, not here.
SYSTEM = """You are an autonomous software engineering agent in a real repo.
WORKDIR: {workdir} (all paths relative to it). You have a terminal + filesystem via tools.

Work in phases and DO NOT get stuck reading:
  1) EXPLORE briefly — read only the files you truly need (constitution, plan, the type, 1-2 examples).
  2) IMPLEMENT — create every required file with write_file. This is the important phase.
  3) VERIFY — run `npm test`, read failures, fix, repeat until green. Also `npm run lint` and `npm run build`.
Reply "DONE: <summary>" ONLY when npm test, lint and build all pass. Never fake tool results."""

TOOLS = [
    {"type": "function", "function": {"name": "run_bash",
        "description": "Run a shell command in WORKDIR (stdout+stderr).",
        "parameters": {"type": "object", "properties": {"cmd": {"type": "string"}}, "required": ["cmd"]}}},
    {"type": "function", "function": {"name": "read_file",
        "description": "Read a file (path relative to WORKDIR).",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {"name": "write_file",
        "description": "Create/overwrite a file (path relative to WORKDIR).",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}},
]

READ_TOOLS = {"read_file"}
READ_BASH = re.compile(r"^\s*(cat|ls|head|tail|less|find|grep|rg|tree|wc|stat|pwd|echo)\b")
# a bash cmd that WRITES (heredoc, redirect, tee, patch) — takes precedence over READ_BASH
WRITE_BASH = re.compile(r"(>>?|\btee\b|<<|git\s+apply|\bpatch\b|sed\s+-i|mkdir|mv\b|cp\b)")
OFFSCOPE = re.compile(r"\b(wrangler|playwright|vercel|docker|next\s+(dev|start)|pages\s+dev|npx\s+create|create-next-app|serve|ngrok)\b", re.I)


TOOL_ALIASES = {"execute_bash": "run_bash", "bash": "run_bash", "shell": "run_bash",
                "terminal": "run_bash", "exec": "run_bash", "cat_file": "read_file",
                "create_file": "write_file", "edit_file": "write_file"}


def run_tool(name, args, workdir):
    name = TOOL_ALIASES.get(name, name)

    def g(*keys):
        for k in keys:
            if args.get(k):
                return args[k]
        return ""
    try:
        if name == "run_bash":
            cmd = g("cmd", "command")
            if not cmd:
                return "[error: empty command]"
            r = subprocess.run(cmd, shell=True, cwd=workdir, capture_output=True, text=True, timeout=300)
            out = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr else "")
            return (f"[exit {r.returncode}]\n{out}")[:MAX_OUT] or "[no output]"
        if name == "read_file":
            return (Path(workdir) / g("path", "file")).read_text()[:MAX_OUT]
        if name == "write_file":
            rel, content = g("path", "file"), g("content", "text")
            p = Path(workdir) / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            return f"[wrote {len(content)} bytes to {rel}]"
        return f"[unknown tool: {name}]"
    except Exception as e:
        return f"[tool error: {e}]"


def call_model(messages):
    body = json.dumps({"model": MODEL, "messages": messages, "tools": TOOLS, "stream": False,
        "think": THINK,
        "options": {"temperature": TEMP, "top_p": TOP_P, "top_k": TOP_K, "num_ctx": NUM_CTX, "num_predict": NUM_PREDICT}}).encode()
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"}), timeout=600) as r:
                return json.load(r).get("message", {})
        except Exception as e:
            last = e
            print(f"  [call error {attempt+1}: {e}] retry", flush=True)
    raise last


_FUNC_RE = re.compile(r"<function=([^>\s]+)>\s*(.*?)\s*</function>", re.DOTALL)
_PARAM_RE = re.compile(r"<parameter=([^>]+)>\s*(.*?)\s*</parameter>", re.DOTALL)


def _unescape(s):
    return s.replace("\\n", "\n").replace('\\"', '"').replace("\\t", "\t").replace("\\\\", "\\")


def lenient_json_args(body):
    """Recover args from JSON that is invalid due to LITERAL newlines inside a
    multi-line value (code content or heredoc cmd) — common with small models."""
    args = {}
    for key in ("path", "file", "filename"):
        m = re.search(rf'"{key}"\s*:\s*"([^"\n]+)"', body)
        if m:
            args["path"] = m.group(1)
            break
    for key in ("cmd", "command", "content", "text"):
        idx = body.find(f'"{key}"')
        if idx != -1:
            seg = body[idx + len(key) + 2:]
            c = seg.find(":")
            val = seg[c + 1:].lstrip()
            if val.startswith('"'):
                val = val[1:]
            val = re.sub(r'"\s*\}?\s*$', "", val)
            args["cmd" if key in ("cmd", "command") else "content"] = _unescape(val)
            break
    return args


def parse_content_tools(content):
    calls = []
    for name, body in _FUNC_RE.findall(content or ""):
        params = _PARAM_RE.findall(body)
        if params:
            args = {k.strip().lower(): v for k, v in params}
        else:
            args = {}
            m = re.search(r"\{.*\}", body, re.DOTALL)
            if m:
                try:
                    args = json.loads(m.group(0))
                except Exception:
                    args = lenient_json_args(body)
            else:
                args = lenient_json_args(body)
        calls.append({"function": {"name": name.strip().lower(), "arguments": args}})
    return calls


REQUIRED_FILES = ["src/engine/stats.ts", "src/app/api/stats/route.ts",
                  "tests/stats.e2e.test.ts", "tests/engine.stats.edge.test.ts"]


def run_acceptance(workdir):
    """Harness-side forced verification: the feature files MUST exist (absence of
    tests is NOT a pass), THEN the 3 checks must go green."""
    missing = [f for f in REQUIRED_FILES if not (Path(workdir) / f).exists()]
    if missing:
        return False, "FEATURE INCOMPLETE", "Required files missing (create them): " + ", ".join(missing)
    res = {}
    for label, cmd in (("test", "npm test"), ("lint", "npm run lint"), ("build", "npm run build")):
        try:
            r = subprocess.run(cmd, shell=True, cwd=workdir, capture_output=True, text=True, timeout=240)
            res[label] = (r.returncode == 0, (r.stdout + "\n" + r.stderr)[-1200:])
        except Exception as e:
            res[label] = (False, f"[{cmd} error: {e}]")
    all_pass = all(ok for ok, _ in res.values())
    summary = " | ".join(f"{k}:{'PASS' if ok else 'FAIL'}" for k, (ok, _) in res.items())
    detail = "\n".join(f"=== npm {k} ({'PASS' if ok else 'FAIL'}) ===\n{out}" for k, (ok, out) in res.items() if not ok)
    return all_pass, summary, detail[:MAX_OUT]


def changed_files(workdir):
    """Count real file changes under src/ and tests/ — mechanism-agnostic, so it
    catches files written via bash heredoc/patch, not just the write_file tool."""
    try:
        r = subprocess.run("git status --porcelain -- src tests", shell=True, cwd=workdir,
                           capture_output=True, text=True, timeout=30)
        return len([l for l in r.stdout.splitlines() if l.strip()])
    except Exception:
        return 0


def run_tests_only(workdir):
    """Fast inner-loop check: just `npm test`. Returns (ok, raw_output)."""
    try:
        r = subprocess.run("npm test", shell=True, cwd=workdir, capture_output=True, text=True, timeout=240)
        return r.returncode == 0, (r.stdout + "\n" + r.stderr)
    except Exception as e:
        return False, f"[npm test error: {e}]"


def format_errors(text):
    """Parse raw test/build output into a CRISP, localized, actionable list —
    so a small model gets a clear signal instead of 1200 chars of stack trace."""
    out = []
    for m in re.finditer(r'(?:File|❯)?\s*([\w./-]+\.(?:ts|tsx)):(\d+)(?::(\d+))?', text):
        loc = f"{m.group(1)}:{m.group(2)}" + (f":{m.group(3)}" if m.group(3) else "")
        out.append(("LOC", loc))
    for m in re.finditer(r'(Failed to resolve import\s+["\'][^"\']+["\'][^\n]*|Cannot find (?:module|name)[^\n.]+|Expected [^\n]+?but found[^\n]+|error TS\d+:[^\n]+|PARSE_ERROR[^\n]*)', text):
        out.append(("MSG", m.group(1).strip()[:160]))
    seen, lines = set(), []
    for kind, v in out:
        if v not in seen:
            seen.add(v)
            lines.append(f"- {v}")
    return "\n".join(lines[:10]) or text[-600:]


def main():
    workdir, task = sys.argv[1], Path(sys.argv[2]).read_text()
    max_steps = int(sys.argv[3]) if len(sys.argv) > 3 else 90

    messages = [{"role": "system", "content": SYSTEM.replace("{workdir}", workdir)},
                {"role": "user", "content": task}]
    phase = "explore"
    reads = writes = tests_run = fix_rounds = reads_impl = 0
    recent = []          # normalized recent calls for loop detection

    def nudge(text):
        messages.append({"role": "user", "content": text})
        print(f"  [HARNESS NUDGE] {text[:90]}", flush=True)

    for step in range(1, max_steps + 1):
        # ---- context trim (keep it small so the guardrails don't blow the window) ----
        tool_idxs = [i for i, m in enumerate(messages) if m.get("role") == "tool"]
        for i in tool_idxs[:-6]:
            if not messages[i].get("_stub"):
                messages[i]["content"] = "[old tool output trimmed]"
                messages[i]["_stub"] = True
        payload = [{k: v for k, v in m.items() if k != "_stub"} for m in messages]

        msg = call_model(payload)
        content = msg.get("content", "") or ""
        tool_calls = msg.get("tool_calls") or (parse_content_tools(content) if content else [])
        print(f"\n===== STEP {step} [{phase}] reads={reads} writes={writes} tests={tests_run} =====", flush=True)
        if content:
            print(f"[content] {content[:300]}", flush=True)
        messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")})

        # ---- DONE gate: never accept DONE unless the harness itself sees green ----
        if not tool_calls and "DONE:" in content:
            all_pass, summary, detail = run_acceptance(workdir)
            tests_run += 1
            print(f"  [HARNESS VERIFY on DONE] {summary}", flush=True)
            if all_pass:
                print("\n>>> AGENT FINISHED — ALL CHECKS PASS", flush=True)
                return
            nudge(f"NOT DONE — the acceptance checks fail ({summary}). Fix these, do not stop:\n{detail}")
            phase = "verify"
            continue

        if not tool_calls:
            nudge("Call a tool. If EXPLORE is done, start writing files with write_file.")
            continue

        # ---- execute, tracking phase signals + guardrails ----
        results = []
        for tc in tool_calls:
            fn = tc.get("function", {})
            name = TOOL_ALIASES.get(fn.get("name", ""), fn.get("name", ""))
            args = fn.get("arguments", {}) or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {"cmd": args}
            key = f"{name}:{json.dumps(args, sort_keys=True)[:120]}"

            cmdstr = str(args.get("cmd", ""))
            is_write = (name == "write_file") or (name == "run_bash" and bool(WRITE_BASH.search(cmdstr)))
            is_read = (not is_write) and ((name in READ_TOOLS) or (name == "run_bash" and bool(READ_BASH.match(cmdstr))))

            # scope guard
            if name == "run_bash" and OFFSCOPE.search(cmdstr):
                res = "[BLOCKED: off-task command. Stay on the Stats Dashboard feature: StatsEngine + API + dashboard UI + tests.]"
                print(f"  -> BLOCKED off-scope: {cmdstr[:60]}", flush=True)
                results.append(f"<tool_response>[{name}]\n{res}</tool_response>")
                continue

            # HARD read-block: once forced into implement, stop endless reading
            if is_read and phase in ("implement", "verify") and reads_impl >= 4:
                res = ("[BLOCKED: reading is disabled — you have read enough. CREATE the files NOW with "
                       "write_file, or `cat > <path> <<'EOF' ... EOF`. Do not read.]")
                print(f"  -> BLOCKED read (implement): {cmdstr[:50]}", flush=True)
                results.append(f"<tool_response>[{name}]\n{res}</tool_response>")
                continue

            print(f"  -> {name}({', '.join(f'{k}={str(v)[:40]}' for k,v in args.items())})", flush=True)
            res = run_tool(name, args, workdir)
            print(f"     {res[:150].strip()}", flush=True)
            results.append(f"<tool_response>[{name}]\n{res}</tool_response>")

            if is_write:
                writes += 1
                if phase == "explore":
                    phase = "implement"
            elif is_read:
                reads += 1
                if phase in ("implement", "verify"):
                    reads_impl += 1
            if name == "run_bash" and re.search(r"npm (run )?(test|lint|build)|vitest", cmdstr):
                tests_run += 1

            recent.append(key)

        messages.append({"role": "tool", "content": "\n".join(results)})

        # ---- loop breaker: same call 3x in the tail ----
        if len(recent) >= 3 and len(set(recent[-3:])) == 1:
            nudge("You are repeating the same action. STOP repeating it and do the NEXT step of the task.")
            recent.clear()

        # ---- phase transitions: mechanism-agnostic (count real file changes) ----
        nchanged = changed_files(workdir)
        if phase == "explore" and nchanged >= 1:
            phase = "implement"
        elif phase == "explore" and reads >= 12 and nchanged == 0:
            phase = "implement"
            nudge("Enough exploring. Now IMPLEMENT: create src/engine/stats.ts, "
                  "src/app/api/stats/route.ts, the dashboard edit, and the 3 test files "
                  "(tests/engine.stats.test.ts, tests/stats.e2e.test.ts, tests/engine.stats.edge.test.ts). "
                  "For imports, match the existing tests' pattern ('../src/...') or the '@/...' alias. Stop reading.")
        if phase == "implement" and nchanged >= 5:
            phase = "verify"

        # ---- DIRECTED VERIFY: the harness runs the checks itself and hands back CRISP errors ----
        if phase == "verify":
            fix_rounds += 1
            ok, raw = run_tests_only(workdir)
            tests_run += 1
            if ok:
                allp, summary, detail = run_acceptance(workdir)
                print(f"  [HARNESS VERIFY] test PASS -> {summary}", flush=True)
                if allp:
                    print("\n>>> ALL GREEN — DONE", flush=True)
                    return
                nudge("npm test passes but lint/build fail. Rewrite the offending file(s) with write_file "
                      "to fix EXACTLY these, nothing else:\n" + format_errors(detail))
            else:
                print(f"  [HARNESS VERIFY] test FAIL (round {fix_rounds})", flush=True)
                nudge("npm test FAILS. REWRITE the offending file(s) NOW with write_file to fix EXACTLY these "
                      "errors. Do not read, do not run commands — just fix and rewrite the file:\n" + format_errors(raw))
            if fix_rounds >= 30:
                print("\n>>> FIX BUDGET EXHAUSTED", flush=True)
                break

    # ---- ran out of steps / budget: report the harness's own verdict ----
    all_pass, summary, _ = run_acceptance(workdir)
    print(f"\n>>> END. Harness acceptance: {summary}", flush=True)


if __name__ == "__main__":
    main()
