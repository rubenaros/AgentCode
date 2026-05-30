# Reporte: Orquestación de Agentes de Codificación con Kanban + Modelos vía API

**Fecha:** 2026-05-24
**Objetivo:** Orquestar agentes y subagentes de codificación con metodología tipo Kanban, consumiendo modelos vía API más baratos que Claude pero a su nivel.

**Documentos relacionados:** [`multica-deep-dive.md`](./multica-deep-dive.md) — análisis profundo de Multica.

---

## 1. Resumen ejecutivo

- **Herramientas de orquestación recomendadas:**
  - **Multica** (open source Apache 2.0, self-hostable vía Docker) — tablero estilo Kanban con *squads*; **soporta Kimi de fábrica**; muy activo (~32k ⭐). Mejor encaje conceptual, pero **es una capa de orquestación pura: no gestiona modelos ni API keys** (cada CLI maneja su proveedor) y aún **no está production-hardened**. Detalle completo en [`multica-deep-dive.md`](./multica-deep-dive.md).
  - **Vibe Kanban** (open source Apache 2.0, 100% local vía `npx`) — más simple de arrancar; lanza agentes CLI con aislamiento por *git worktree*. En *sunsetting* comercial pero estable.
- **Capa de modelo:** el tablero NO elige el modelo; lo elige el agente CLI subyacente (Claude Code, Codex, Qwen Code…). El multi-proveedor se configura cambiando `base_url` + API key.
- **Modelos "nivel Claude, mucho más baratos":** **Kimi K2.6** (mejor balance), **MiniMax M2.5** (mejor precio), **DeepSeek V3.2** (más barato útil). Ninguno iguala a Opus 4.7, pero varios igualan/superan a Sonnet 4.6 a 5–50× menos costo.

---

## 2. Herramientas de orquestación Kanban + agentes

Tableros que unen *agentes coordinados* con metodología Kanban real (To Do → In Progress → Review → Done, asignación por rol, WIP).

| Herramienta | Dónde corre | Agentes soportados | Modelo de trabajo | Estado |
|---|---|---|---|---|
| **Multica** (`multica-ai/multica`) ✅ | Self-host vía **Docker** o Multica Cloud (pago) | Claude Code, Codex, Copilot CLI, OpenClaw, OpenCode, Hermes, Gemini, Pi, Cursor, **Kimi**, Kiro | *Squads*: agentes (y humanos) bajo un leader que decide quién toma cada tarea. Board con perfiles, comments, issues, blockers, progreso WebSocket | Open source Apache 2.0, **muy activo (~32k ⭐)**. Requiere Node 20+, pnpm 10.28+, Go 1.26+, Docker |
| **Vibe Kanban** (`BloopAI/vibe-kanban`) ✅ | **100% local** (`npx vibe-kanban`) | 10+: Claude Code, Codex, Qwen Code, Gemini, Copilot, Amp, Cursor, OpenCode, Droid | Asignas tareas; cada una en *git worktree* aislado → cero conflictos | Open source Apache 2.0, community-maintained (empresa bloop cerró; núcleo local sigue) |
| **Agent Kanban** (`saltbo/agent-kanban`) | Requiere **API hosteada** (`agent-kanban.dev`) | Claude Code, Codex, Gemini, Copilot, ACP (Hermes) | Leader/worker autónomo: líder planifica y asigna, workers reclaman y abren PRs. Identidad Ed25519 por agente | Activo |
| **Claw-Kanban** | Local | Claude Code, Codex CLI, Gemini CLI | Routing por rol con auto-asignación | Activo |
| **Operator** (`untra/operator`) | Local | Multi-agente multi-proyecto | Session wrappers | Activo |
| **Cline CLI** (modo Kanban) | Local/terminal | CLI-agnóstico | Tablero + terminal | Activo |

**Multica vs Vibe Kanban (los dos finalistas):**
- **Multica** gana en: soporte **Kimi de fábrica** (tu requisito de modelo barato), skills reutilizables, proyecto muy activo. Pierde en: setup más pesado (Docker + Node + pnpm + Go + Postgres), **no gestiona modelos** (cada CLI maneja su proveedor), y tiene **banderas de madurez** (API inestable, sin binding de repo, brechas de seguridad en v0.2.16, *squads* aún difusos). No production-hardened. Ver [`multica-deep-dive.md`](./multica-deep-dive.md).
- **Vibe Kanban** gana en: arranque trivial (`npx`, sin Docker), aislamiento por *git worktree*. Pierde en: está en *sunsetting* comercial (aunque el núcleo local sigue OSS).

Ambos corren self-hosted/local → el código no sale a servidores externos. En ambos, **el modelo lo elige el CLI subyacente**, no el tablero.

---

## 3. Frameworks para *construir* agentes (capa "motor", si algún día quieres lógica propia)

| Framework | Lenguaje | Multi-proveedor | Fuerte en |
|---|---|---|---|
| **Mastra** | TypeScript | "Model Router": +3.300 modelos / 94 proveedores. Sintaxis `"provider/model"` | Workflows como máquinas de estado, memoria 4 niveles, `.suspend()/.resume()` (human-in-the-loop), MCP nativo |
| **LangGraph** | Python/TS | Sí (vía LangChain) | Grafo dirigido explícito, checkpointing, el más probado en producción |
| **CrewAI** | Python | Sí | Roles (role/goal/backstory + crew). Rápido, menos control fino |
| **claude-flow / Ruflo** | TS+Rust/WASM | Optimizado Claude Code/Codex | "Hive-mind": reinas (estrategia/táctica/adaptativa) + workers paralelos, memoria SQLite compartida. ~31k ⭐ |

---

## 4. Modelos de codificación vía API + costos

Referencia de calidad: **SWE-bench Verified** (mayor = mejor). Precios en USD por 1M de tokens.

| Modelo | SWE-bench Verified | Precio in / out | Costo relativo | Notas |
|---|---|---|---|---|
| **Claude Opus 4.7** *(techo)* | **87.6%** | $5.00 / $25.00 | 1.0× (ref) | El máximo de calidad. Caro. |
| **Claude Sonnet 4.6** *(media)* | 79.6% | $3.00 / $15.00 | ~0.6× | El nivel real a batir. |
| **Gemini 3.1 Pro** | **80.6%** | $2.00 / $12.00 | ~0.45× | Mejor precio/perf de "marca grande". Bate a Sonnet. |
| 🥇 **Kimi K2.6** (Moonshot) | **80.2%** | **$0.60–0.95 / $2.50–4.00** · cache $0.16 | ~0.10–0.15× | Open-weight. API OpenAI **y** Anthropic-compatible. Mejor balance. Precio varía por versión/proveedor (verificar en API oficial). |
| 🥇 **MiniMax M2.5** | **80.2%** | **$0.30 / $1.20** | ~0.05× | Mejor precio/rendimiento puro. |
| 🥈 **GLM-4.7 / GLM-5** (Zhipu) | top open-weight | ~$0.50 / $0.52+ | ~0.08× | Mejor coding open-weight; self-hosteable. |
| 🥉 **DeepSeek V3.2** | 72–74% | **$0.28 / $0.42** | ~0.03× | El más barato útil. ~90% de la calidad. |
| ⚠️ **Qwen3-Coder 480B** | ~38% (SWE-bench **Pro**) | $0.28 – $1.00 | bajo | Mejor para autocompletado que para agentes. |

> **Advertencia de benchmarks:** "Verified" y "Pro" NO son comparables (Pro es más duro). En SWE-bench **Pro**: Kimi K2.6 = 58.6% vs Opus 4.7 = 64.3% — brecha estrecha.

### Endpoints (todos OpenAI-compatible salvo nota)

| Modelo | `base_url` |
|---|---|
| Kimi K2.6 | `https://api.moonshot.ai/v1` (oficial) · también OpenRouter / Baseten / Atlas Cloud |
| Qwen | `https://coding.dashscope.aliyuncs.com/v1` (plan coding) o Dashscope estándar |
| DeepSeek | `https://api.deepseek.com/v1` |
| MiniMax / GLM | vía proveedor oficial o gateway (OpenRouter) |
| Gateway unificado | OpenRouter `https://openrouter.ai/api/v1` (un solo formato para todos) |

---

## 5. Estimación de costos (escenario ilustrativo)

Supuesto: una tarea de codificación agéntica consume ≈ **60k tokens input + 20k tokens output** por iteración completa. Para **100 tareas/mes**:

| Modelo | Costo/tarea aprox. | Costo 100 tareas/mes |
|---|---|---|
| Claude Opus 4.7 | $0.80 | **$80** |
| Claude Sonnet 4.6 | $0.48 | $48 |
| Gemini 3.1 Pro | $0.36 | $36 |
| **Kimi K2.6** | **$0.086–0.137** | **~$8.6–13.7** |
| **MiniMax M2.5** | $0.042 | ~$4.2 |
| **DeepSeek V3.2** | $0.025 | ~$2.5 |

> Cálculo: `(60k/1M × in) + (20k/1M × out)`. Ej. Kimi (extremo bajo): `(0.06×$0.60)+(0.02×$2.50)=$0.086`; extremo alto ($0.95/$4.00): `$0.137`. Cifras de orden de magnitud — el consumo real depende de iteraciones, contexto y reintentos. **Kimi entrega ~nivel Sonnet a ~10× menos costo que Opus.**

---

## 6. Claude: API vs planes de suscripción

Decidir cómo consumir Claude (API medida vs suscripción plana) es clave en un esquema multi-agente.

### Precio API (por 1M tokens)

| Modelo | Input | Output | Nota |
|---|---|---|---|
| Haiku 4.5 | $1.00 | $5.00 | tareas simples |
| **Sonnet 4.6** | **$3.00** | **$15.00** | caballo de batalla |
| Opus 4.7 | $5.00 | $25.00 | crítico |

Output = 5× input en todos. Los tres traen ventana de **1M tokens sin recargo**.

### Palancas de descuento

| Optimización | Efecto en Sonnet | ¿Aplica a agentes Kanban? |
|---|---|---|
| **Prompt caching** | cache read 0.1× input (−90% en lo repetido); cache write 1.25× | ✅ Sí — system prompt + contexto del repo se reusan |
| **Batch API** | −50% en todo → Sonnet $1.50 / $7.50 | ⚠️ Solo trabajo NO interactivo |
| **Combinado** (batch+cache) | hasta −95% | Solo en batch |

Con prompt caching, una tarea de Sonnet (60k in + 20k out) baja de **$0.48 a ~$0.30–0.35**.

### Planes de suscripción

| Plan | Precio | Claude Code | Para qué |
|---|---|---|---|
| Free | $0 | No | Probar |
| **Pro** | $20/mes ($17 anual) | ✅ | 1 dev, uso moderado |
| **Max** | $100 (5×) / $200 (20×) /mes | ✅ | Dev intensivo |
| **Team** | $30/usuario/mes (Premium añade Claude Code) | ✅ Premium | Equipos |
| Enterprise | A medida | ✅ | Org grande |

### La decisión para orquestación multi-agente

- **Suscripción (Pro/Max):** tarifa plana, pero pensada para uso **interactivo** y con **rate limits** por ventana. Lanzar **N agentes en paralelo** choca con esos límites rápido.
- **API (medida):** pagas por token, sin tope artificial → escala para **orquestación paralela programática** (Multica/Vibe Kanban disparando N agentes).
- **Punto de cruce aprox.:** Max 5× ($100/mes) ≈ Sonnet API para ~200 tareas/mes con caching.

**Recomendación:** para Kanban + agentes en paralelo, usar **API directa** (Sonnet con prompt caching activado), reservando Max solo si además se trabaja interactivo en Claude Code a diario. Combinar con el routing por costo: Sonnet/Opus solo para lo crítico, Kimi/DeepSeek para el grueso.

### Comparativo API vs suscripción — todos los proveedores

Igual que Claude, varios proveedores ofrecen "coding plans" (tarifa plana, tipo Pro/Max) además de API medida.

| Proveedor | API (in / out /1M) | Plan suscripción (coding) | Paralelismo / nota |
|---|---|---|---|
| **Claude** | Sonnet $3/$15 · Opus $5/$25 | Pro $20 · Max $100/$200 /mes | Rate-limited → malo para paralelo masivo |
| **Kimi** (Moonshot) | K2.6 ≈ $0.60–0.95 / $2.50–4.00 · cache $0.16 | **Kimi Code** $19 · $39 · $99 · $199 /mes | ⭐ Tiers altos incluyen **Agent Swarm: hasta 300 subagentes en paralelo** |
| **GLM** (Zhipu) | GLM-5 $1.00/in · GLM-4.7 $0.60/in | **GLM Coding Plan** ≈ $10 · $30 · $80 /mes | Subió de precio (era $3 promo hasta feb-2026) |
| **Qwen / Alibaba** | vía Dashscope | **Alibaba AI Coding Plan** desde **$3/mes** | Multi-modelo: Qwen + Kimi + GLM + MiniMax en una sola sub |
| **DeepSeek** | V4 Flash $0.14/$0.28 · V4 Pro $1.74/$3.48 (promo $0.435/$0.87 hasta 31-may-2026) | ❌ **Sin suscripción** — solo API pay-per-token | Descuento off-peak (16:30–00:30 GMT); cache hit −98% |
| **MiniMax** | M2.x ($0.30/$1.20 aprox.) | vía bundle Alibaba | — |

> ⚠️ Precio Kimi K2.6: las fuentes difieren ($0.60/$2.50 vs $0.95/$4.00 según versión/proveedor). Verificar en la API oficial al integrar.

**Conclusiones del comparativo:**
- 🥇 **Para multi-agente en paralelo con tarifa plana → Kimi Code (Allegro $99 / Vivace $199):** su *Agent Swarm* (hasta 300 subagentes) es justo lo que Claude limita por rate limits. El mejor encaje "plan + orquestación".
- 🥈 **Para probar varios modelos barato → Alibaba AI Coding Plan ($3/mes):** una sub que cubre Qwen, Kimi, GLM y MiniMax.
- 🥉 **Para costo por token mínimo sin plan → DeepSeek API:** el más barato, pero solo medido (sin tarifa plana).
- **GLM Coding Plan** quedó en rango medio (~$10–80/mes) tras duplicar precio.

### Control de gasto en API (cómo no sobregirarse)

El modelo por defecto de la API es **prepago**, no postpago → es lo contrario a una factura abierta. Candados disponibles, de más fuerte a más fino:

| Mecanismo | Qué hace | Dónde |
|---|---|---|
| **Créditos prepagados (Tier 1)** | Cargas por adelantado ($5 mín, $500 máx/transacción). **Al agotarse, la API se detiene.** Imposible gastar más de lo depositado | Console → Billing |
| **Límite de gasto propio** | Tope mensual que tú fijas, bajo el techo del tier. Al alcanzarlo, las llamadas fallan hasta el otro mes | Console → Settings → Limits |
| **Techo del tier** | Tier 1 topa en **$500/mes** aunque no configures nada | automático |
| **Límites por Workspace** | Aíslas el proyecto de agentes en su workspace con tope de gasto y de rate propios | Console → Workspaces |
| **Página de Usage** | Gráficos en tiempo real de tokens, requests, costo y cache rate | Console → Usage |
| **Rate limits por tier** | Topan throughput (Tier 1 Sonnet: 30k tok-in/min, 8k out/min, 50 RPM) | automático |

⚠️ **No hay aviso automático antes de tocar el límite** — hay que monitorear. Receta segura: **prepago + límite de gasto fijado a mano**. Con esos dos, el sobregasto es matemáticamente imposible.

> **Bonus:** con prompt caching, los cache reads se cobran al **10%** y **no cuentan contra el rate limit** → baja costo y riesgo de throttle a la vez.

### ¿Se puede combinar el plan con la API? — No

La API y el plan (Pro/Max) son **sistemas de facturación separados**:
- Las llamadas a `api.anthropic.com` **siempre** se cobran por créditos API; **nunca** consumen del cupo del plan.
- El cupo del plan solo se usa en superficies oficiales (claude.ai, app, Claude Code con login OAuth).

⚠️ **Corte del 4-abril-2026:** Anthropic **cortó el acceso al cupo de suscripción para herramientas de terceros.** Multica, Vibe Kanban, OpenClaw, Mastra, etc. **deben facturar por API key** — no pueden usar el plan Max. → **La orquestación de agentes en paralelo va por API, sí o sí.**

⚠️ **Trampa de doble cobro:** si `ANTHROPIC_API_KEY` está en el entorno global, el Claude Code oficial la usa en silencio y te cobra por API, dejando el plan Max sin usar.

⚠️ **No hay fallback automático** plan→API al agotar el cupo (feature pedida, no implementada).

**La combinación que SÍ funciona — dividir por canal:**

| Trabajo | Canal | Costo |
|---|---|---|
| Codificación **interactiva** diaria (Claude Code oficial, OAuth) | **Plan Max** | fijo, predecible |
| **Agentes en paralelo** orquestados (Multica/Vibe Kanban) | **API (prepago + tope)** | variable, capado |

Para no caer en la trampa: **NO dejar `ANTHROPIC_API_KEY` en el entorno global**; scoparla solo al entorno del orquestador (su `docker-compose`/`.env`). Así el Claude Code personal sigue usando el plan y solo la flota automática gasta API prepagada.

---

## 7. Arquitectura recomendada

```
┌─────────────────────────────────────────────┐
│  Vibe Kanban (local)  —  tablero Kanban       │
│  To Do → In Progress → Review → Done          │
│  cada tarea = 1 git worktree aislado          │
└───────────────┬───────────────────────────────┘
                │ lanza agentes CLI
        ┌───────┴────────┬──────────────┐
        ▼                ▼              ▼
   Claude Code       Codex CLI      Qwen Code
   → Kimi K2.6       → DeepSeek     → Qwen
   (ANTHROPIC_       (OpenAI base_  (nativo)
    BASE_URL)         url)
```

**Estrategia de routing sugerida (por costo/calidad):**
- **Tareas críticas / arquitectura** → Claude Opus 4.7 o Sonnet 4.6.
- **Implementación general** → Kimi K2.6 (mejor balance).
- **Tareas triviales / boilerplate** → DeepSeek V3.2 o MiniMax M2.5.

---

## 8. Próximos pasos posibles

1. Levantar Vibe Kanban local (`npx vibe-kanban`) sobre un repo de prueba de bajo riesgo.
2. Wirear 2 agentes con 2 proveedores (ej. Claude Code→Kimi, Codex→DeepSeek).
3. Prueba A/B: misma tarea con 2 modelos, comparar calidad y costo real.

---

## 9. Fuentes

- Multica: [github.com/multica-ai/multica](https://github.com/multica-ai/multica) · [Review (AgentConn)](https://agentconn.com/blog/multica-open-source-managed-agents-platform-review/)
- Vibe Kanban: [github.com/BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) · [anuncio shutdown](https://www.vibekanban.com/blog/shutdown) · [Nimbalyst: qué pasa con los usuarios](https://nimbalyst.com/blog/vibe-kanban-after-bloop-whats-next/)
- Agent Kanban: [agent-kanban.dev](https://agent-kanban.dev/) · [github.com/saltbo/agent-kanban](https://github.com/saltbo/agent-kanban)
- Orquestadores: [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators) · [9 Open-Source Orchestrators (Augment)](https://www.augmentcode.com/tools/open-source-agent-orchestrators)
- Frameworks: [Mastra](https://github.com/mastra-ai/mastra) · [Mastra Models](https://mastra.ai/models) · [claude-flow/Ruflo](https://github.com/ruvnet/ruflo) · [Comparativa (Speakeasy)](https://www.speakeasy.com/blog/ai-agent-framework-comparison)
- Modelos/costos: [Kimi vs Opus/GPT (buildfastwithai)](https://www.buildfastwithai.com/blogs/kimi-k2-6-vs-gpt-claude-benchmarks) · [Kimi 10× más barato (Remio)](https://www.remio.ai/post/kimi-k2-6-landed-four-days-after-claude-opus-4-7-the-pricing-is-10-lower-and-it-s-open-weight) · [DeepSeek vs Qwen vs Kimi vs GLM (dev.to)](https://dev.to/truelane/deepseek-vs-qwen-vs-kimi-vs-glm-which-ai-api-actually-wins-in-2026-a-cost-optimizers-verdict-4235) · [Mejores modelos chinos 2026 (TokenMix)](https://tokenmix.ai/blog/best-chinese-ai-models-2026-comparison-guide) · [LLM API Comparison (Morph)](https://www.morphllm.com/llm-api)
- Pricing Claude: [Pricing oficial (platform.claude.com)](https://platform.claude.com/docs/en/about-claude/pricing) · [claude.com/pricing](https://claude.com/pricing) · [Anthropic API Pricing (Finout)](https://www.finout.io/blog/anthropic-api-pricing) · [Claude Code Pricing 2026 (Verdent)](https://www.verdent.ai/guides/claude-code-pricing-2026) · [Claude Code cost confusion (Simon Willison)](https://simonwillison.net/2026/apr/22/claude-code-confusion/)
- Coding plans (otros): [Kimi Code 2026 (NxCode)](https://www.nxcode.io/resources/news/kimi-code-2026-plans-pricing-developer-guide) · [Kimi API pricing (TokenMix)](https://tokenmix.ai/blog/kimi-k2-api-pricing) · [GLM Coding Plan (vibecoding)](https://vibecoding.app/blog/zhipu-ai-glm-coding-plan-review) · [Comparativo coding plans (codingplan.org)](https://codingplan.org/en/) · [DeepSeek pricing oficial](https://api-docs.deepseek.com/quick_start/pricing) · [Alibaba AI Coding Plan $3/mes (Emelia)](https://emelia.io/hub/alibaba-ai-coding-plan)
- Control de gasto / plan vs API: [Rate & spend limits (Claude API Docs)](https://platform.claude.com/docs/en/api/rate-limits) · [Usar Claude Code con Pro/Max (soporte)](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan) · [Manage usage credits (soporte)](https://support.claude.com/en/articles/12429409-manage-extra-usage-for-paid-claude-plans) · [Corte de cupo a terceros abr-2026 (Shareuhack)](https://www.shareuhack.com/en/posts/openclaw-claude-code-oauth-cost) · [Fallback feature request (GitHub #27990)](https://github.com/anthropics/claude-code/issues/27990)
