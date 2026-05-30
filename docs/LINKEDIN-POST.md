<!--
LINKEDIN — native post (no artículo)
~280 palabras / ~2400 chars (debajo del límite de 3000)
Tono: personal chileno, opinado, primera persona

ESTRATEGIA:
- Primeras 2 líneas = HOOK visible antes del "ver más"
- Listas con bullets (→ o •) → LinkedIn las renderiza limpio
- Línea en blanco entre cada bloque → mejora legibilidad en mobile
- 1 emoji al inicio del CTA (mejora click rate sin saturar)
- 5 hashtags al final (LinkedIn premia 3-5, castiga más)

ANTES DE PUBLICAR:
- [ ] Reemplazar [LINK MEDIUM] por la URL real cuando publiques el artículo
- [ ] (Opcional) Subir la hero image (docs/hero-v1-vs-v2.png) como adjunto del post
       → más engagement que solo texto, LinkedIn la muestra como card grande
-->

Construí el mismo MVP dos veces con 5 agentes IA orquestados en paralelo.
La segunda vez me costó $1.80 y 49 minutos.

La primera vuelta (v1) fue dolor:
→ 3 horas de reloj
→ $4.21 quemados en OpenRouter
→ 12 intervenciones mías (cada merge, cada asignación)
→ 1 agente que ejecutó `create-next-app` y me borró el repo

La segunda vuelta (v2), aplicando 4 patrones:
→ 49 minutos
→ $1.80
→ 3 intervenciones humanas
→ 0 violaciones de scope, 0 basura commiteada
→ +72% de cobertura de tests (de 18 a 31)

Los 4 patrones, sin instalar OpenSpec ni Spec-Kit (sí, los probé):

1. Template completo antes de invocar agentes. Scaffold + configs + CI + .gitignore listos.
2. Contratos como tests ejecutables con fast-check, no como markdown que el LLM "debería seguir".
3. CONSTITUTION.md con reglas duras + CODEOWNERS sobre src/domain/.
4. Cost routing por agente. Frontend en DeepSeek V3.2 (4× más barato), lógica en Kimi K2.6.

Las 3 lecciones que destilé:

• El arquitecto define contratos y scaffoldea. El agente nunca toca esos archivos.
• "No toques X" no es contrato — es una sugerencia que el LLM ignora cuando le conviene.
• Los costos reales son 3-5× las estimaciones single-call. Mide en OpenRouter, no estimes.

Stack: Multica self-host (32k ⭐ en GitHub) + Kimi K2.6 + DeepSeek V3.2 vía OpenRouter + GitHub + Vercel.

Escribí el experimento completo (los 12 errores que cometí, los patrones que aplicé, los snippets reales) en Medium 👇

[LINK MEDIUM]

#AgenticDevelopment #LLM #SoftwareEngineering #MultiAgent #AIDev
