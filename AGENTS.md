# AGENTS.md

## Communication & Rules
- **Language**: Always respond to the user in Spanish. Keep code, JSDoc, comments, file names, and documentation in English.
- **Safety**: Never run `suitecloud project:deploy` or `suitecloud file:upload` unless explicitly instructed by the user.
- **Source of Truth**: Always trust `.js` source files and `src/Objects/*.xml` over stale `.md` files (`README.md`, `*_System.md`) when field IDs or hook behavior conflict.

## Project Overview
NetSuite **SuiteCloud Development Framework (SDF)** `ACCOUNTCUSTOMIZATION` project for Almetal's Integrated Margin & Cutting Surcharge System on `Estimate` transactions.
- **SDF Root**: `src/` (via `suitecloud.config.js`) | **Default Auth ID**: `Almetal_PR` (`project.json`)
- **Deploy Scope (`src/deploy.xml`)**: `~/FileCabinet/SuiteScripts/sistema_margenes/*` and `~/Objects/*`

## SuiteCloud CLI Commands
- `suitecloud project:validate` — Validate SDF manifest, XML objects, and dependencies.
- `suitecloud project:deploy` — Deploy full scope in `src/deploy.xml` to `Almetal_PR`.
- `suitecloud file:upload --paths "/SuiteScripts/sistema_margenes/<file>.js"` — Fast-upload a single script without full deploy.

## Architecture & Execution Flow (`src/FileCabinet/SuiteScripts/sistema_margenes/`)
1. **`UE_Margin_System_Keeper.js` (User Event — Server Guardian)**
   - `beforeLoad` (`CREATE`): Queries employee discount limit (`custentity_user_margin_limit`) and surcharge tiers (`customrecord_sang_conf_sobrecargos`, ID `1`), injecting them into `custbody_curr_user_discount_limit` and `custbody_sang_hidden_surcharge_config` (JSON) to avoid client-side governance overhead.
   - `beforeLoad` (`VIEW` on `estimate`): Hides `createsalesord` when `custbody_freigth_service_terms` is `'2'` (Sin Envío), or hides `createcashsale` and `createinvoice` when `'1'` (Hoy) or `'3'` (3 Días).
   - `beforeSubmit` (`CREATE` / `EDIT`): Re-queries employee and customer limits server-side (never trusts client body fields) and enforces the 3-level discount hierarchy across non-group/kit `item` lines.

2. **`CS_Margin_System.js` (Client Script — UI Controller)**
   - Caches limits, freight level reductions (`customrecord_margin_system_lvl_service`), and surcharge config in `globalState`.
   - `postSourcing` Cascade: When `item` or `units` changes, forces `price` to `1` (Base Price) with `ignoreFieldChange: false`, waits for `postSourcing` on `price`, snapshots `rate` into `custcol_precio_sin_margen`, then switches `price` to `-1` (Custom) for recalculations.
   - `globalState.isRecalculating`: Suppresses `validateLine` blocking during automated line resets or batch freight-term recalculations.

3. **`CM_Margin_System_Core.js` (Custom Module — Pure Margin Math, 0-governance)**
   - `validateMarginRule`: Callers convert UI percentages (`15` -> `0.15`) for `descMargenSolicitado`, `descMargenServicio`, `limiteArticulo`, `limiteCliente`, and `limiteUsuario`. `margenEstandar` stays `0–100` for `(precioBase * (100 - margenEstandar)) / 100`.
   - Enforces hierarchy in order: (1) Item capacity (`limiteArticulo`), (2) Customer limit penalized by freight level (`limiteCliente * (1 - descMargenServicio)`), (3) User authority (`limiteUsuario`).

4. **`CM_Surcharge_System_Core.js` (Custom Module — Cutting Surcharge Math, 0-governance)**
   - `calculateSurcharge`: Triggers when line units (`m`, `mt`, `mts`, `m2`) differ from base stock unit (`custcol_drt_unidad_stock`) and cutting flags (`custcol_sang_item_solicitar_corte`, `custcol_drt_sobre_cargo`) are active.
   - Applies tier factors (`rango1`..`rango4`) from `quantity / largoArticulo` with a **$15 MXN minimum per unit** floor.

## Critical Gotchas & Field ID Quirks
- **Exact Field IDs (include original typos)**:
  - Body: `custbody_freigth_service_terms` (read), `custbody_termino_entrega` (referenced in `CS_Margin_System.js` `handleTermsChange` rollback), `custbody_cust_serv_lvl`, `custbody_curr_user_discount_limit`, `custbody_sang_hidden_surcharge_config`.
  - Line: `custcol_mergn_desc_solicitado` (note `mergn` typo), `custcol_precio_sin_margen`, `custcol_drt_unidad_stock`, `custcol_sang_item_solicitar_corte`, `custcol_drt_sobre_cargo`.
- **Restrictive `.gitignore`**: Whitelists only `*.js`, `*.md`, and `.gitignore`. SDF XMLs (`src/Objects/*.xml`, `manifest.xml`, `deploy.xml`) and `project.json` are untracked on disk—never delete them as junk.
- **Legacy Script**: `src/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js` (`customscript_drt_ci_costo_venta_cs.xml`, undeployed) is superseded; do not touch unless requested.

## Modules Index (`src/FileCabinet/SuiteScripts/`)
- `sistema_margenes/UE_Margin_System_Keeper.js` — `UserEventScript` (2.1) | Imports: `N/search`, `N/runtime`, `N/error`
- `sistema_margenes/CS_Margin_System.js` — `ClientScript` (2.1) | Imports: `N/ui/dialog`, `N/search`, `./CM_Margin_System_Core`, `./CM_Surcharge_System_Core`
- `sistema_margenes/CM_Margin_System_Core.js` — `CustomModule` (2.1, `SameAccount`) | Imports: `N/error`, `N/log`
- `sistema_margenes/CM_Surcharge_System_Core.js` — `CustomModule` (2.1, `SameAccount`) | Imports: none (`[]`)
- `drt_ci_costo_venta_cs.js` — `ClientScript` (2.x, legacy/undeployed) | Imports: `N/runtime`, `N/search`, `N/ui/message`, `N/ui/dialog`

## Objects Index (`src/Objects/`)
- **Custom Records & Lists**
  - `customrecord_margin_system_lvl_service` (`customrecordtype`): Customer freight service level record; defines discount reduction fields `custrecord_client_serv_lvl`, `custrecord_serv_lvl_noenvio`, `custrecord_serv_lvl_enviohoy`, and `custrecord_serv_lvl_enviodias`.
  - `customlist_freigth_level_service` (`customlist`): Delivery service level options (`1` = `HOY`, `2` = `SIN ENVIO`, `3` = `3 DIAS`).
- **Entity Custom Fields (`entitycustomfield`)**
  - `custentity_user_margin_limit` (Employee, `PERCENT`): Maximum margin discount percentage an employee is authorized to grant.
  - `custentity_maxdiscount_margin_percent` (Customer, `PERCENT`): Maximum margin discount percentage allowed for the customer.
  - `custentity_custrec_service_level` (Customer, `SELECT` -> `customrecord_margin_system_lvl_service`): Links a customer to their freight service level record.
- **Item Custom Fields (`itemcustomfield`)**
  - `custitem_maxdiscount_margin_percent` (`PERCENT`): Maximum margin discount percentage allowed for the item.
  - `custitem_min_margin_value` (`FLOAT`): Minimum margin value for item sale validation.
- **Transaction Body Custom Fields (`transactionbodycustomfield`)**
  - `custbody_curr_user_discount_limit` (`PERCENT`): Active user's discount limit injected on `beforeLoad`.
  - `custbody_curr_cust_discount_limit` (`PERCENT`): Selected customer's maximum margin discount limit.
  - `custbody_cust_serv_lvl` (`PERCENT`): Active discount penalty percentage determined by the selected freight service level.
- **Transaction Column Custom Fields (`transactioncolumncustomfield`)**
  - `custcol_mergn_desc_solicitado` (`PERCENT`): Requested margin discount percentage on the line.
  - `custcol_precio_sin_margen` (`CURRENCY`, `LOCKED`, sourced from `custitem_alm_preciofinal_cargos`): Snapshot/backup of the native base price before margin discounts or surcharges.
  - `custcol_margen_estandar` (`FLOAT`, `LOCKED`, sourced from `custitem_drt_ci_margen_para_venta`): Item's standard sale margin percentage.
  - `custcol_margen_minimo_item` (`FLOAT`, `LOCKED`, sourced from `custitem_min_margin_value`): Item's minimum required margin on the line.
  - `custcol_margen_aplicado` (`FLOAT`): Final calculated margin percentage applied after discount.
- **Script Objects (`clientscript`)**
  - `customscript_drt_ci_costo_venta_cs`: Legacy Client Script definition for `/SuiteScripts/drt_ci_costo_venta_cs.js` (all deployments `isdeployed = F`, `status = TESTING`).