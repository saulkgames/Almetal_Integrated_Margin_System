# AGENTS.md

## Communication & Rules
- **Language**: Always respond to the user in Spanish. Keep code, JSDoc, comments, file names, and documentation in English.
- **Safety**: Never run `suitecloud project:deploy` or `suitecloud file:upload` unless explicitly instructed by the user.
- **Source of Truth**: Always trust `.js` source files and `src/Objects/*.xml` over stale `.md` files (`README.md`, `*_System.md`) when field IDs or hook behavior conflict.

## Project Overview
NetSuite **SuiteCloud Development Framework (SDF)** `ACCOUNTCUSTOMIZATION` project for Almetal's Integrated Margin & Cutting Surcharge System on `Estimate`, `Sales Order`, `Invoice`, and `Cash Sale` transactions.
- **SDF Root**: `src/` (via `suitecloud.config.js`) | **Default Auth ID**: `Almetal_PR` (`project.json`)
- **Deploy Scope (`src/deploy.xml`)**: `~/FileCabinet/SuiteScripts/sistema_margenes/*`, `~/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js`, and `~/Objects/*`

## SuiteCloud CLI Commands
- `suitecloud project:validate` — Validate SDF manifest, XML objects, and dependencies.
- `suitecloud project:deploy` — Deploy full scope in `src/deploy.xml` to `Almetal_PR`.
- `suitecloud file:upload --paths "/SuiteScripts/sistema_margenes/<file>.js"` — Fast-upload a single script without full deploy.

## Architecture & Execution Flow (`src/FileCabinet/SuiteScripts/sistema_margenes/`)
1. **`UE_Margin_System_Keeper.js` (User Event — Server Guardian)** — Imports: `N/search`, `N/runtime`, `N/error`, `N/record`.
   - `beforeLoad` (`CREATE`): Injects employee discount limit (`custentity_user_margin_limit`) and surcharge tiers (`customrecord_sang_conf_sobrecargos`, ID `1`) into `custbody_curr_user_discount_limit` and `custbody_sang_hidden_surcharge_config` (JSON).
   - `beforeLoad` (`CREATE`) — Transform carry-over: `carryOverMarginState()` copies margin state (`custbody_*` header fields and `custcol_*` line fields, especially the sourced `custcol_precio_sin_margen`) from `createdfrom` (`estimate` or `salesorder`) so the Client Script re-derives from the correct base.
   - `beforeLoad` (`VIEW`): `hideEstimateOnlyButtons()` hides `createsalesord`/`createcashsale`/`createinvoice` exclusively on `estimate`; no replication on other records.
   - `beforeSubmit` (`CREATE` / `EDIT`): Re-queries employee and customer limits server-side and enforces the 3-level discount hierarchy across non-group/kit `item` lines.

2. **`CS_Margin_System.js` (Client Script — UI Controller)** — Imports: `N/ui/dialog`, `N/search`, `./CM_Margin_System_Core`, `./CM_Surcharge_System_Core`.
   - Caches limits, freight level reductions (`customrecord_margin_system_lvl_service`), and surcharge config in `globalState`.
   - `pageInit`: Loads injected user limit, current customer limit, service-level reduction, and hidden surcharge config; validates that required body fields exist via `isFieldAvailable()` before accessing them. Triggers `handleCustomerChange` if a customer is already selected.
   - `handleCustomerChange`: Fetches `custentity_maxdiscount_margin_percent` and `custentity_custrec_service_level` asynchronously, stores the service-level record ID in `custbody_customer_level_service_rec`, populates `globalState.nivelesEnvio`, and temporarily disables `custbody_freigth_service_terms` until the promise resolves.
   - `fieldChanged`: Reacts to `entity`, `custbody_freigth_service_terms`, and line fields `custcol_mergn_desc_solicitado`, `price`, `quantity`, and `custcol_drt_sobre_cargo`.
   - `postSourcing` Cascade: When `item` or `units` changes, toggles `custcol_drt_sobre_cargo` if the transaction unit differs from stock unit and is one of `m`, `mt`, `mts`, `m2`; then forces `price` to `1` (Base Price) with `ignoreFieldChange: false`, waits for `postSourcing` on `price`, snapshots `rate` into `custcol_precio_sin_margen`, then switches `price` to `-1` (Custom) for recalculations.
   - `evaluateLineRules`: Uses the frozen `custcol_precio_sin_margen` as the immutable base price. Calculates cutting surcharge via `CM_Surcharge_System_Core` as a **single global per-cut fee** (not per unit) and adds it once to the line total. Restores the native base price when both discount and surcharge are zero.
   - `validateLine`: Invokes `core.validateMarginRule` and blocks the line if any hierarchy limit is exceeded.
   - `globalState.isRecalculating`: Suppresses `validateLine` blocking during automated line resets or batch freight-term recalculations.
   - `handleTermsChange`: Detects reductions in discount capacity when `custbody_freigth_service_terms` changes; if the new term is stricter and lines exist, confirms with the user and recalculates affected lines down to the new allowed limit. If the user cancels, the rollback restores `custbody_freigth_service_terms` to the previous value via `setTimeout`.

3. **`CM_Margin_System_Core.js` (Custom Module — Pure Margin Math, 0-governance)**
   - `validateMarginRule`: Callers convert UI percentages (`15` -> `0.15`) for `descMargenSolicitado`, `descMargenServicio`, `limiteArticulo`, `limiteCliente`, and `limiteUsuario`. `margenEstandar` stays `0–100` for `(precioBase * (100 - margenEstandar)) / 100`.
   - Enforces hierarchy in order: (1) Item capacity (`limiteArticulo`), (2) Customer limit penalized by freight level (`limiteCliente * (1 - descMargenServicio)`), (3) User authority (`limiteUsuario`).
   - Throws `MATH_DIV_BY_ZERO_PREVENTION` if the computed `margenAplicado` is `<= 0` to avoid division by zero in `precioFinal = costo * (100 / (100 - margenAplicado))`.

4. **`CM_Surcharge_System_Core.js` (Custom Module — Cutting Surcharge Math, 0-governance)**
   - `calculateSurcharge`: Triggers when line units (`m`, `mt`, `mts`, `m2`) differ from base stock unit (`custcol_drt_unidad_stock`) and cutting flags (`custcol_sang_item_solicitar_corte`, `custcol_drt_sobre_cargo`) are active.
   - Applies tier factors (`rango1`..`rango4`) from `quantity / largoArticulo` with a **$15 MXN minimum per unit** floor. The caller (`CS_Margin_System.js`) treats the returned value as a **single global cut fee**, not a per-unit charge.

## Critical Gotchas & Field ID Quirks
- **Exact Field IDs (include original typos)**:
  - Body: `custbody_freigth_service_terms` (read / rollback target in `CS_Margin_System.js`), `custbody_cust_serv_lvl`, `custbody_curr_user_discount_limit`, `custbody_curr_cust_discount_limit`, `custbody_customer_level_service_rec`, `custbody_sang_hidden_surcharge_config`.
  - Line: `custcol_mergn_desc_solicitado` (note `mergn` typo), `custcol_precio_sin_margen`, `custcol_maxdiscount_margin_percent`, `custcol_drt_unidad_stock`, `custcol_sang_item_solicitar_corte`, `custcol_sang_hidden_item_largo`, `custcol_drt_sobre_cargo`, `custcol_sang_monto_sobrecargo_apli`, `custcol_margen_estandar`, `custcol_margen_minimo_item`, `custcol_margen_aplicado`.
- **`.gitignore`**: Whitelists `*.js`, `*.md`, `*.json`, `*.html`, `*.xml`, and `.gitignore`. SDF XMLs (`src/Objects/**/*.xml`, `manifest.xml`, `deploy.xml`) and `project.json` are now tracked.
- **Object folder layout**: Objects are organized under `src/Objects/Custom Fields/{Custitem,Custbody,Custcol,Custentity}/`, `src/Objects/Scripts/`, `src/Objects/Terceros/`, plus record/list XMLs at `src/Objects/`. `deploy.xml` references `~/Objects/*`.
- **Legacy Script**: `src/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js` (`customscript_drt_ci_costo_venta_cs.xml`) is superseded by the margin system; per the downloaded object it is currently deployed (`isdeployed=T`) to `SALESORDER`, `INVOICE`, `CASHSALE`, and `ESTIMATE`. Its file is included in `deploy.xml` only to keep SDF validation clean; do not modify its logic unless requested.

## Modules Index (`src/FileCabinet/SuiteScripts/`)
- `sistema_margenes/UE_Margin_System_Keeper.js` — `UserEventScript` (2.1) | Imports: `N/search`, `N/runtime`, `N/error`, `N/record`
- `sistema_margenes/CS_Margin_System.js` — `ClientScript` (2.1, `SameAccount`) | Imports: `N/ui/dialog`, `N/search`, `./CM_Margin_System_Core`, `./CM_Surcharge_System_Core`
- `sistema_margenes/CM_Margin_System_Core.js` — `CustomModule` (2.1, `SameAccount`) | Imports: `N/error`, `N/log`
- `sistema_margenes/CM_Surcharge_System_Core.js` — `CustomModule` (2.1, `SameAccount`) | Imports: none (`[]`)
- `drt_ci_costo_venta_cs.js` — `ClientScript` (2.x, legacy/undeployed) | Imports: `N/runtime`, `N/search`, `N/ui/message`, `N/ui/dialog`

## Objects Index (`src/Objects/`)
- **Custom Records & Lists**
  - `customrecord_margin_system_lvl_service` (`customrecordtype`): Customer freight service level record; defines discount reduction fields `custrecord_client_serv_lvl`, `custrecord_serv_lvl_noenvio`, `custrecord_serv_lvl_enviohoy`, and `custrecord_serv_lvl_enviodias`.
  - `customrecord_sang_conf_sobrecargos` (`customrecordtype`): Surcharge tier configuration; fields `custrecord_sang_sc_rango1`..`custrecord_sang_sc_rango4` are `FLOAT` (not percent) and are divided by 100 in `UE_Margin_System_Keeper.js` before JSON injection.
  - `customrecord_sang_clasificacion_clientes` (`customrecordtype`): Customer discount classification record; fields `custrecord_sang_categoria_clasi_cli` (SELECT -> `customlist_sang_list_clasifi_client`) and `custrecord_sang_porcent_desc_cat` (PERCENT). Not currently consumed by the active margin scripts.
  - `customlist_freigth_level_service` (`customlist`): Delivery service level options (`1` = `HOY`, `2` = `SIN ENVIO`, `3` = `3 DIAS`).
- **Entity Custom Fields (`entitycustomfield`)**
  - `custentity_user_margin_limit` (Employee, `PERCENT`): Maximum margin discount percentage an employee is authorized to grant.
  - `custentity_maxdiscount_margin_percent` (Customer, `PERCENT`): Maximum margin discount percentage allowed for the customer.
  - `custentity_custrec_service_level` (Customer, `SELECT` -> `customrecord_margin_system_lvl_service`): Links a customer to their freight service level record.
- **Item Custom Fields (`itemcustomfield`)**
  - `custitem_maxdiscount_margin_percent` (`PERCENT`): Maximum margin discount percentage allowed for the item.
  - `custitem_min_margin_value` (`FLOAT`): Minimum margin value for item sale validation.
  - `custitem_alm_preciofinal_cargos` (`CURRENCY`): Stored final price with charges; sourced into `custcol_precio_sin_margen`.
- **Transaction Body Custom Fields (`transactionbodycustomfield`)**
  - `custbody_curr_user_discount_limit` (`PERCENT`): Active user's discount limit injected on `beforeLoad`.
  - `custbody_curr_cust_discount_limit` (`PERCENT`): Selected customer's maximum margin discount limit.
  - `custbody_cust_serv_lvl` (`PERCENT`): Active discount penalty percentage determined by the selected freight service level.
  - `custbody_customer_level_service_rec` (`TEXT`, `LOCKED`): Internal storage of the customer's `customrecord_margin_system_lvl_service` record ID.
  - `custbody_sang_hidden_surcharge_config` (`TEXTAREA`, `HIDDEN`): JSON payload with surcharge tier decimals injected on `beforeLoad`.
  - `custbody_freigth_service_terms` (`SELECT` -> `customlist_freigth_level_service`, mandatory): Delivery service level selector on the Estimate body.
- **Transaction Column Custom Fields (`transactioncolumncustomfield`)**
  - `custcol_mergn_desc_solicitado` (`PERCENT`): Requested margin discount percentage on the line.
  - `custcol_precio_sin_margen` (`CURRENCY`, `LOCKED`, sourced from `custitem_alm_preciofinal_cargos`): Snapshot/backup of the native base price before margin discounts or surcharges.
  - `custcol_maxdiscount_margin_percent` (`PERCENT`, `LOCKED`, sourced from `custitem_maxdiscount_margin_percent`): Item discount capacity on the line.
  - `custcol_margen_estandar` (`FLOAT`, `LOCKED`, sourced from `custitem_drt_ci_margen_para_venta`): Item's standard sale margin percentage.
  - `custcol_margen_minimo_item` (`FLOAT`, `LOCKED`, sourced from `custitem_min_margin_value`): Item's minimum required margin on the line.
  - `custcol_margen_aplicado` (`FLOAT`): Final calculated margin percentage applied after discount.
  - `custcol_sang_item_solicitar_corte` (`CHECKBOX`, `LOCKED`, sourced from `custitem_drt_nc_solicitar_corte`): Flags whether the item requires cutting.
  - `custcol_sang_hidden_item_largo` (`FLOAT`, `HIDDEN`, sourced from `custitem_drt_cp_largo`): Item length used in surcharge ratio calculation.
  - `custcol_sang_monto_sobrecargo_apli` (`CURRENCY`, `LOCKED`): Amount of the cutting surcharge applied to the line.
  - `custcol_drt_sobre_cargo` (`CHECKBOX`): UI toggle that activates cutting surcharge logic.
  - `custcol_drt_unidad_stock` (`SELECT`, `LOCKED`): Item stock unit reference.
- **Script Objects (`usereventscript` / `clientscript`)**
  - `customscriptue_margin_system_keeper` (`usereventscript`): Definition for `UE_Margin_System_Keeper.js`; deployed to `ESTIMATE`, `SALESORDER`, `INVOICE`, `CASHSALE` (`runasrole=ADMINISTRATOR`).
  - `customscriptcs_margin_system` (`clientscript`): Definition for `CS_Margin_System.js`; deployed to `ESTIMATE`, `SALESORDER`, `INVOICE`, `CASHSALE`.
  - `customscript_drt_ci_costo_venta_cs` (`clientscript`): Legacy Client Script definition for `/SuiteScripts/drt_ci_costo_venta_cs.js`; deployed to `SALESORDER`, `INVOICE`, `CASHSALE`, `ESTIMATE` (`isdeployed=T`).
