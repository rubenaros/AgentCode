# Baseline v4 — comparación contra v2

Resultado del re-run del Stats Dashboard con el entorno actualizado, medido contra
el baseline **v2**. El v3 se descarta como comparación.

**Por qué contra v2 y no v3:** el v3 contó la historia "agregar el overlay gentle-ai
cuesta +60% costo / +92% tiempo sobre v2". El v4 da vuelta esa historia: con el runner
y el orquestador actualizados, el stack **con** overlay ya le gana al v2 **sin** overlay.
La pregunta del v4 es de producto — *¿el stack actual completo le gana al mejor setup
viejo?* — no un experimento de una sola variable.

## Entornos

| Capa | v2 (baseline) | v4 |
|---|---|---|
| Multica | 0.3.x (vieja) | **0.3.17** |
| opencode | 1.15.x (vieja) | **1.16.2** |
| gentle-ai overlay | **ausente** | **1.34.1 (activo)** |
| Modelos | Kimi K2.6 + DeepSeek V3.2 (OpenRouter) | igual |

> ⚠️ v4-vs-v2 mueve varias variables a la vez (overlay + opencode + Multica). No es un
> experimento controlado: es una comparación de producto entre el stack actual completo
> y el baseline v2. El v3 (overlay sobre versiones viejas) aislaba el overlay; acá no.

## Resultados reales (facturado en OpenRouter)

Ambas corridas se miden con costo **facturado por OpenRouter**, no computado por opencode
(opencode subcuenta ~1.5× — ver Hallazgos).

| Métrica | v2 (sin overlay) | v4 (overlay + upgrades) | Δ |
|---|---|---|---|
| **Costo / issue** | $0.45 | **~$0.32** | **−29%** |
| **Tiempo / issue** (wall-clock) | ~12 min | **7.9 min** (8.2 / 9.2 / 6.3) | **−34%** |
| **Memorias Engram estructuradas** | 0 | **3** | overlay, gratis |
| Costo total de la corrida | $1.80 (4 issues) | $1.47 (3 issues, incl. incidente) | — |
| Costo productivo | $1.80 | ~$0.96 | — |
| Tests al cierre | 31 | 44 | scope distinto* |

\* Los tests no son comparables como "mejora": v2 = MVP completo (4 issues); v4 = feature
Stats sobre la base v2 (3 issues). Miden alcances diferentes.

## Veredicto

**En el v3, el overlay era un impuesto (+60% costo / +92% tiempo sobre v2). En el v4 ese
impuesto desapareció:** el stack **con** overlay corre **−29% más barato y −34% más rápido
por issue** que el v2 **sin** overlay — y encima entrega 3 memorias estructuradas en Engram
que el v2 no producía.

**Driver probable:** el caching de opencode 1.16.2 (la corrida movió 5.24M tokens; DeepSeek
solo, 2.72M tokens por $0.28). La eficiencia del runner nuevo tapó el overhead del overlay
y lo dejó por debajo del baseline.

**Titular:** *con el runner actualizado, la memoria persistente + la maquinaria SDD del
overlay dejaron de costar — salen netas-negativas contra el setup viejo sin overlay.*

## Caveats honestos (para el artículo)

1. **No es single-variable.** v4 cambió overlay + opencode + Multica respecto de v2. La
   mejora no se puede atribuir a una sola pieza. Es comparación de producto, no experimento.
2. **Features distintos.** v2 (MVP de 4 issues) vs v4 (Stats de 3 issues). El costo/tiempo
   por issue depende de la complejidad del issue → hay ruido en la normalización.
3. **n = 1.** Una corrida de cada lado.
4. **El incidente de key-limit costó caro:** ~$0.51 (≈35% del gasto v4) se quemó en
   intentos fallidos del QA cuando la key de OpenRouter tocó su límite total. Es fricción
   operativa real, no inherente al stack — pero parte de la historia.

## Hallazgos operativos

- **opencode subcuenta el costo ~1.5×** (Kimi 1.5×, DeepSeek 1.3×) vs lo facturado por
  OpenRouter. No usar el cost tracker de opencode para presupuestar; usar el dashboard.
- **Multica 0.3.17, gap de dispatch en paralelo:** disparar dos issues seguidos despachó
  uno limpio; el otro quedó trabado. `multica issue rerun <id>` re-encola; re-asignar al
  mismo agente es idempotente y NO re-dispara.
- **Límite de key por-key en OpenRouter:** "Key limit exceeded (total limit)" es el tope
  de gasto de *esa* key específica (no los créditos de la cuenta). El error linkea la key
  exacta a editar.

## Procedencia de los números

- v4 costo: dashboard de OpenRouter (Activity, Past 3 Hours), $1.47 total facturado.
- v4 tiempo: timestamps de `multica issue runs` (started → completed) de las 3 runs exitosas.
- v4 memorias: Engram, proyecto `petdesk-v2`, ventana de la corrida.
- v2: `docs/QUE-APRENDIMOS-V2.md` Anexo A ($1.80 OpenRouter, ~49 min, 31 tests).
- Rama del feature: petdesk-v2 `v4-baseline` (599749d6 + PRs #8/#9/#10).
