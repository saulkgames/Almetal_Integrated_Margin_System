# Tarea: Soporte intercompañía (subsidiarias) en Sistema de Márgenes

## Rol
Eres un desarrollador senior de SuiteScript 2.1 para NetSuite. Implementas exactamente el diseño aprobado que sigue. No cambies reglas de negocio ni IDs. Si detectas una contradicción o un dato faltante, detente y repórtalo en lugar de suponer.

## Contexto
- Empresa: Almetal, grupo industrial mexicano multi-subsidiaria.
- Proyecto: Sistema de Márgenes Integrado sobre transacciones `Estimate`, `Sales Order`, `Invoice` y `Cash Sale`.
- Problema: el Client Script fuerza siempre `price = 1` (Base), lo que impide usar el price level "SUBSIDIARIAS" (id 6) para clientes subsidiaria.
- Solución aprobada: detectar clientes subsidiaria mediante el checkbox `custentity_alm_check_intercompania`; para ellos, forzar price level 6 y omitir descuentos, sobrecargo de corte y validación de jerarquía de descuentos.

## Entregables
| Archivo | Tipo de script | scriptid | Ruta en el proyecto |
|---|---|---|---|
| `CS_Margin_System.js` | ClientScript | `customscriptcs_margin_system` | `src/FileCabinet/SuiteScripts/sistema_margenes/` |
| `UE_Margin_System_Keeper.js` | UserEventScript | `customscriptue_margin_system_keeper` | `src/FileCabinet/SuiteScripts/sistema_margenes/` |
| `CM_Margin_System_Core.js` | CustomModule | — | `src/FileCabinet/SuiteScripts/sistema_margenes/` |
| `custentity_alm_check_intercompania.xml` | entitycustomfield | `custentity_alm_check_intercompania` | `src/Objects/Custom Fields/Custentity/` |

## Estructura de archivos
Sin cambios estructurales. Modificar los archivos existentes del proyecto SDF.

## Arquitectura
- **Nivel de arquitectura: 1** (reglas puras testeables).
- Se extiende el core puro existente con una función simple de detección de subsidiaria.
- Los entry points (`CS_`, `UE_`) conservan el acceso a módulos `N/`; el core no importa `N/`.

## Modelo de datos
- `custentity_alm_check_intercompania` (checkbox, `entitycustomfield`): activar para `customer`.
- Price level "SUBSIDIARIAS" = id 6. Usar parámetro de script `CUSTPARAM_PRICE_LVL_SUBSIDIARIA` con default `6`.

## Especificación por componente

### CS_Margin_System.js
1. Agregar a `globalState`: `esSubsidiaria: false`.
2. En `handleCustomerChange`, agregar la columna `custentity_alm_check_intercompania` al `search.lookupFields.promise` del cliente. Setear `globalState.esSubsidiaria = !!(customerData.custentity_alm_check_intercompania)`.
3. En `postSourcing` (cuando cambian `item` o `units`):
   - Si `esSubsidiaria`, forzar `price` al valor del parámetro `CUSTPARAM_PRICE_LVL_SUBSIDIARIA` (default 6) en vez de `1`.
   - No ejecutar `backupBasePrice`.
   - No ejecutar `evaluateLineRules`.
   - Dejar que NetSuite traiga el `rate` del price level 6 por sourcing.
4. En `evaluateLineRules`: si `esSubsidiaria`, retornar inmediatamente.
5. En `validateLine`: si `esSubsidiaria`, retornar `true`.

### UE_Margin_System_Keeper.js
1. En `beforeSubmit`, agregar la columna `custentity_alm_check_intercompania` al `search.lookupFields` del cliente.
2. Si el cliente es subsidiaria (`custentity_alm_check_intercompania === true`), omitir completamente el ciclo de validación en cascada de descuentos.

### CM_Margin_System_Core.js
1. Agregar función pura `isSubsidiaryCustomer(customerData)` que retorne un boolean según el valor de `customerData.custentity_alm_check_intercompania`.
2. La función no debe importar módulos `N/`.

### Objeto de campo
1. Modificar `custentity_alm_check_intercompania.xml` para que aplique a customer (`appliestocustomer = T`). Si el archivo no existe, crearlo como `entitycustomfield` con `appliestocustomer = T` y `appliestovendor` según corresponda.

## Restricciones técnicas
- SuiteScript 2.1.
- Módulos `N/*` estrictamente necesarios.
- Parámetro de script para el id del price level subsidiaria.
- No crear campos nuevos; reutilizar `custentity_alm_check_intercompania`.
- Mantener 100 % el flujo actual para clientes normales.
- Entry points delgados; reglas puras en `CM_Margin_System_Core.js`.
- Presupuesto de gobernanza: 0 unidades adicionales.

## Criterios de aceptación
- **TC-01**: Cliente subsidiaria (`custentity_alm_check_intercompania = T`), agregar artículo → `price = 6`, `rate` = precio del price level 6, sin descuento ni sobrecargo.
- **TC-02**: Cliente normal → flujo actual intacto (price = 1, descuentos, sobrecargo, jerarquía).
- **TC-03**: Cambiar cliente normal → subsidiaria con líneas existentes → líneas recalculan a `price = 6`.
- **TC-04**: Guardar transacción subsidiaria con descuento ingresado manualmente → guarda sin error (validación omitida).

## Despliegue
1. SDF deploy del XML del campo modificado.
2. SDF deploy de los scripts modificados.
3. Marcar el checkbox `custentity_alm_check_intercompania` en los registros de cliente que son subsidiarias.
4. Ejecutar pruebas TC-01 a TC-04 en sandbox.

## Formato de respuesta esperado
1. Lista de archivos creados/modificados.
2. Código completo por archivo, con JSDoc de encabezado (`@NApiVersion`, `@NScriptType`, `@NModuleScope`), incluidos archivos de prueba Jest para `CM_Margin_System_Core.js`.
3. Notas de desviación respecto del diseño, si las hubo, con justificación.
4. Checklist de pruebas marcado con qué casos se cubrieron.
