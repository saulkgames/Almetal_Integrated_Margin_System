# Almetal Integrated Margin System

NetSuite SuiteCloud Development Framework (SDF) project for margin controls, cutting surcharges, and intercompany pricing on Estimates, Sales Orders, Invoices, and Cash Sales.

## Overview

The solution combines:

- A Client Script that sources the correct price, calculates line prices, handles service-level changes, and validates the requested margin discount.
- A User Event that initializes transaction values, carries selected pricing state through native transforms, and enforces server-side margin limits before save.
- Custom modules for margin validation and cutting surcharge calculation.
- SDF custom fields, service-level and surcharge records, lists, and script deployment objects.

For ordinary customers, requested discounts are constrained by the item’s capacity, the customer’s limit adjusted by the delivery service level, and the current user’s authority. Cutting surcharges apply only when the item and unit conditions qualify.

## Intercompany customers

Customers marked with `custentity_alm_check_intercompania` follow a separate pricing route:

1. When an item or unit is sourced, the Client Script sets the configured subsidiary price level. Script parameter `custscript_alm_price_lvl_subsidiaria` has an SDF default of `6`.
2. The margin and cutting-surcharge calculations are skipped for those customers.
3. The User Event skips the normal margin hierarchy validation.

NetSuite provides the rate from the selected price level. The bypass does not itself clear discount values manually entered or previously carried onto a line. The current code does not explicitly re-source all existing lines just because the customer changes; verify that scenario in the target account.

## Project structure

```text
.
├── AGENTS.md
├── planes/                              # Intercompany design and implementation notes
├── src/
│   ├── deploy.xml                       # SDF deployment scope
│   ├── manifest.xml
│   ├── Objects/
│   │   ├── Custom Fields/
│   │   │   ├── Custbody/
│   │   │   ├── Custcol/
│   │   │   ├── Custentity/
│   │   │   └── Custitem/
│   │   ├── Scripts/                     # Active UE and Client Script definitions
│   │   ├── Terceros/                    # Imported/legacy object definitions
│   │   └── *.xml                        # Custom records and lists
│   └── FileCabinet/SuiteScripts/
│       ├── sistema_margenes/
│       │   ├── UE_Margin_System_Keeper.js
│       │   ├── CS_Margin_System.js
│       │   ├── CM_Margin_System_Core.js
│       │   └── CM_Surcharge_System_Core.js
│       └── drt_ci_costo_venta_cs.js     # Legacy Client Script; see deployment caution
├── project.json                         # Default authentication ID
└── suitecloud.config.js                 # SDF root configuration
```

## Main components

### `UE_Margin_System_Keeper.js`

- On transaction creation, injects the current employee’s discount limit and surcharge-tier configuration.
- Carries selected header and line margin/surcharge values from Estimate or Sales Order during supported native transforms.
- On Estimates in view mode, conditionally hides native transaction-conversion buttons according to the delivery term.
- On create/edit, validates non-group/kit line discounts against item, customer/service-level, and user limits. Intercompany customers bypass this validation.

### `CS_Margin_System.js`

- Loads customer limits, delivery-service reductions, surcharge configuration, and intercompany status.
- For ordinary customers, sources the native base rate, snapshots it in `custcol_precio_sin_margen`, validates discounts, and applies eligible cut surcharges.
- When delivery terms become stricter, asks whether to recalculate lines to the new allowed limit.
- For intercompany customers, selects the configured price level (default ID `6`) and bypasses margin and surcharge calculations.

### Custom modules

- **`CM_Margin_System_Core.js`**: centralizes the three-level margin hierarchy, final-price calculation, and intercompany-customer detection. It imports `N/error` and `N/log` and consumes no NetSuite governance units.
- **`CM_Surcharge_System_Core.js`**: calculates surcharge amounts using four tiers based on `quantity / item length`, with a minimum returned amount of MXN 15 when the calculated amount is positive but below the floor. The Client Script adds the result once to the line total rather than multiplying it by quantity.

The User Event applies the hierarchy in its own `beforeSubmit` implementation rather than calling the margin core. Its percent normalization differs from the Client Script: it divides requested and item discount values by 100, normalizes the service reduction only when greater than `1`, and uses customer/user limit values as retrieved. Confirm the account's percent-field value conventions before modifying or relying on server-side boundary behavior.

## Key records and fields

- **Customer:** `custentity_maxdiscount_margin_percent`, `custentity_custrec_service_level`, and `custentity_alm_check_intercompania`.
- **Employee:** `custentity_user_margin_limit`.
- **Item:** `custitem_maxdiscount_margin_percent`, `custitem_min_margin_value`, and `custitem_alm_preciofinal_cargos`; related source fields include the item’s standard margin, cut requirement, and length.
- **Transaction body:** `custbody_curr_user_discount_limit`, `custbody_curr_cust_discount_limit`, `custbody_cust_serv_lvl`, `custbody_customer_level_service_rec`, `custbody_sang_hidden_surcharge_config`, and `custbody_freigth_service_terms`.
- **Transaction line:** `custcol_mergn_desc_solicitado`, `custcol_precio_sin_margen`, `custcol_maxdiscount_margin_percent`, `custcol_margen_estandar`, `custcol_margen_minimo_item`, `custcol_margen_aplicado`, `custcol_sang_item_solicitar_corte`, `custcol_sang_hidden_item_largo`, `custcol_sang_monto_sobrecargo_apli`, `custcol_drt_sobre_cargo`, and `custcol_drt_unidad_stock`.
- **Custom records:** `customrecord_margin_system_lvl_service` provides delivery-term reductions; `customrecord_sang_conf_sobrecargos` provides the four surcharge factors (loaded from internal ID `1`); `customrecord_sang_clasificacion_clientes` is present but is not consumed by the active margin scripts.
- **Delivery list:** `customlist_freigth_level_service` maps `1` to `HOY`, `2` to `SIN ENVIO`, and `3` to `3 DIAS`.

Keep the original field-ID spellings, including `custbody_freigth_service_terms` and `custcol_mergn_desc_solicitado`.

## Validation and deployment

The SDF project root is `src/`. The default authentication ID is `Almetal_PR`. To validate the project, run:

```text
suitecloud project:validate
```

`src/deploy.xml` includes the margin-system scripts, the legacy Client Script file, and all objects under `src/Objects`. **Do not deploy or upload files without explicit authorization.** Before any deployment, check the target account’s current script deployments and transaction-form configuration.

## Deployment and operational cautions

- The checked-in legacy object `src/Objects/Terceros/customscript_drt_ci_costo_venta_cs.xml` currently has `isdeployed=T` for Estimate, Sales Order, Invoice, and Cash Sale, despite being superseded by the margin system. It is in the deployment scope; do not assume it is inactive or harmless.
- The latest commit message reports that a conflicting partner customization was disabled in production and functionality was restored. This repository cannot confirm the live account’s deployment state. Inspect the account for competing Client Scripts before changing deployment state.
- Users and forms must have the necessary field visibility, price-level access, customer/service-record permissions, and master data for the relevant transaction route.

## Source-of-truth note

The JavaScript under `src/FileCabinet/SuiteScripts/` and object XML under `src/Objects/` define current behavior. Older `*_System.md` files and diagnostic notes are historical support material and may contain stale field IDs or deployment recommendations.
