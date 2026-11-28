# AGENTS.md

Always-loaded context for AI agents. Keep it short. Full object catalog, math and deployment details live in `README.md` (read only the section you need).

## 1. Rules
- **Language**: Reply to the user in Spanish (Mexico). Code, JSDoc, comments, file names and documentation stay in English.
- **Safety**: Never run `suitecloud project:deploy` or `suitecloud file:upload` unless the user explicitly asks. `suitecloud project:validate` is allowed.
- **Source of truth**: `.js` files and `src/Objects/**/*.xml` win over any `.md` (including this file). If they conflict, trust the code and fix the doc.
- **Scope**: Do not modify `drt_ci_costo_venta_cs.js` or `src/Objects/Terceros/*` logic unless asked. Do not rename field IDs (typos are real IDs).
- **Rigor**: Distinguish verified facts (read in code/XML) from inferences. No invented internal IDs, price levels or record IDs.
- **Verification**: After a code change, re-read every caller of the changed function (see §3) and run `suitecloud project:validate` if the CLI is available.

## 2. Project snapshot
- NetSuite SDF `ACCOUNTCUSTOMIZATION`. SDF root `src/` (`suitecloud.config.js`). Auth ID `Almetal_PR` (`project.json`, production).
- Purpose: margin-discount hierarchy + cutting surcharge + intercompany (subsidiary customer) pricing on `estimate`, `salesorder`, `invoice`, `cashsale`.
- `src/deploy.xml` scope: `~/FileCabinet/SuiteScripts/sistema_margenes/*`, `~/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js`, `~/Objects/*`.
- All active code lives in `src/FileCabinet/SuiteScripts/sistema_margenes/` (4 files, ~1,000 lines total).

## 3. Context routing (read only what the task needs)
| Task | Read | Also update |
|---|---|---|
| Discount math / hierarchy rule | `CM_Margin_System_Core.js` | Duplicated inline rule in `UE_Margin_System_Keeper.js` `beforeSubmit`; callers in `CS_Margin_System.js` (`validateLine`, `evaluateLineRules`, `processLineRecalculation`) |
| Cutting surcharge tiers / minimum | `CM_Surcharge_System_Core.js` | `CS_Margin_System.js` `evaluateLineRules`; tier config injection in UE `beforeLoad` |
| UI behavior, price level forcing, dialogs | `CS_Margin_System.js` | — |
| Save-time validation, field injection, transform carry-over, Estimate buttons | `UE_Margin_System_Keeper.js` | — |
| Intercompany / subsidiary flow | `CM_Margin_System_Core.js#isSubsidiaryCustomer`, CS (`globalState.esSubsidiaria`, `postSourcing`), UE `beforeSubmit` | `src/Objects/Scripts/customscriptcs_margin_system.xml` (param `custscript_alm_price_lvl_subsidiaria`) |
| Field definition / sourcing / type | `src/Objects/Custom Fields/{Custbody,Custcol,Custentity,Custitem}/<id>.xml` | README §5 catalog |
| Script deployments / params | `src/Objects/Scripts/*.xml` | — |
| Freight levels / surcharge config records | `src/Objects/customrecord_*.xml`, `customlist_freigth_level_service.xml` | — |
| Legacy conflict analysis | `Margin_System_Diagnostic_Report.md`, `drt_ci_costo_venta_cs.js` | — |

Skip by default (large or historical): `.opencode/skills/**` (5 MB of generic NetSuite references; open a single reference file only when needed), `planes/**` (approved historical plans), `sistema_margenes/*.md` (stale release notes, wrong IDs), `src/manifest.xml`, `src/Objects/Terceros/**`.

## 4. Execution flow (summary; details in README §4)
1. **UE `beforeLoad` CREATE**: injects current user's `custentity_user_margin_limit` into `custbody_curr_user_discount_limit`; injects `customrecord_sang_conf_sobrecargos` ID `1` tiers (÷100) as JSON into `custbody_sang_hidden_surcharge_config`; `carryOverMarginState()` copies header/line margin fields from `createdfrom` (`estimate`/`salesorder`) by line index.
2. **UE `beforeLoad` VIEW**: `hideEstimateOnlyButtons()` (estimate only): term `2` hides `createsalesord`; terms `1`/`3` hide `createcashsale` and `createinvoice`.
3. **CS `pageInit`**: aborts if required body fields are missing (`isFieldAvailable`); loads limits into `globalState`; calls `handleCustomerChange` if `entity` is set.
4. **CS `handleCustomerChange`**: async lookup of customer limit, service-level record and `custentity_alm_check_intercompania`; sets `globalState.esSubsidiaria`; disables `custbody_freigth_service_terms` until resolved.
5. **CS `postSourcing`** (`item`/`units`): subsidiary → force `price` = script param (default `6`) and stop. Otherwise toggle `custcol_drt_sobre_cargo`, force `price` = `1`, wait for `price` sourcing, `backupBasePrice()` (rate → `custcol_precio_sin_margen`), then `evaluateLineRules`.
6. **CS `evaluateLineRules`**: base = `custcol_precio_sin_margen` (fallback `rate`); surcharge once per line; sets `price` = `-1`, `rate`, `amount`, `custcol_margen_aplicado`, `custcol_sang_monto_sobrecargo_apli`. Invalid → alert and clear discount.
7. **CS `validateLine`**: blocks line if `core.validateMarginRule` fails (skipped when `isRecalculating` or subsidiary).
8. **CS `handleTermsChange`**: stricter freight term + lines → confirm → `processLineRecalculation`; cancel → `setTimeout` rollback.
9. **UE `beforeSubmit`** CREATE/EDIT: skips subsidiary customers; otherwise validates each non Group/Kit/EndGroup line with discount > 0. Error names: `ERR_CAPACIDAD_ARTICULO_EXCEDIDA`, `ERR_LIMITE_CLIENTE_EXCEDIDO`, `ERR_LIMITE_USUARIO_EXCEDIDO`, wrapper `ERR_SISTEMA_MARGENES`.

## 5. Invariants and unit conventions
- `getValue` on PERCENT fields and `parseFloat(lookupFields(...))` both yield `0–100` (e.g. `15`). Callers divide by 100 before calling the core.
- `validateMarginRule` inputs: `descMargenSolicitado`, `descMargenServicio`, `limiteArticulo`, `limiteCliente`, `limiteUsuario` are decimals (`0.15`); `margenEstandar` stays `0–100`; output `appliedMargin` is `0–100`.
- Hierarchy order: (1) item `limiteArticulo`, (2) customer `limiteCliente * (1 - descMargenServicio)`, (3) user `limiteUsuario`.
- `margenAplicado <= 0` throws `MATH_DIV_BY_ZERO_PREVENTION` (uncaught in CS `fieldChanged`/`validateLine`).
- Price levels: `1` = Base, `-1` = Custom (set by margin logic), `6` = SUBSIDIARIAS (param default).
- Surcharge is a single fee per line: `amount = finalPrice * qty + surcharge`; `rate = amount / qty` (2 decimals).
- `globalState.isRecalculating = true` must wrap any automated line reset to avoid `validateLine` blocking.
- Freight list values: `1` = HOY, `2` = SIN ENVIO, `3` = 3 DIAS.
- Log prefixes for searching: `[CM_DEBUG]`, `[CM_WARN]`, `[CM_ERROR]`.

## 6. Critical gotchas
- **Exact IDs with typos**: `custbody_freigth_service_terms`, `customlist_freigth_level_service`, `custcol_mergn_desc_solicitado`, deployment IDs `customdeploy_*_margyn_*`.
- **Duplicated hierarchy logic**: UE `beforeSubmit` does not call `core.validateMarginRule`; it re-implements the rule inline. Change both or refactor.
- **User limit on save is not re-queried**: UE `beforeSubmit` reads `custbody_curr_user_discount_limit` from the record; only the customer is re-queried.
- **`custbody_curr_user_discount_limit` XML sources from the sales rep** (`STDBODYEMPLOYEE`), while UE overwrites it with the current user on CREATE.
- **`custcol_precio_sin_margen` has no sourcing in XML**; it is written only by CS `backupBasePrice()` and UE carry-over. `custitem_alm_preciofinal_cargos` is not read by any script.
- **`custentity_maxdiscount_margin_percent` is sourced** from `customrecord_sang_clasificacion_clientes.custrecord_sang_porcent_desc_cat` via `custentity_sang_clasi_cliente_ventas`.
- **Legacy conflict**: `drt_ci_costo_venta_cs.js` `validateLine` overwrites `rate`/`price` on line commit. Its deployments were deactivated in production (commit `5783017`), but `src/Objects/Terceros/customscript_drt_ci_costo_venta_cs.xml` still has `isdeployed=T` on 4 deployments. A full `project:deploy` re-activates them. Set them to `F` or exclude the file before any full deploy.
- `deploy.xml` uses `sistema_margenes/*`, so the `.md` release notes are uploaded to the File Cabinet too.
- `.gitignore` whitelists only `*.js`, `*.md`, `*.json`, `*.html`, `*.xml`, `.gitignore`. Other file types are silently untracked.

## 7. Known open issues (from code reading; confirm in sandbox before fixing)
| ID | Issue | Location |
|---|---|---|
| K1 | UE rules B/C compare a decimal discount (`0.15`) against `0–100` limits (`15`); they only block when the limit is `0`. CS enforces correctly. | `UE_Margin_System_Keeper.js` `beforeSubmit` |
| K2 | Switching an existing transaction to a subsidiary customer does not re-price existing lines (plan TC-03). | `CS_Margin_System.js` `handleCustomerChange` |
| K3 | Lines with `custcol_margen_estandar = 0` and any discount or surcharge throw `MATH_DIV_BY_ZERO_PREVENTION`. | `CM_Margin_System_Core.js` |
| K4 | `processLineRecalculation` ignores the cutting surcharge and does not set `amount`. | `CS_Margin_System.js` |
| K5 | Surcharge tiers use `||` fallbacks, so a configured `0` becomes the default (0.20/0.15/0.10/0.05). | `CM_Surcharge_System_Core.js` |
| K6 | Legacy deployments `isdeployed=T` in repo vs deactivated in production. | `src/Objects/Terceros/customscript_drt_ci_costo_venta_cs.xml` |

## 8. Commands
- `suitecloud project:validate` — validate manifest, objects and dependencies.
- `suitecloud project:deploy` — full deploy to `Almetal_PR` (explicit request only; check K6 first).
- `suitecloud file:upload --paths "/SuiteScripts/sistema_margenes/<file>.js"` — single-file upload (explicit request only).
- OpenCode commands: `.opencode/commands/validate-ns.md`, `.opencode/commands/sync-agents.md`.

## 9. Maintenance of this file
- Keep under 150 lines. Add new field/object IDs to README §5, not here, unless they are a gotcha.
- When a known issue is fixed, remove its row from §7 and update README §8.
