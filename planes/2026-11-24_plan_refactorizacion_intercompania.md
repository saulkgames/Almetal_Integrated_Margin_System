# Refactor Plan: Intercompany (Subsidiary) Support in Margin System

## Control

| Field | Value |
|---|---|
| Date | 2026-11-24 |
| Version | v1 |
| Status | Draft / Ready for implementation |
| Project | Almetal Integrated Margin and Cutting Surcharge System |
| Commit analyzed | `857911e` — *Added intercompany operations automated process* |

## Objective

Harden the intercompany customer path introduced in commit `857911e` so that:
1. Subsidiary detection is robust against all NetSuite checkbox representations.
2. Client-side state stays consistent when the customer is cleared or switched.
3. The business decision on existing-line recalculation (TC-03) is implemented explicitly and safely.
4. The margin system remains maintainable and testable.

## Findings and Risk Priority

| ID | Finding | Severity | Rationale |
|---|---|---|---|
| F1 | `CM_Margin_System_Core.isSubsidiaryCustomer()` uses `!!value`, which treats any non-empty string as `true`. If NetSuite returns `"F"` for an unchecked box, a normal customer would be treated as subsidiary. | High | Data corruption / wrong pricing path. |
| F2 | `CS_Margin_System.handleCustomerChange()` does **not** reset `globalState.esSubsidiaria` when `customerId` is empty. | Medium | Stale state after clearing the customer. |
| F3 | The implementation does **not** recalculate existing lines when a normal customer is changed to a subsidiary (TC-03). The approved prompt requires this behavior. | Medium | Functional gap vs. approved design. |
| F4 | `handleCustomerChange()` is asynchronous; lines added before the promise resolves may use the old customer type. | Medium | Race condition, pre-existing but now more impactful. |
| F5 | When a line becomes intercompany, previously sourced margin/surcharge fields (`custcol_mergn_desc_solicitado`, `custcol_precio_sin_margen`, `custcol_margen_aplicado`, `custcol_sang_monto_sobrecargo_apli`) are not cleared. | Low | Visual/data residue; usually harmless because validation is skipped, but can mislead users and reports. |
| F6 | No unit tests exist for `isSubsidiaryCustomer()`. | Low | Regressions in detection logic are hard to catch. |

## Scope

### In scope
- `src/FileCabinet/SuiteScripts/sistema_margenes/CM_Margin_System_Core.js`
- `src/FileCabinet/SuiteScripts/sistema_margenes/CS_Margin_System.js`

### Out of scope (unless explicitly requested)
- Refactoring `UE_Margin_System_Keeper.js` to reuse `validateMarginRule()`. The User Event intentionally has its own normalization path; changing it is a larger architectural decision.
- Changing the legacy `drt_ci_costo_venta_cs.js` script.
- Renaming fields or changing the surcharge math.

## Detailed Refactor Steps

### Step 1 — Harden subsidiary detection (`CM_Margin_System_Core.js`)

**Goal:** Make `isSubsidiaryCustomer()` accept only well-known truthy representations of a checked checkbox.

**Change:**
```javascript
const isSubsidiaryCustomer = (customerData) => {
    if (!customerData) return false;
    const raw = customerData.custentity_alm_check_intercompania;
    return raw === true || raw === 'T' || raw === 'Y' || raw === 1 || raw === '1';
};
```

**Why:** `!!` is unsafe for string values. NetSuite checkbox APIs have historically returned booleans, `'T'`/`'F'`, or numeric strings depending on context.

### Step 2 — Reset intercompany flag when customer is cleared (`CS_Margin_System.js`)

**Goal:** Prevent stale `esSubsidiaria` state.

**Change in `handleCustomerChange(rec)`:**
```javascript
const handleCustomerChange = (rec) => {
    const customerId = rec.getValue({ fieldId: 'entity' });
    if (!customerId) {
        globalState.limiteCliente = 0;
        globalState.nivelesEnvio = { noEnvio: 0, envioHoy: 0, envioDias: 0 };
        globalState.esSubsidiaria = false;
        return;
    }
    // ... rest of the function
};
```

### Step 3 — Decide and implement existing-line behavior on customer switch (`CS_Margin_System.js`)

**Business decision required:** When a user changes the header customer from **normal → subsidiary**, should existing item lines be automatically converted to price level `6`?

The approved prompt (TC-03) says *yes*. If the business confirms:

**Implementation:**
1. After `globalState.esSubsidiaria` is set to `true` inside the `handleCustomerChange()` promise resolution, and **only if** the previous value was `false`, iterate over existing lines.
2. For each non-group/kit line:
   - Set `price` to the value returned by `getSubsidiaryPriceLevel()`.
   - Clear `custcol_mergn_desc_solicitado`, `custcol_margen_aplicado`, `custcol_sang_monto_sobrecargo_apli`, and `custcol_precio_sin_margen`.
   - Let NetSuite re-source `rate` from the subsidiary price level.
3. Use `globalState.isRecalculating = true` around the loop to suppress `validateLine()` during the batch operation.

**Pseudo-code:**
```javascript
.then((customerData) => {
    const previousEsSubsidiaria = globalState.esSubsidiaria;
    globalState.limiteCliente = parseFloat(customerData.custentity_maxdiscount_margin_percent) || 0;
    globalState.esSubsidiaria = core.isSubsidiaryCustomer(customerData);
    rec.setValue({ fieldId: 'custbody_curr_cust_discount_limit', value: globalState.limiteCliente });

    if (globalState.esSubsidiaria && !previousEsSubsidiaria) {
        convertExistingLinesToSubsidiary(rec);
    }
    // ... continue with service-level lookup
});
```

**If the business decides against automatic conversion**, document TC-03 as *not implemented* and require users to re-select items or manually change the price level. Do **not** leave the behavior ambiguous.

### Step 4 — Clear margin residue when a line becomes intercompany (`CS_Margin_System.js`)

**Goal:** Avoid stale discount/margin/surcharge values on subsidiary lines.

**Change in the subsidiary branch of `postSourcing()` when `fieldId === 'item'` or `'units'`:**
```javascript
if (fieldId === 'item' || fieldId === 'units') {
    try {
        const priceLevelSubsidiaria = getSubsidiaryPriceLevel();
        const currentPriceLvl = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'price' });
        if (currentPriceLvl != priceLevelSubsidiaria) {
            console.log(`[CM_DEBUG] Forzando Nivel de Precio a Subsidiaria (${priceLevelSubsidiaria})...`);
            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: priceLevelSubsidiaria, ignoreFieldChange: false });
        }
        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_mergn_desc_solicitado', value: '', ignoreFieldChange: true });
        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_aplicado', value: '', ignoreFieldChange: true });
        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sang_monto_sobrecargo_apli', value: '', ignoreFieldChange: true });
        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_drt_sobre_cargo', value: false, ignoreFieldChange: true });
    } catch (e) {
        console.error('[CM_ERROR] Error en postSourcing para subsidiaria:', e);
    }
    return;
}
```

### Step 5 — Mitigate async race condition (`CS_Margin_System.js`)

**Goal:** Reduce the chance of adding lines before `handleCustomerChange()` resolves.

**Recommended minimum change:**
- Set a transient flag `globalState.isLoadingCustomer = true` at the start of `handleCustomerChange()` and clear it in both `.then()` and `.catch()`.
- In `postSourcing()` / `validateLine()`, if `isLoadingCustomer` is true, log a warning and defer to the default NetSuite behavior (do not force price levels or validate margins).

**Preferred change (if UX allows):** Disable the item sublist while the customer lookup is in flight. This may not be possible with the standard NetSuite client API; document the limitation if not implemented.

### Step 6 — Add unit tests for `isSubsidiaryCustomer()`

Create or extend a Jest test file for `CM_Margin_System_Core.js`.

**Minimum test cases:**
```javascript
describe('isSubsidiaryCustomer', () => {
    it('returns false when customerData is null/undefined', () => {
        expect(isSubsidiaryCustomer(null)).toBe(false);
        expect(isSubsidiaryCustomer(undefined)).toBe(false);
    });
    it('returns true for boolean true', () => {
        expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: true })).toBe(true);
    });
    it('returns true for NetSuite checked string "T"', () => {
        expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: 'T' })).toBe(true);
    });
    it('returns false for NetSuite unchecked string "F"', () => {
        expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: 'F' })).toBe(false);
    });
    it('returns false for boolean false', () => {
        expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: false })).toBe(false);
    });
    it('returns false for empty string and 0', () => {
        expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: '' })).toBe(false);
        expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: 0 })).toBe(false);
    });
});
```

## Acceptance Criteria

- [ ] `isSubsidiaryCustomer()` passes all unit tests above and does not use `!!`.
- [ ] Clearing the customer sets `globalState.esSubsidiaria = false`.
- [ ] Switching a normal customer to a subsidiary either (a) recalculates all existing lines to the subsidiary price level and clears margin fields, or (b) is explicitly documented as not supported.
- [ ] Adding a new item line to a subsidiary customer still forces the price level and skips margin/surcharge logic.
- [ ] Saving an intercompany transaction does not trigger margin hierarchy validation in `UE_Margin_System_Keeper.js`.
- [ ] `suitecloud project:validate` passes with **0 errors**.
- [ ] Legacy behavior for normal customers remains unchanged (TC-02 regression test).

## Test Cases

| ID | Scenario | Expected Result |
|---|---|---|
| TC-01 | Subsidiary customer, add item | `price = 6` (or configured level), rate sourced by NetSuite, no discount/surcharge applied |
| TC-02 | Normal customer | Existing margin/surcharge flow unchanged |
| TC-03a | Normal → subsidiary with existing lines (if implemented) | Lines switch to subsidiary price level; margin fields cleared |
| TC-03b | Normal → subsidiary with existing lines (if not implemented) | Behavior documented; user instructed to re-select items |
| TC-04 | Save subsidiary transaction with manual discount entered | Saves without margin validation error |
| TC-05 | Checkbox returns `"F"` | Customer treated as normal (not subsidiary) |
| TC-06 | Clear customer after selecting subsidiary | `globalState.esSubsidiaria` becomes `false`; next line behaves as normal customer |

## Risks and Notes

- **Existing-line conversion (TC-03)** must be confirmed with the business. Automatic conversion changes user-visible prices without an explicit per-line action.
- The **async race condition** cannot be fully eliminated in client scripts; the recommended flag/logging change reduces silent misbehavior.
- Do **not** modify `UE_Margin_System_Keeper.js` beyond the current intercompany skip unless the User Event / core alignment is explicitly requested.
- Do **not** run `suitecloud project:deploy` or `suitecloud file:upload` without explicit user authorization.
- Always re-validate with `suitecloud project:validate` after code changes.

## Implementation Prompt (copy-paste ready for a coder agent)

```text
Implement the refactor plan in planes/2026-11-24_plan_refactorizacion_intercompania.md for commit 857911e of the Almetal margin system.

Focus on:
1. Harden CM_Margin_System_Core.isSubsidiaryCustomer() to safely handle boolean, 'T', 'Y', 1, '1' as true and everything else (especially 'F', false, 0, '') as false. Add Jest unit tests.
2. In CS_Margin_System.js, reset globalState.esSubsidiaria when the customer is cleared.
3. Implement automatic conversion of existing item lines to the subsidiary price level when the header customer changes from normal to subsidiary (TC-03). Use globalState.isRecalculating to suppress validateLine during the batch. Clear margin/surcharge fields on those lines.
4. In the subsidiary postSourcing branch, clear custcol_mergn_desc_solicitado, custcol_margen_aplicado, custcol_sang_monto_sobrecargo_apli, and set custcol_drt_sobre_cargo to false.
5. Add a guard flag (globalState.isLoadingCustomer) to reduce race-condition impact while handleCustomerChange() resolves.

Keep all existing behavior for normal customers unchanged. Do not modify UE_Margin_System_Keeper.js. Do not deploy. Run suitecloud project:validate when done and report 0 errors.
```
