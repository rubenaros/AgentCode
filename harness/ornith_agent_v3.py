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
import difflib
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

# Backend: "ollama" (native /api/chat) or "openai" (llama-server /v1/chat/completions).
# The PrismML llama.cpp fork (ternary Bonsai) only speaks the OpenAI shape.
BACKEND = os.environ.get("AGENT_BACKEND", "ollama").lower()
OLLAMA = "http://localhost:11434/api/chat"
BASE_URL = os.environ.get("AGENT_BASE_URL", "http://localhost:8080")
OPENAI_URL = BASE_URL.rstrip("/") + "/v1/chat/completions"
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
     When FIXING, use str_replace to change only the broken snippet — do NOT rewrite whole files.
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
    {"type": "function", "function": {"name": "str_replace",
        "description": "Edit a file IN PLACE: replace the exact snippet old_str with new_str. PREFER this over write_file for FIXES — send ONLY the small snippet that changes, never the whole file. The file must already exist.",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "old_str": {"type": "string"}, "new_str": {"type": "string"}}, "required": ["path", "old_str", "new_str"]}}},
]

READ_TOOLS = {"read_file"}
READ_BASH = re.compile(r"^\s*(cat|ls|head|tail|less|find|grep|rg|tree|wc|stat|pwd|echo)\b")
# a bash cmd that WRITES (heredoc, redirect, tee, patch) — takes precedence over READ_BASH
WRITE_BASH = re.compile(r"(>>?|\btee\b|<<|git\s+apply|\bpatch\b|sed\s+-i|mkdir|mv\b|cp\b)")
OFFSCOPE = re.compile(r"\b(wrangler|playwright|vercel|docker|next\s+(dev|start)|pages\s+dev|npx\s+create|create-next-app|serve|ngrok)\b", re.I)


TOOL_ALIASES = {"execute_bash": "run_bash", "bash": "run_bash", "shell": "run_bash",
                "terminal": "run_bash", "exec": "run_bash", "cat_file": "read_file",
                "create_file": "write_file", "edit_file": "write_file",
                "replace": "str_replace", "search_replace": "str_replace",
                "apply_patch": "str_replace", "edit": "str_replace"}


def apply_str_replace(text, old, new):
    """Replace `old` with `new` in `text`, tolerant to the whitespace drift small
    models produce. Returns (new_text, note) on success or (None, error_hint).
    On a miss it hands back the current file text around the closest line so the
    model can copy the exact snippet WITHOUT having to read the file (reads are
    blocked during implement/verify)."""
    if not old:
        return None, ('str_replace uses "old_str"/"new_str", NOT "content". Retry like: '
                      '{"path": "src/x.ts", "old_str": "<exact current snippet>", '
                      '"new_str": "<replacement>"}')
    exact = text.count(old)
    if exact == 1:
        return text.replace(old, new, 1), "exact"
    if exact > 1:
        return None, f'"old_str" matches {exact} places — add more surrounding context to make it unique'
    # whitespace-normalized line-block match (indentation/trailing drift)
    old_lines = [l.strip() for l in old.strip("\n").split("\n") if l.strip()]
    tlines = text.split("\n")
    norm = [l.strip() for l in tlines]
    L = len(old_lines)
    if L:
        hits = [i for i in range(len(norm) - L + 1) if norm[i:i + L] == old_lines]
        if len(hits) == 1:
            i = hits[0]
            nb = new.strip("\n").split("\n") if new else []
            return "\n".join(tlines[:i] + nb + tlines[i + L:]), "whitespace-normalized"
        if len(hits) > 1:
            return None, f'"old_str" (ignoring whitespace) matches {len(hits)} places — add more context'
    # no match: show the current text around the closest line
    anchor = next((l for l in old.split("\n") if l.strip()), "")
    best = difflib.get_close_matches(anchor.strip(), [l for l in norm if l], n=1, cutoff=0.5)
    if best:
        i = norm.index(best[0])
        lo, hi = max(0, i - 4), min(len(tlines), i + 6)
        ctx = "\n".join(f"{j + 1}: {tlines[j]}" for j in range(lo, hi))
        return None, ('"old_str" not found. Here is the current file near the closest line — '
                      'copy the EXACT text (real indentation) into old_str and retry:\n' + ctx)
    return None, '"old_str" not found — wrong file, or the text already changed'


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
            if not rel:
                return ('[error: write_file needs a non-empty "path". Put path FIRST, e.g. '
                        '{"path": "tests/x.test.ts", "content": "..."} — do not omit it.]')
            p = Path(workdir) / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            return f"[wrote {len(content)} bytes to {rel}]"
        if name == "str_replace":
            rel = g("path", "file")
            if not rel:
                return ('[error: str_replace needs a non-empty "path" — put it FIRST, e.g. '
                        '{"path": "src/x.ts", "old_str": "...", "new_str": "..."}]')
            p = Path(workdir) / rel
            if not p.exists():
                return f"[error: {rel} does not exist yet — create it with write_file first, then edit]"
            old, new = g("old_str", "old"), g("new_str", "new")
            updated, note = apply_str_replace(p.read_text(), old, new)
            if updated is None:
                return f"[str_replace failed on {rel}: {note}]"
            p.write_text(updated)
            return f"[edited {rel} ({note}) — {len(old)} chars -> {len(new)}]"
        return f"[unknown tool: {name}]"
    except Exception as e:
        return f"[tool error: {e}]"


def call_model(messages):
    if BACKEND == "openai":
        # llama-server is run WITHOUT --jinja: it does NOT parse tool calls, so we do
        # NOT send `tools` (they'd be ignored) and the model emits <tool_call> blocks
        # as raw content that the lenient parser below recovers. This is what makes the
        # loop robust: the server can no longer 500 on a big-`content` write with
        # unescaped JSON — it just returns the text, truncated at worst, and the
        # directed-verify loop makes the model rewrite it.
        url = OPENAI_URL
        payload = {"model": MODEL, "messages": messages, "stream": False,
            "temperature": TEMP, "top_p": TOP_P, "top_k": TOP_K, "max_tokens": NUM_PREDICT}
    else:
        url = OLLAMA
        payload = {"model": MODEL, "messages": messages, "tools": TOOLS, "stream": False,
            "think": THINK,
            "options": {"temperature": TEMP, "top_p": TOP_P, "top_k": TOP_K, "num_ctx": NUM_CTX, "num_predict": NUM_PREDICT}}
    body = json.dumps(payload).encode()
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}), timeout=600) as r:
                data = json.load(r)
                if BACKEND == "openai":
                    return (data.get("choices") or [{}])[0].get("message", {})
                return data.get("message", {})
        except Exception as e:
            last = e
            print(f"  [call error {attempt+1}: {e}] retry", flush=True)
    raise last


_FUNC_RE = re.compile(r"<function=([^>\s]+)>\s*(.*?)\s*</function>", re.DOTALL)
_PARAM_RE = re.compile(r"<parameter=([^>]+)>\s*(.*?)\s*</parameter>", re.DOTALL)


def _unescape(s):
    return s.replace("\\n", "\n").replace('\\"', '"').replace("\\t", "\t").replace("\\\\", "\\")


def _slice_field(body, start_key, stop_keys):
    """Recover one multiline string value from mangled JSON: slice from `start_key`'s
    marker up to whichever `stop_keys` marker comes next (or end of string)."""
    idx = body.find(f'"{start_key}"')
    if idx == -1:
        return None
    seg = body[idx + len(start_key) + 2:]
    c = seg.find(":")
    if c == -1:
        return None
    val = seg[c + 1:].lstrip()
    if val.startswith('"'):
        val = val[1:]
    cut = len(val)
    for sk in stop_keys:
        j = val.find(f'"{sk}"')
        if j != -1:
            cut = min(cut, j)
    val = val[:cut]
    val = re.sub(r'"\s*,?\s*$', "", val)          # trailing closing quote + comma
    val = re.sub(r'\s*\}+\s*$', "", val)           # trailing braces
    return _unescape(val)


def lenient_json_args(body):
    """Recover args from JSON that is invalid due to LITERAL newlines inside a
    multi-line value (code content or heredoc cmd) — common with small models."""
    args = {}
    for key in ("path", "file", "filename"):
        m = re.search(rf'"{key}"\s*:\s*"([^"\n]+)"', body)
        if m:
            args["path"] = m.group(1)
            break
    if "path" not in args:
        # this model appends a MANGLED path marker after the content, e.g.
        #   </path":"tests/x.test.ts"}}   or   </path>: "tests/x.test.ts"
        m = re.search(r'<\s*/?\s*path"?\s*[:>]*\s*"([^"\n]+)"', body)
        if m:
            args["path"] = m.group(1)
    if "path" not in args:
        # last resort: the LAST file-looking quoted token. The path trailer sits at the
        # END, so prefer the last match over any dotted string embedded in the content.
        ms = re.findall(r'"([\w./-]+\.[a-zA-Z0-9]+)"', body)
        if ms:
            args["path"] = ms[-1]
    # str_replace carries TWO multiline fields; recover each by slicing from its
    # marker to the next field marker (same technique as the single-content path).
    if '"old_str"' in body or '"new_str"' in body:
        o = _slice_field(body, "old_str", ("new_str", "path", "file"))
        nw = _slice_field(body, "new_str", ("old_str", "path", "file"))
        if o is not None:
            args["old_str"] = o
        if nw is not None:
            args["new_str"] = nw
        return args
    for key in ("cmd", "command", "content", "text"):
        idx = body.find(f'"{key}"')
        if idx != -1:
            seg = body[idx + len(key) + 2:]
            c = seg.find(":")
            val = seg[c + 1:].lstrip()
            if val.startswith('"'):
                val = val[1:]
            # This model frequently appends a MANGLED path marker AFTER the content
            # (content-first ordering), which must NOT land inside the written file:
            #   "content": "<code>\n</path>: "file.ts"}}     -> strip the </path... trailer
            #   "content": "<code>", "path": "file.ts"}       -> strip the ,"path":"..." trailer
            # Both are anchored to END-of-string so a legit mid-content "</path>" (SVG) survives.
            val = re.sub(r'\s*<\s*/?\s*path\b["\s:>]*"?[\w./-]*"?\s*\}*\s*$', "", val)
            val = re.sub(r'"\s*,\s*"(?:path|file|filename)"\s*:\s*"[^"]*"\s*\}*\s*$', "", val)
            val = re.sub(r'"\s*\}?\s*$', "", val)
            args["cmd" if key in ("cmd", "command") else "content"] = _unescape(val)
            break
    return args


_TOOLCALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)


def parse_toolcall_blocks(content):
    """Parse Qwen-style <tool_call>{json}</tool_call> blocks. The tags are the
    delimiter (not JSON braces), so big multi-line `content` with unescaped
    newlines/quotes is recovered via lenient_json_args when strict JSON fails."""
    calls = []
    for block in _TOOLCALL_RE.findall(content or ""):
        name_m = re.search(r'"name"\s*:\s*"([^"]+)"', block)
        if not name_m:
            continue
        name = name_m.group(1)
        try:
            obj = json.loads(block)
            args = obj.get("arguments", obj) if isinstance(obj, dict) else {}
            if not isinstance(args, dict):
                args = {}
        except Exception:
            args = lenient_json_args(block)
        calls.append({"function": {"name": name.strip().lower(), "arguments": args}})
    return calls


def parse_content_tools(content):
    tc = parse_toolcall_blocks(content)
    if tc:
        return tc
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

    system = SYSTEM.replace("{workdir}", workdir)
    if BACKEND == "openai":
        # tools are not sent in the request (see call_model) — describe them here
        system += ("\n\nTOOLS — to act, emit one or more blocks exactly like:\n"
                   "<tool_call>\n{\"name\": \"write_file\", \"arguments\": {\"path\": \"src/x.ts\", \"content\": \"<file contents>\"}}\n</tool_call>\n"
                   "Available: run_bash(cmd), read_file(path), write_file(path, content), "
                   "str_replace(path, old_str, new_str). "
                   "To FIX an existing file, PREFER str_replace with the small changed snippet — "
                   "do NOT rewrite the whole file. Use write_file only to CREATE a new file. "
                   "Emit the tool_call block(s) and nothing else when acting.")
        if not THINK:
            system += " /no_think"
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": task}]
    phase = "explore"
    reads = writes = tests_run = fix_rounds = reads_impl = 0
    recent = []          # normalized recent calls for loop detection

    def nudge(text):
        messages.append({"role": "user", "content": text})
        print(f"  [HARNESS NUDGE] {text[:90]}", flush=True)

    for step in range(1, max_steps + 1):
        # ---- context trim (keep it small so the guardrails don't blow the window) ----
        # Stub OLD tool outputs AND old assistant turns. The latter is critical: a model
        # that writes files echoes multi-KB `content`/tool_calls into assistant history;
        # left unchecked they fill the whole window (the files are on disk anyway, so the
        # history copy is dead weight). Keep the most recent few of each kind intact.
        tool_idxs = [i for i, m in enumerate(messages) if m.get("role") == "tool"]
        for i in tool_idxs[:-4]:
            if not messages[i].get("_stub"):
                messages[i]["content"] = "[old tool output trimmed]"
                # demote to user so it isn't orphaned once its assistant tool_calls get stubbed
                messages[i]["role"] = "user"
                messages[i].pop("tool_call_id", None)
                messages[i]["_stub"] = True
        asst_idxs = [i for i, m in enumerate(messages) if m.get("role") == "assistant"]
        for i in asst_idxs[:-3]:
            m = messages[i]
            if not m.get("_stub") and (len(m.get("content") or "") > 400 or m.get("tool_calls")):
                m["content"] = "[earlier assistant turn trimmed — files already written to disk]"
                m.pop("tool_calls", None)
                m["_stub"] = True
        payload = [{k: v for k, v in m.items() if k != "_stub"} for m in messages]

        msg = call_model(payload)
        content = msg.get("content", "") or ""
        native_tc = msg.get("tool_calls")
        tool_calls = native_tc or (parse_content_tools(content) if content else [])
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
            is_write = (name in ("write_file", "str_replace")) or (name == "run_bash" and bool(WRITE_BASH.search(cmdstr)))
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

        joined = "\n".join(results)
        if BACKEND == "openai" and not native_tc:
            # calls were recovered from content (no tool_call_id to reference) — feed back as user
            messages.append({"role": "user", "content": joined})
        elif BACKEND == "openai":
            tmsg = {"role": "tool", "content": joined}
            tcid = (native_tc[0] or {}).get("id")
            if tcid:
                tmsg["tool_call_id"] = tcid
            messages.append(tmsg)
        else:
            messages.append({"role": "tool", "content": joined})

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
                nudge("npm test passes but lint/build fail. Use str_replace to fix EXACTLY these in the "
                      "offending file(s) — change only the broken snippet, nothing else:\n" + format_errors(detail))
            else:
                print(f"  [HARNESS VERIFY] test FAIL (round {fix_rounds})", flush=True)
                nudge("npm test FAILS. Use str_replace NOW to fix EXACTLY these errors in the offending "
                      "file(s) — change only the broken snippet. Do not read, do not run commands, do not "
                      "rewrite whole files:\n" + format_errors(raw))
            if fix_rounds >= 30:
                print("\n>>> FIX BUDGET EXHAUSTED", flush=True)
                break

    # ---- ran out of steps / budget: report the harness's own verdict ----
    all_pass, summary, _ = run_acceptance(workdir)
    print(f"\n>>> END. Harness acceptance: {summary}", flush=True)


if __name__ == "__main__":
    main()
