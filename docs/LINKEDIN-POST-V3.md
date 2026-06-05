<!--
LINKEDIN — native post v3 (continuation del post v2)
~250 palabras / ~2200 chars
Tono: personal chileno, primera persona, opinado

ANTES DE PUBLICAR:
- [ ] Reemplazar [LINK MEDIUM V3] por la URL real
- [ ] Subir la hero image (docs/hero-v2-vs-v3.png) como adjunto
- [ ] Linkear el post v2 anterior en comentarios si todavía está viral
-->

La semana pasada conté el experimento v2: construí el mismo MVP con 5 agentes IA por $1.80 y 49 minutos.

Esta semana le agregué gentle-ai al stack y medí qué pasa.

gentle-ai es un overlay que se mete DENTRO de opencode: orquestador SDD + 10 sub-agentes + memoria persistente (Engram) + 12 skills curadas. No compite con Multica — vive una capa más abajo.

Misma feature, mismo repo, mismos agentes, mismos modelos. Única variable: el overlay activado.

Los números reales (medidos en OpenRouter):

→ Costo por issue: +60% ($0.45 → $0.72)
→ Tiempo por issue: +92% (12 min → 23 min)
→ Tests al cierre: +55% (31 → 48)
→ Scope violations: 0 (igual que v2)
→ Memorias persistidas: 0 → 3 (nuevo)

Lo más interesante: SDD no se activó en ninguno de los 3 issues. El orquestador decidió ir directo cada vez. El +60% costo es el overhead del overlay base — no del flujo SDD.

¿Qué me dio gentle-ai a cambio del overhead?

1. Memorias estructuradas con "Learned" insights. El Dev Motor articuló: "occupancyRate requires intersecting [rangeStart, rangeEnd) with daily 9-18 UTC window." Eso es razonamiento, no solo código.

2. Detección automática de specs mal escritos. El Dev Front caught que mi issue mencionaba un polling que no existía en el código. v2 no hacía esto.

3. Mejor calidad arquitectónica. Helpers extraídos con docstrings, separación clara.

El veredicto honesto:

→ NO uses gentle-ai si querés velocidad/costo mínimo o tus features son chicas.
→ SÍ usa gentle-ai si tu equipo necesita audit trail, memoria cross-session, o trabaja en features grandes con muchas decisiones de diseño.

No es marketing. Es trade-off velocidad vs razonamiento articulado.

El experimento completo, números medidos, repos públicos, en Medium 👇

[LINK MEDIUM V3]

#AgenticDevelopment #LLM #MultiAgent #AIDev #SoftwareEngineering
