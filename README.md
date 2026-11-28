# Almetal Integrated Margin System

NetSuite SuiteCloud Development Framework (SDF) project that controls margin discounts, cutting surcharges and intercompany pricing on sales transactions (`estimate`, `salesorder`, `invoice`, `cashsale`).

Agent rules and task routing: see `AGENTS.md`. This file is the detailed reference; read only the section you need.

| Section | Content |
|---|---|
| §1 | Repository layout |
| §2 | Business rules |
| §3 | Formulas |
| §4 | Script reference |
| §5 | Object catalog |
| §6 | Master data and role prerequisites |
| §7 | Deployment |
| §8 | Known issues and history |

---

## 1. Repository layout

```text
.
├── AGENTS.md                         # Agent rules, routing map, gotchas (always loaded)
├── README.md                         # This reference
├── Margin_System_Diagnostic_Report.md# 2026-11-24 diagnosis: legacy CS overwrote rate on line commit
├── planes/                           # Approved implementation plans (historical)
│   ├── 2026-11-24_soporte_intercompania_plan_v2.md
│   └── 2026-11-24_soporte_intercompania_prompt_v1.md
├── .opencode/                        # OpenCode config: commands/, skills/ (generic NetSuite references, ~5 MB)
├── opencode.json                     # OpenCode models and bash permissions
├── project.json                      # defaultAuthId = Almetal_PR
├── suitecloud.config.js              # defaultProjectFolder = src
└── src/
    ├── deploy.xml                    # Deploy scope
    ├── manifest.xml                  # ACCOUNTCUSTOMIZATION; required features CUSTOMRECORDS, UNITSOFMEASURE, SERVERSIDESCRIPTING
    ├── FileCabinet/SuiteScripts/
    │   ├── drt_ci_costo_venta_cs.js  # Legacy third-party Client Script (DRT). Do not modify.
    │   └── sistema_margenes/
    │       ├── UE_Margin_System_Keeper.js   # User Event: injection, carry-over, buttons, save validation
    │       ├── CS_Margin_System.js          # Client Script: UI controller
    │       ├── CM_Margin_System_Core.js     # Pure margin math + subsidiary detection
    │       ├── CM_Surcharge_System_Core.js  # Pure cutting-surcharge math
    │       └── *.md                         # Early release notes (stale IDs; historical only)
    └── Objects/
        ├── Custom Fields/{Custbody,Custcol,Custentity,Custitem}/   # Fields owned by this project
        ├── Scripts/                  # customscriptue_margin_system_keeper, customscriptcs_margin_system
        ├── Terceros/                 # Third-party (DRT) fields and legacy script, kept for dependency validation
        └── customlist_* / customrecord_*.xml
```

---

## 2. Business rules

### 2.1 Discount hierarchy (non-subsidiary customers)
A requested margin discount (`custcol_mergn_desc_solicitado`) is valid only if it passes, in order:

| Level | Limit | Source |
|---|---|---|
| 1. Item capacity | `custcol_maxdiscount_margin_percent` | Sourced from `custitem_maxdiscount_margin_percent` |
| 2. Customer limit penalized by freight term | `limiteCliente * (1 - reduccionServicio)` | `custentity_maxdiscount_margin_percent` and `customrecord_margin_system_lvl_service` |
| 3. User authority | `custbody_curr_user_discount_limit` | Injected from `custentity_user_margin_limit` of the current user |

Lines of type `Group`, `Kit`, `EndGroup` and lines with discount `0` are skipped.

### 2.2 Freight service term penalty
`custbody_freigth_service_terms` selects which reduction of the customer's service-level record applies:

| List value | Label | Service-level field |
|---|---|---|
| `1` | HOY | `custrecord_serv_lvl_enviohoy` |
| `2` | SIN ENVIO | `custrecord_serv_lvl_noenvio` |
| `3` | 3 DIAS | `custrecord_serv_lvl_enviodias` |

A stricter term on a transaction with lines asks for confirmation and caps each line's discount to `min(item, reduced customer, user)`. Cancel restores the previous term.

### 2.3 Cutting surcharge
Applies when all are true: `custcol_drt_sobre_cargo` = T, `custcol_sang_item_solicitar_corte` = T, line unit ≠ stock unit (`custcol_drt_unidad_stock`), and unit text in `m`, `mt`, `mts`, `m2`. `postSourcing` sets `custcol_drt_sobre_cargo` automatically on `item`/`units` change.

### 2.4 Intercompany (subsidiary customers)
If the customer has `custentity_alm_check_intercompania` = T:
- CS forces `price` to the script parameter `custscript_alm_price_lvl_subsidiaria` (default `6`, "SUBSIDIARIAS").
- No discount, no surcharge, no `validateLine` block, no `beforeSubmit` hierarchy validation.

### 2.5 Estimate conversion buttons (VIEW mode, estimate only)
| Term | Removed buttons |
|---|---|
| `2` SIN ENVIO | `createsalesord` |
| `1` HOY, `3` 3 DIAS | `createcashsale`, `createinvoice` |

---

## 3. Formulas

### 3.1 Margin (`CM_Margin_System_Core.validateMarginRule`)
```text
costo           = precioBase * (100 - margenEstandar) / 100
margenAplicado  = margenEstandar - margenEstandar * descMargenSolicitado
precioFinal     = round2( costo * 100 / (100 - margenAplicado) )
```
- `margenEstandar` and `margenAplicado` are `0–100`. Discount and limits are decimals.
- `margenAplicado <= 0` throws `MATH_DIV_BY_ZERO_PREVENTION`.
- Invalid result returns `{ isValid: false, errorMessage, appliedMargin: 0, finalPrice: precioBase }` and writes `log.audit`.

### 3.2 Surcharge (`CM_Surcharge_System_Core.calculateSurcharge`)
```text
ratio = quantity / largoArticulo            (largoArticulo = custcol_sang_hidden_item_largo)
factor: ratio < 0.20 -> rango1 (default 0.20)
        ratio < 0.40 -> rango2 (default 0.15)
        ratio < 0.60 -> rango3 (default 0.10)
        ratio >= 0.60 -> rango4 (default 0.05)
surcharge = precioBase * factor; if 0 < surcharge < 15 then surcharge = 15 (MXN)
```

### 3.3 Line totals (`CS_Margin_System.evaluateLineRules`)
```text
amount = round2( precioFinal * quantity + surcharge )   # surcharge charged once per line
rate   = round2( amount / quantity )
price  = -1 (Custom)
```
If discount and surcharge are both `0` and the line is Custom, the line returns to `price = 1`, `rate = custcol_precio_sin_margen`.

### 3.4 Unit conventions
| Value | Scale at read time |
|---|---|
| PERCENT field via `getValue` / `getCurrentSublistValue` | `0–100` |
| PERCENT field via `search.lookupFields` + `parseFloat` | `0–100` |
| `custrecord_sang_sc_rango1..4` (FLOAT) | `0–100`, divided by 100 in UE before JSON injection |
| `custcol_margen_estandar`, `custcol_margen_aplicado` (FLOAT) | `0–100` |

---

## 4. Script reference

### 4.1 `UE_Margin_System_Keeper.js` — User Event 2.1
Imports: `N/search`, `N/runtime`, `N/error`, `N/record`, `./CM_Margin_System_Core`.

| Entry / function | Trigger | Behavior | Governance (approx.) |
|---|---|---|---|
| `beforeLoad` | CREATE | Injects user limit and surcharge JSON; calls `carryOverMarginState` | 2 lookups + 1 lookup + 1 `record.load` |
| `carryOverMarginState` | CREATE with `createdfrom` of type `estimate`/`salesorder` | Copies header `custbody_cust_serv_lvl`, `custbody_curr_cust_discount_limit`, `custbody_customer_level_service_rec`, `custbody_freigth_service_terms` and line `custcol_precio_sin_margen`, `custcol_mergn_desc_solicitado`, `custcol_margen_aplicado`, `custcol_sang_monto_sobrecargo_apli`, `custcol_drt_sobre_cargo` by line index | included above |
| `hideEstimateOnlyButtons` | VIEW, estimate only | §2.5 | 0 |
| `beforeSubmit` | CREATE / EDIT | Customer lookup (limit + intercompany flag); skip if subsidiary; inline hierarchy validation per line | 1 lookup |

Errors thrown: `ERR_CAPACIDAD_ARTICULO_EXCEDIDA`, `ERR_LIMITE_CLIENTE_EXCEDIDO`, `ERR_LIMITE_USUARIO_EXCEDIDO`; any other exception is wrapped as `ERR_SISTEMA_MARGENES`.

### 4.2 `CS_Margin_System.js` — Client Script 2.1
Imports: `N/ui/dialog`, `N/search`, `N/runtime`, `./CM_Margin_System_Core`, `./CM_Surcharge_System_Core`. Entry points: `pageInit`, `fieldChanged`, `postSourcing`, `validateLine` (no `saveRecord`).

`globalState`: `limiteCliente`, `limiteUsuario`, `reduccionServicioActual`, `nivelesEnvio {noEnvio, envioHoy, envioDias}`, `isRecalculating`, `terminoEntregaAnterior`, `configSobrecargos`, `esSubsidiaria`.

| Function | Trigger | Behavior |
|---|---|---|
| `pageInit` | load | Checks required body fields; loads limits, term and surcharge JSON; calls `handleCustomerChange` if `entity` set |
| `fieldChanged` | `entity` | `handleCustomerChange` |
| `fieldChanged` | `custbody_freigth_service_terms` | `handleTermsChange` |
| `fieldChanged` | line `custcol_mergn_desc_solicitado`, `price`, `quantity`, `custcol_drt_sobre_cargo` | `evaluateLineRules` |
| `postSourcing` | line `item` / `units` | Subsidiary: force price level param. Else: toggle surcharge flag, force `price = 1` (or backup + evaluate if already `1`) |
| `postSourcing` | line `price` = `1` | `backupBasePrice` then `evaluateLineRules` |
| `backupBasePrice` | helper | Clears discount and applied margin; `rate` → `custcol_precio_sin_margen` |
| `validateLine` | line commit | Blocks when `validateMarginRule` fails |
| `handleCustomerChange` | helper | Promise chain: customer → service-level record; sets `custbody_curr_cust_discount_limit`, `custbody_customer_level_service_rec`, `globalState` |
| `handleTermsChange` | helper | §2.2 |
| `processLineRecalculation` | helper | Caps discount, recomputes `rate` and `custcol_margen_aplicado`, `commitLine` |
| `evaluateLineRules` | helper | §3.3 |
| `getSubsidiaryPriceLevel` | helper | Reads `custscript_alm_price_lvl_subsidiaria`, default `6` |

### 4.3 `CM_Margin_System_Core.js` — Custom Module 2.1
Imports: `N/error`, `N/log`. Exports `validateMarginRule(params)` and `isSubsidiaryCustomer(customerData)` (truthy `custentity_alm_check_intercompania`). 0 governance.

### 4.4 `CM_Surcharge_System_Core.js` — Custom Module 2.1
No imports. Exports `calculateSurcharge(params)`. 0 governance.

### 4.5 `drt_ci_costo_venta_cs.js` — legacy Client Script 2.x (third party)
Imports `N/runtime`, `N/search`, `N/ui/message`, `N/ui/dialog`. Entry points `validateLine`, `fieldChanged`, `postSourcing`. Uses `custcol_drt_rate_backup`, `custcol_drt_rate_block`, `custcol_pfpdescuento_`, `custcol_drt_descuento_maximo_art`, `custentity_drt_descuento_maxio`, `custentity_drt_modificacion_importe`. Contains 3 `debugger;` statements. Conflicts with the margin system (see `Margin_System_Diagnostic_Report.md`).

---

## 5. Object catalog

### 5.1 Script objects (`src/Objects/Scripts/`, `src/Objects/Terceros/`)
| Script ID | Type | Deployments (record) | Notes |
|---|---|---|---|
| `customscriptue_margin_system_keeper` | usereventscript | `customdeploy_ue_margyn_system_keeper` (ESTIMATE), `_so`, `_inv`, `_cs` | `runasrole=ADMINISTRATOR`, `allroles=T` |
| `customscriptcs_margin_system` | clientscript | `customdeploy_cs_margyn_system` (ESTIMATE), `_so`, `_inv`, `_cs` | Param `custscript_alm_price_lvl_subsidiaria` (INTEGER, COMPANY, default `6`) |
| `customscript_drt_ci_costo_venta_cs` | clientscript (legacy) | `customdeploy_drt_ci_costo_venta_cs` (SO), `_in_cs` (INV), `_cs_cs` (CASHSALE), `_es_cs` (ESTIMATE) | `isdeployed=T` in repo; deactivated in production |

### 5.2 Custom records and lists
| ID | Fields | Notes |
|---|---|---|
| `customrecord_margin_system_lvl_service` | `custrecord_client_serv_lvl` (customer), `custrecord_serv_lvl_noenvio`, `custrecord_serv_lvl_enviohoy`, `custrecord_serv_lvl_enviodias` (PERCENT) | Freight penalty per customer |
| `customrecord_sang_conf_sobrecargos` | `custrecord_sang_sc_rango1..4` (FLOAT `0–100`) | Record ID `1` is hard-coded in UE |
| `customrecord_sang_clasificacion_clientes` | `custrecord_sang_categoria_clasi_cli` (→ `customlist_sang_list_clasifi_client`), `custrecord_sang_porcent_desc_cat` (PERCENT) | Feeds `custentity_maxdiscount_margin_percent` by sourcing |
| `customlist_freigth_level_service` | `1` HOY, `2` SIN ENVIO, `3` 3 DIAS | |

### 5.3 Entity fields
| ID | Applies to | Type | Notes |
|---|---|---|---|
| `custentity_user_margin_limit` | Employee | PERCENT, LOCKED | User authority |
| `custentity_maxdiscount_margin_percent` | Customer | PERCENT | Sourced from classification via `custentity_sang_clasi_cliente_ventas` |
| `custentity_custrec_service_level` | Customer | SELECT → `customrecord_margin_system_lvl_service` | |
| `custentity_alm_check_intercompania` | Customer, Vendor | CHECKBOX | Intercompany flag |

### 5.4 Item fields
| ID | Type | Used by scripts |
|---|---|---|
| `custitem_maxdiscount_margin_percent` | PERCENT | Via `custcol_maxdiscount_margin_percent` |
| `custitem_min_margin_value` | FLOAT | Via `custcol_margen_minimo_item` (not read by scripts) |
| `custitem_alm_preciofinal_cargos` | CURRENCY | No |

### 5.5 Transaction body fields
| ID | Type / display | Written by |
|---|---|---|
| `custbody_curr_user_discount_limit` | PERCENT, LOCKED, sources sales rep `custentity_user_margin_limit` | UE `beforeLoad` CREATE (current user) |
| `custbody_curr_cust_discount_limit` | PERCENT, LOCKED | CS `handleCustomerChange` |
| `custbody_cust_serv_lvl` | PERCENT, LOCKED | CS `handleTermsChange` / `processLineRecalculation` |
| `custbody_customer_level_service_rec` | TEXT, LOCKED | CS `handleCustomerChange` |
| `custbody_sang_hidden_surcharge_config` | TEXTAREA, HIDDEN | UE `beforeLoad` CREATE |
| `custbody_freigth_service_terms` | SELECT → `customlist_freigth_level_service`, mandatory | User |

### 5.6 Transaction line fields
| ID | Type / display | Source / writer |
|---|---|---|
| `custcol_mergn_desc_solicitado` | PERCENT | User |
| `custcol_precio_sin_margen` | CURRENCY, LOCKED | CS `backupBasePrice`, UE carry-over (no XML sourcing) |
| `custcol_maxdiscount_margin_percent` | PERCENT, LOCKED | Sourced `custitem_maxdiscount_margin_percent` |
| `custcol_margen_estandar` | FLOAT, LOCKED | Sourced `custitem_drt_ci_margen_para_venta` |
| `custcol_margen_minimo_item` | FLOAT, LOCKED | Sourced `custitem_min_margin_value` |
| `custcol_margen_aplicado` | FLOAT, LOCKED | CS |
| `custcol_sang_item_solicitar_corte` | CHECKBOX, LOCKED | Sourced `custitem_drt_nc_solicitar_corte` |
| `custcol_sang_hidden_item_largo` | FLOAT, HIDDEN | Sourced `custitem_drt_cp_largo` |
| `custcol_sang_monto_sobrecargo_apli` | CURRENCY, LOCKED | CS |
| `custcol_pfpdescuento_` | PERCENT | Legacy script only |

### 5.7 Third-party objects (`src/Objects/Terceros/`, read-only)
`custcol_drt_sobre_cargo` (CHECKBOX, surcharge toggle), `custcol_drt_unidad_stock` (SELECT, sourced stock unit), `custcol_drt_rate_backup`, `custcol_drt_rate_block`, `custcol_drt_descuento_maximo_art`, `custentity_drt_descuento_maxio`, `custentity_drt_modificacion_importe`, `custentitydrt_descuieno_maxcustomoe`, `custitem_drt_ci_margen_para_venta`, `custitem_drt_cp_largo`, `custitem_drt_nc_solicitar_corte`, `customscript_drt_ci_costo_venta_cs`.

Manifest dependencies not in the repo: `customlist_sang_list_clasifi_client` (+ values), `custentity_sang_clasi_cliente_ventas`, `customrecord_pfp_fammargenes_.custrecord_drt_ci_m_margen`, `custitem_pfp_fammargenes_`, `custitem_drt_descuento_maximo`.

---

## 6. Master data and role prerequisites
- Every sales employee has `custentity_user_margin_limit`; empty means any discount is rejected.
- Customers have `custentity_maxdiscount_margin_percent` (via classification) and `custentity_custrec_service_level`.
- `customrecord_sang_conf_sobrecargos` record ID `1` exists with the four tiers.
- Intercompany customers have `custentity_alm_check_intercompania` = T, and price level ID `6` (or the parameter value) has prices.
- Account feature Multiple Prices enabled; forms expose Price Level and Rate on the item sublist.
- Client-side lookups run with the user's role: the role needs read access to customer custom fields and `customrecord_margin_system_lvl_service`.
- Transaction forms include all margin body and line fields; otherwise `pageInit` logs `[CM_WARN]` and the CS does nothing on load.

---

## 7. Deployment
```bash
suitecloud project:validate
```
```bash
suitecloud project:deploy
```
```bash
suitecloud file:upload --paths "/SuiteScripts/sistema_margenes/CS_Margin_System.js"
```
- Deploy target: `Almetal_PR` (production). Prefer a sandbox auth ID for tests.
- Before any full deploy, set `isdeployed=F` on the four deployments in `src/Objects/Terceros/customscript_drt_ci_costo_venta_cs.xml`, or production will re-activate the legacy script.
- `sistema_margenes/*` also uploads the `.md` notes to the File Cabinet.

---

## 8. Known issues and history

### 8.1 Open issues (from code reading; confirm in sandbox)
| ID | Issue | Location |
|---|---|---|
| K1 | Rules B/C in `beforeSubmit` compare a decimal discount with `0–100` limits; they only block when the limit is `0`. | `UE_Margin_System_Keeper.js` |
| K2 | Changing to a subsidiary customer does not re-price existing lines. | `CS_Margin_System.js` `handleCustomerChange` |
| K3 | `custcol_margen_estandar = 0` with a discount or surcharge throws `MATH_DIV_BY_ZERO_PREVENTION`. | `CM_Margin_System_Core.js` |
| K4 | `processLineRecalculation` ignores the surcharge and does not set `amount`. | `CS_Margin_System.js` |
| K5 | Configured tier `0` falls back to the default factor. | `CM_Surcharge_System_Core.js` |
| K6 | Legacy deployments `isdeployed=T` in repo vs deactivated in production. | `customscript_drt_ci_costo_venta_cs.xml` |

### 8.2 History
| Date | Change |
|---|---|
| — | Surcharge v1 and validations; edit-mode state rebuild; amount fix (surcharge charged once per line) |
| 2026-11-24 | Intercompany support (`custentity_alm_check_intercompania`, price level param) — `planes/2026-11-24_soporte_intercompania_plan_v2.md` |
| 2026-11-24 | Legacy partner deployments deactivated in production to fix Aceros de Guasave line-commit revert — `Margin_System_Diagnostic_Report.md` |
