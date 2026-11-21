---
description: Audita cambios en SuiteScript (gobernanza, IDs y JSDoc) y ejecuta suitecloud project:validate
agent: plan
---
Revisa los cambios recientes en `src/FileCabinet/SuiteScripts/` verificando:
1. Unidades de gobernanza en bucles (`N/search`, `N/record`, `N/query`).
2. Coincidencia exacta de IDs contra `AGENTS.md` y `src/Objects/*.xml`.
3. JSDoc completo en funciones nuevas o modificadas.
Luego ejecuta `suitecloud project:validate` y resume cualquier advertencia en español.