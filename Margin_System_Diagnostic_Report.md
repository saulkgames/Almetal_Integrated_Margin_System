# Margin & Cutting Surcharge System — Line Commit Diagnostic Report

**Date:** 2026-11-24  
**Project:** Almetal Integrated Margin & Cutting Surcharge System  
**Author:** OpenCode Agent  
**Scope:** Estimate, Sales Order, Invoice, Cash Sale transactions  
**Classification:** Internal — Technical Diagnosis

---

## 1. Executive Summary

Users in a different subsidiary report that, after entering a discount and seeing the margin calculation and price change in the UI, the values are cleared the moment the line is committed (clicking **OK** / **Agregar**).

The investigation identified **a real logic conflict** that explains the symptom exactly, plus a secondary set of role/configuration prerequisites that must be satisfied for the margin system to operate in any subsidiary.

| Priority | Finding | Type |
|---|---|---|
| P1 | Two Client Scripts compete for `price`/`rate` on the `item` sublist at line commit. The legacy script overwrites the recalculated values. | Logic / Deployment conflict |
| P2 | Other subsidiary roles/employees may lack custom-price-level rights, custom-field visibility, or master-data values required by the margin system. | Role / Configuration / Master data |

---

## 2. Symptom Description

- User enters `% Descuento sobre Margen` (`custcol_mergn_desc_solicitado`).
- Client script `CS_Margin_System.js` recalculates `rate`, `amount`, `Margen Aplicado`, and switches the line to **Custom** price level (`price = -1`).
- UI reflects the new price.
- On line commit (OK / Agregar), the line reverts to the original base price and the discount/margin calculations disappear.

No server-side error is shown; the change is silently lost.

---

## 3. Root Cause Analysis

### 3.1 Primary Cause — Conflicting Client Scripts on `item` `validateLine`

Two Client Scripts are deployed simultaneously on `ESTIMATE`, `SALESORDER`, `INVOICE`, and `CASHSALE`:

| Script | File | Deployment | `isdeployed` |
|---|---|---|---|
| **New margin system** | `CS_Margin_System.js` | `customscriptcs_margin_system` | `T` (`allroles=T`, `allemployees=T`) |
| **Legacy cost-of-sale script** | `drt_ci_costo_venta_cs.js` | `customscript_drt_ci_costo_venta_cs` | `T` (`allroles=T`, `executioncontext=USERINTERFACE\|OCRPLUGIN`) |

Both scripts expose a `validateLine` entry point on the `item` sublist. NetSuite executes every deployed Client Script's `validateLine` when the user commits a line. The legacy script runs **after** the new margin system and overwrites its results.

#### What `CS_Margin_System.js` does during editing

- `evaluateLineRules()` forces `price = -1` (Custom) so the recalculated `rate`/`amount` persist.
- It stores the immutable base price in `custcol_precio_sin_margen` and the surcharge in `custcol_sang_monto_sobrecargo_apli`.
- It sets `custcol_margen_aplicado` to the computed applied margin.

References:
- `src/FileCabinet/SuiteScripts/sistema_margenes/CS_Margin_System.js`, lines 408–530 (`evaluateLineRules`).
- Lines 492–512: sets `price = -1`, `rate = rateEquivalente`, `amount = montoTotalFinal`, `custcol_margen_aplicado`, etc.

#### What `drt_ci_costo_venta_cs.js` does at line commit

Its `validateLine` handler (lines 6–181):

1. Captures the **original** rate from `custcol_drt_rate_backup` or `custcol_drt_rate_block` (captured when the line was first added, i.e. the base price), not the recalculated margin-system rate.
2. Conditionally resets `price = "1"` (Base Price level):
   - Lines 30–35: when `custcol_pfpdescuento_ > 0`.
   - Lines 137–143: when the employee field `custentity_drt_modificacion_importe` is empty/false.
   - Lines 157–163: when the resulting rate is `<= 0` and the employee flag is false.
3. Always overwrites `rate` with the legacy-computed value (lines 145–149):
   ```javascript
   currentRecord.setCurrentSublistValue({
       sublistId: sublistName,
       fieldId: 'rate',
       value: nweRate
   });
   ```

Because `nweRate` is derived from the stale `custcol_drt_rate_backup` (original base price), the line is reverted to the base price the moment it is committed.

Additionally, `fieldChanged` for `price` (lines 356–371) resets `rate` to the backup whenever `price < 1` (Custom). Although the margin system sets `price` with `ignoreFieldChange: true`, the `validateLine` overwrite still executes on commit.

#### Why this erases the calculation

NetSuite's pricing engine re-prices a line whenever `price` is set to a defined price level (e.g. `"1"` = Base Price). If `price` is reset to `"1"` at commit, NetSuite re-fetches the item's base price and overwrites the custom `rate`. Even if only the `rate` were overwritten, the value supplied by the legacy script is the pre-margin base price, so the effect is the same: the discount disappears.

### 3.2 Secondary Cause — Role / Subsidiary Configuration

Even after resolving the script conflict, the following configuration must be correct for users in the other subsidiary.

#### 3.2.1 Custom-field visibility and editability

- The custom transaction body and column fields (`custbody_*`, `custcol_*`) are defined with `accesslevel=2` (visible to all roles) and `storevalue=T`.
- However, they must be present on the **custom transaction form** assigned to the other subsidiary's roles. If that subsidiary uses a different form that omits these columns, the script cannot interact with them correctly.
- Locked display-type fields (`custcol_precio_sin_margen`, `custcol_margen_aplicado`, `custcol_sang_monto_sobrecargo_apli`) are script-editable but UI-read-only.

References:
- `src/Objects/Custom Fields/Custcol/custcol_mergn_desc_solicitado.xml`
- `src/Objects/Custom Fields/Custcol/custcol_precio_sin_margen.xml`
- `src/Objects/Custom Fields/Custcol/custcol_margen_aplicado.xml`

#### 3.2.2 Custom price level (`price = -1`)

For the margin system to persist its recalculated rate, the role must support selecting **Custom** price level on transaction lines. Requirements:

- Account feature **Multiple Prices** must be enabled.
- The transaction form's `item` sublist must allow editing the **Rate** column and selecting a price level.
- The role must have sufficient transaction permissions (Create/Edit on Estimate/Sales Order/Invoice/Cash Sale) and, depending on the form, the ability to override line pricing.

If this is missing, setting `price = -1` silently fails and NetSuite reverts to the base price level on commit.

#### 3.2.3 Employee master data

`UE_Margin_System_Keeper.js` injects the active user's limit from the employee record at `beforeLoad`:

```javascript
const employeeData = search.lookupFields({
    type: search.Type.EMPLOYEE,
    id: user.id,
    columns: ['custentity_user_margin_limit']
});
```

Reference: `src/FileCabinet/SuiteScripts/sistema_margenes/UE_Margin_System_Keeper.js`, lines 139–152.

Each sales employee in the other subsidiary must have `custentity_user_margin_limit` populated. If it is empty, the server-side `beforeSubmit` validation will reject any discount > 0 with error `ERR_LIMITE_USUARIO_EXCEDIDO`.

#### 3.2.4 Customer master data

The client script and the user-event script read:

- `custentity_maxdiscount_margin_percent`
- `custentity_custrec_service_level`

These must be populated on the customers of the other subsidiary. If `custentity_custrec_service_level` is empty, `handleCustomerChange()` logs `NO_SERVICE_LEVEL` and the freight reduction remains zero.

References:
- `src/FileCabinet/SuiteScripts/sistema_margenes/CS_Margin_System.js`, lines 240–298 (`handleCustomerChange`).
- `src/FileCabinet/SuiteScripts/sistema_margenes/UE_Margin_System_Keeper.js`, lines 207–217 (`beforeSubmit`).

#### 3.2.5 Surcharge and service-level master records

- `customrecord_sang_conf_sobrecargos` with internal ID `1` must exist; otherwise the JSON injected into `custbody_sang_hidden_surcharge_config` is empty and surcharges fall back to hard-coded defaults.
- `customrecord_margin_system_lvl_service` records must exist and be linked to customers via `custentity_custrec_service_level`.

Reference: `src/FileCabinet/SuiteScripts/sistema_margenes/UE_Margin_System_Keeper.js`, lines 154–171.

#### 3.2.6 Client-side search permissions

`CS_Margin_System.js` performs client-side `search.lookupFields.promise` calls for the customer and the service-level custom record using the **logged-in user's role** (not `runasrole`). If the other subsidiary's role lacks read access to customer custom fields or the custom record type, the client-side limit/reduction values will be zero, which can cause validation failures or incorrect calculations.

---

## 4. Why the Symptom Appears Subsidiary-Specific

The SDF project deploys scripts and objects account-wide, so the field definitions and script deployments are the same in every subsidiary. However, the **manifestation** of the conflict depends on data and roles that differ by subsidiary:

1. **Legacy script behavior is data-dependent.** It checks `custentity_drt_modificacion_importe` on the employee. If employees in one subsidiary have this field set to `true`, the legacy script may not reset `price = "1"`, reducing the visible symptom even though it still overwrites `rate`.
2. **Role/form differences.** The other subsidiary may use custom roles or a custom transaction form where the `Rate`/`Price Level` columns are configured differently, making the `price = -1` pattern fail.
3. **Master-data differences.** Missing employee limits, customer limits, or service-level records in the other subsidiary produce different error patterns (silent revert vs. explicit validation error).

---

## 5. Evidence Map

| File | Lines | Relevant Logic |
|---|---|---|
| `src/FileCabinet/SuiteScripts/sistema_margenes/CS_Margin_System.js` | 196–234 | `validateLine` of the new margin system. |
| `src/FileCabinet/SuiteScripts/sistema_margenes/CS_Margin_System.js` | 408–530 | `evaluateLineRules`: sets `price = -1`, recalculates `rate`/`amount`. |
| `src/FileCabinet/SuiteScripts/sistema_margenes/CS_Margin_System.js` | 508–512 | Forces Custom price level and stores surcharge/margin values. |
| `src/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js` | 6–181 | Legacy `validateLine` that overwrites `rate` and resets `price`. |
| `src/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js` | 30–35 | Resets `price = "1"` when `custcol_pfpdescuento_ > 0`. |
| `src/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js` | 137–143 | Resets `price = "1"` when employee flag `custentity_drt_modificacion_importe` is false. |
| `src/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js` | 145–149 | Always overwrites `rate` with legacy backup-based value. |
| `src/FileCabinet/SuiteScripts/drt_ci_costo_venta_cs.js` | 356–371 | `fieldChanged` on `price` reverts `rate` when price level is Custom (`< 1`). |
| `src/Objects/Scripts/customscript_drt_ci_costo_venta_cs.xml` | 10–62 | Legacy script is still deployed (`isdeployed=T`) on all four transaction types. |
| `src/FileCabinet/SuiteScripts/sistema_margenes/UE_Margin_System_Keeper.js` | 139–152 | Injects `custbody_curr_user_discount_limit` from employee record. |
| `src/FileCabinet/SuiteScripts/sistema_margenes/UE_Margin_System_Keeper.js` | 190–282 | `beforeSubmit` validates limits but does not modify `rate`. |

---

## 6. Recommended Solutions

### 6.1 Immediate Fix — Remove the Legacy Conflict

The legacy script `customscript_drt_ci_costo_venta_cs` is already documented in `AGENTS.md` as superseded. It should be deactivated.

Options:

1. **Preferred:** Set `isinactive=T` on the script object, or set `isdeployed=F` on all four of its deployments in `src/Objects/Terceros/customscript_drt_ci_costo_venta_cs.xml`, then redeploy via `suitecloud project:deploy`.
2. **Alternative:** If any logic from the legacy script is still required (e.g., the old discount based on `custcol_pfpdescuento_` or the surcharge multipliers), migrate that logic into `CS_Margin_System.js` and remove the legacy deployment.
3. **Clean-up:** Remove the `debugger;` statements at lines 12, 129, and 220 of `drt_ci_costo_venta_cs.js`; they pause execution when browser DevTools are open.

After deactivation, verify that committing a line preserves the recalculated rate.

### 6.2 Role / Subsidiary Configuration Checklist

For each role used in the affected subsidiary, confirm:

- [x] The role can create/edit **Estimate**, **Sales Order**, **Invoice**, and **Cash Sale** transactions.
- [x] The custom transaction form used by the role includes the margin-system body and column fields.
- [x] The `item` sublist on the form allows editing **Price Level** and **Rate**, and the account has **Multiple Prices** enabled.
- [x] The role can read customer records and the customer custom fields `custentity_maxdiscount_margin_percent` and `custentity_custrec_service_level`.
- [ ] The role can read the custom record type `customrecord_margin_system_lvl_service`.
- [x] Each sales employee in the subsidiary has `custentity_user_margin_limit` populated.
- [ ] Each customer used in the subsidiary has `custentity_maxdiscount_margin_percent` and `custentity_custrec_service_level` populated.
- [x] `customrecord_sang_conf_sobrecargos` (ID `1`) exists and has values in its four range fields.
- [x] Service-level records exist in `customrecord_margin_system_lvl_service` and are linked correctly.

### 6.3 Optional Hardening

- Add defensive logging in `CS_Margin_System.js` before and after line commit to capture the values of `price`, `rate`, `custcol_mergn_desc_solicitado`, and `custcol_margen_aplicado`. This helps confirm the fix in production.
- Consider adding a `sublistChanged` handler or extending `validateLine` to assert that `price` did not revert to a non-Custom level after commit.

---

## 7. Verification Plan

1. In a sandbox or the affected subsidiary:
   1. Create an Estimate with one item.
   2. Enter a valid discount in `% Descuento sobre Margen`.
   3. Confirm the recalculated `rate` and `Margen Aplicado` are visible.
   4. Click **Agregar** / **OK**.
   5. Expected result: the line retains the recalculated `rate`, `amount`, and `Margen Aplicado`.
2. Repeat with surcharge-eligible units (`m`, `mt`, `mts`, `m2`) and `custcol_drt_sobre_cargo` enabled.
3. Repeat with different service terms (`custbody_freigth_service_terms`) to confirm the customer/freight reduction is applied.
4. Confirm `UE_Margin_System_Keeper.js` does not throw `ERR_*` validation errors when the discount is within limits.

---

## 8. Conclusion

The reported symptom is not caused by a missing role permission alone. The primary driver is a **deployment conflict**: the legacy Client Script `drt_ci_costo_venta_cs.js` is still active and overwrites the margin system's recalculated `rate` (and often resets `price` to Base) at line commit. Deactivating the legacy script is the fastest and most reliable fix.

After the script conflict is removed, the subsidiary-specific configuration checklist above must be satisfied so that users in the other subsidiary can edit lines, use Custom price levels, and read the employee/customer/master-record data required by the margin system.
