# AGENTS.md

## Communication and safety rules
- Always respond to the user in Spanish. Keep source code, JSDoc, comments, file names, and repository documentation in English.
- Never run `suitecloud project:deploy` or `suitecloud file:upload` unless the user explicitly authorizes that operation.
- Use `.js` source files and `src/Objects/**/*.xml` as the source of truth. Older script-specific Markdown notes may contain stale field IDs or behavior.
- Do not assume live NetSuite deployment state from this repository. Check the target account before changing or deploying scripts.

## Project overview
- NetSuite SuiteCloud Development Framework (SDF) `ACCOUNTCUSTOMIZATION` project for Almetal's Integrated Margin and Cutting Surcharge System.
- Transactions: Estimate, Sales Order, Invoice, and Cash Sale.
- SDF project root: `src/` (`suitecloud.config.js`); default authentication ID: `Almetal_PR` (`project.json`).
- `src/deploy.xml` includes all files in `~/FileCabinet/SuiteScripts/sistema_margenes/*`, the legacy `~/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js`, and `~/Objects/*`.
- Run `suitecloud project:validate` for local SDF validation when appropriate. Deployment and file upload require explicit user authorization.

## Current architecture

### Active margin-system scripts

1. **`src/FileCabinet/SuiteScripts/sistema_margenes/UE_Margin_System_Keeper.js`**
   - SuiteScript 2.1 User Event; imports `N/search`, `N/runtime`, `N/error`, `N/record`, and `./CM_Margin_System_Core`.
   - `beforeLoad` on `CREATE` reads the current employee's `custentity_user_margin_limit`, injects it into `custbody_curr_user_discount_limit`, loads surcharge ranges from `customrecord_sang_conf_sobrecargos` internal ID `1`, converts each range from percentage points to a decimal, and injects JSON in `custbody_sang_hidden_surcharge_config`.
   - On native transforms, `carryOverMarginState()` uses `createdfrom` to copy four header values (`custbody_cust_serv_lvl`, `custbody_curr_cust_discount_limit`, `custbody_customer_level_service_rec`, `custbody_freigth_service_terms`) and five line values (`custcol_precio_sin_margen`, `custcol_mergn_desc_solicitado`, `custcol_margen_aplicado`, `custcol_sang_monto_sobrecargo_apli`, `custcol_drt_sobre_cargo`) by line index. Supported source record types are Estimate and Sales Order.
   - `beforeLoad` on `VIEW` changes native conversion buttons on Estimates only: term `2` removes `createsalesord`; terms `1` or `3` remove `createcashsale` and `createinvoice`.
   - `beforeSubmit` validates only `CREATE` and `EDIT`. It looks up the customer's limit and intercompany checkbox, skips margin validation for intercompany customers, and otherwise enforces item → customer (reduced by service level) → user limits on non-group/kit item lines. The user limit comes from the transaction body field; this handler does not re-query the employee.
   - The User Event validation is implemented separately from `validateMarginRule()`: it divides requested and item limits by 100, normalizes only the service reduction when it is greater than `1`, and compares customer/user limits as retrieved. Verify the account's percent-field value conventions before changing this logic or assuming its normalization matches the Client Script.

2. **`src/FileCabinet/SuiteScripts/sistema_margenes/CS_Margin_System.js`**
   - SuiteScript 2.1 Client Script (`SameAccount`); imports `N/ui/dialog`, `N/search`, `N/runtime`, `./CM_Margin_System_Core`, and `./CM_Surcharge_System_Core`.
   - Caches user/customer limits, customer service-level reductions, surcharge configuration, and an intercompany-customer flag in `globalState`.
   - `pageInit` reads the injected body values and checks required fields with `isFieldAvailable()` before continuing. If an entity is already selected, it asynchronously loads that customer's limits, service record, and intercompany flag.
   - `handleCustomerChange()` temporarily disables `custbody_freigth_service_terms` while it loads customer/service data. The service record provides reductions for no shipping, same-day shipping, and multi-day shipping.
   - `fieldChanged` handles `entity`, `custbody_freigth_service_terms`, and item-line fields `custcol_mergn_desc_solicitado`, `price`, `quantity`, and `custcol_drt_sobre_cargo`.
   - For ordinary customers, `postSourcing` reacts to `item`/`units`, turns the cut surcharge checkbox on only when transaction and stock units differ and the transaction unit text is `m`, `mt`, `mts`, or `m2`, then obtains the native base rate at price level `1` and saves it in `custcol_precio_sin_margen`.
   - For intercompany customers (`custentity_alm_check_intercompania`), `postSourcing` instead sets the price level from `custscript_alm_price_lvl_subsidiaria` (default `6`) and skips the base-price backup and margin/surcharge calculations. `evaluateLineRules()` returns early and `validateLine()` permits the line. This bypasses calculations and validation; it does not itself clear manually entered or previously sourced discount values.
   - Ordinary-customer line calculations use `custcol_precio_sin_margen` as the base where available. The surcharge helper's result is added once to the line total, not multiplied by quantity; `rate` is then set to an equivalent value so `rate * quantity` matches `amount`.
   - `validateLine()` applies the client-side hierarchy. `globalState.isRecalculating` suppresses validation while scripted recalculations run.
   - A stricter delivery term may trigger user confirmation and a batch recalculation to the new allowed limit. Declining the change restores the previous term asynchronously.

3. **`src/FileCabinet/SuiteScripts/sistema_margenes/CM_Margin_System_Core.js`**
   - SuiteScript 2.1 custom module; imports `N/error` and `N/log` (therefore it is not dependency-free, although its margin rules are centralized and it consumes no NetSuite governance units).
   - `validateMarginRule()` expects requested discount, service reduction, and item/customer/user limits as decimals (`15%` → `0.15`). `margenEstandar` is in percentage points (`0–100`).
   - Client Script callers convert the requested discount, service reduction, and limits to decimals before calling the core. The User Event does not call the core and has its own normalization path (see above).
   - Validates item capacity first, then customer capacity after service-level reduction, then user authority. It calculates cost as `precioBase * (100 - margenEstandar) / 100`, applies the requested discount to the standard margin, and rounds the final price to two decimals.
   - Throws `MATH_DIV_BY_ZERO_PREVENTION` when the resulting margin is `<= 0`.
   - `isSubsidiaryCustomer(customerData)` returns the truthiness of `custentity_alm_check_intercompania`.

4. **`src/FileCabinet/SuiteScripts/sistema_margenes/CM_Surcharge_System_Core.js`**
   - SuiteScript 2.1 custom module with no NetSuite module imports.
   - `calculateSurcharge()` requires both cut flags, positive quantity and item length, and computes a tier factor from `quantity / largoArticulo`. Ranges are `<20%`, `20–<40%`, `40–<60%`, and `>=60%`; fallback factors are `0.20`, `0.15`, `0.10`, and `0.05`.
   - Calculates `precioBase * factor` with a minimum returned amount of MXN 15 when the calculated amount is positive but below 15. The Client Script treats that return value as one line-level cut fee.

### Intercompany pricing
- A customer is treated as intercompany when `custentity_alm_check_intercompania` is checked.
- The Client Script uses script parameter `custscript_alm_price_lvl_subsidiaria`, whose SDF default is price level ID `6`; NetSuite sources the rate from that level. The Client Script does not apply the normal margin or surcharge calculations, and the User Event skips its margin hierarchy validation.
- The current implementation switches price levels when an item or unit is sourced. It does not explicitly re-source all existing lines solely because the customer changes. Also, the no-customer branch of `handleCustomerChange()` does not currently reset `globalState.esSubsidiaria`. Treat customer-switch behavior as an area requiring verification; do not document automatic existing-line conversion as guaranteed.

## Important field IDs and data conventions

- Preserve the original spelling of IDs, especially `custbody_freigth_service_terms` and `custcol_mergn_desc_solicitado`.
- Body fields: `custbody_freigth_service_terms`, `custbody_cust_serv_lvl`, `custbody_curr_user_discount_limit`, `custbody_curr_cust_discount_limit`, `custbody_customer_level_service_rec`, `custbody_sang_hidden_surcharge_config`.
- Line fields: `custcol_mergn_desc_solicitado`, `custcol_precio_sin_margen`, `custcol_maxdiscount_margin_percent`, `custcol_drt_unidad_stock`, `custcol_sang_item_solicitar_corte`, `custcol_sang_hidden_item_largo`, `custcol_drt_sobre_cargo`, `custcol_sang_monto_sobrecargo_apli`, `custcol_margen_estandar`, `custcol_margen_minimo_item`, `custcol_margen_aplicado`.
- Customer/employee fields: `custentity_maxdiscount_margin_percent`, `custentity_custrec_service_level`, `custentity_user_margin_limit`, `custentity_alm_check_intercompania`.
- Item fields: `custitem_maxdiscount_margin_percent`, `custitem_min_margin_value`, `custitem_alm_preciofinal_cargos`; referenced existing item fields include `custitem_drt_ci_margen_para_venta`, `custitem_drt_nc_solicitar_corte`, and `custitem_drt_cp_largo`.
- `customrecord_sang_conf_sobrecargos.custrecord_sang_sc_rango1` through `custrecord_sang_sc_rango4` are `FLOAT` values interpreted as percentage points in the record and divided by 100 when injected into the client.
- `customrecord_margin_system_lvl_service` supplies `custrecord_serv_lvl_noenvio`, `custrecord_serv_lvl_enviohoy`, and `custrecord_serv_lvl_enviodias`.
- `custbody_freigth_service_terms` uses `customlist_freigth_level_service`: `1` = `HOY`, `2` = `SIN ENVIO`, `3` = `3 DIAS`.

## SDF object layout
- `src/Objects/Custom Fields/{Custitem,Custbody,Custcol,Custentity}/`: custom field definitions.
- `src/Objects/Scripts/`: active User Event and Client Script definitions and deployments.
- `src/Objects/Terceros/`: imported/third-party field definitions and the legacy Client Script object.
- `src/Objects/`: custom records and lists.
- `.gitignore` allows the project’s `.js`, `.md`, `.json`, `.html`, and `.xml` files; SDF XMLs and `project.json` are tracked.

## Legacy script and deployment caution
- `src/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js` and `src/Objects/Terceros/customscript_drt_ci_costo_venta_cs.xml` are legacy cost-of-sale components and are included in `src/deploy.xml`.
- Although superseded by the margin system, the checked-in XML currently marks the legacy script deployed (`isdeployed=T`) on Estimate, Sales Order, Invoice, and Cash Sale. Do not call it undeployed or assume its live account status; a project deployment may affect this object.
- The latest commit message reports that a conflicting partner customization was disabled in production and functionality restored. That production state is not independently verifiable from this repository. Review account deployments and possible Client Script conflicts before any deployment.

## Historical/auxiliary files
- `src/FileCabinet/SuiteScripts/sistema_margenes/*_System.md` and `Margin_System_Diagnostic_Report.md` are supporting notes, not authoritative over the current JavaScript/XML.
- `planes/` contains the approved intercompany design and implementation prompt; source code defines the implemented behavior.
