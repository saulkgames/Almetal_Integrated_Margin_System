# Plan: Soporte intercompañía (subsidiarias) — v2

## 0. Control
| Campo | Valor |
|---|---|
| Fecha | 2026-11-24 |
| Versión | v2 |
| Estado | Aprobado |
| Solicitante | Almetal |
| Entidades afectadas | Clientes subsidiaria (intercompañía) |

**Historial de cambios**
- v1: borrador inicial con supuestos.
- v2: confirmado price level id 6, detección por checkbox `custentity_alm_check_intercompania`, sin margen informativo.

## 1. Objetivo
Habilitar transacciones con clientes subsidiaria usando el price level "SUBSIDIARIAS" (id 6) ya calculado, sin aplicar descuentos ni sobrecargo de corte, y omitiendo la validación de jerarquía de descuentos.

## 2. Alcance
- **Incluye**: `Estimate`, `Sales Order`, `Invoice`, `Cash Sale`.
- **Aplica a líneas donde el cliente de cabecera tenga** `custentity_alm_check_intercompania = T`.
- **No incluye**: recálculo del precio subsidiaria (ya está en el nivel 6), almacenamiento de margen propio, ni aviso informativo de margen.

## 3. Situación actual
- `CS_Margin_System.js` fuerza `price = 1` (Base) en `postSourcing`.
- `evaluateLineRules` recalcula `rate` con descuento y agrega sobrecargo de corte.
- `validateLine` valida jerarquía artículo → cliente → usuario.
- `UE_Margin_System_Keeper.js` valida la misma jerarquía en `beforeSubmit`.
- No existe detección de subsidiaria.

## 4. Arquitectura de la solución
| Componente | Tipo | Disparador | Responsabilidad |
|---|---|---|---|
| `CS_Margin_System.js` | Client Script | Cambio de artículo/unidad/cliente | Detectar subsidiaria, forzar price level 6, omitir descuentos y sobrecargo. |
| `UE_Margin_System_Keeper.js` | User Event Script | `beforeSubmit` | Omitir validación de jerarquía para subsidiarias. |
| `CM_Margin_System_Core.js` | Custom Module | — | Extensión mínima: regla pura `isSubsidiaryCustomer`. |

### 4.1 Nivel de arquitectura
**Nivel 1** (reglas puras testeables). Se conserva el core puro existente y se agrega una función simple de detección para poder probarla sin cuenta NetSuite.

### 4.2 Casos de uso y reglas
| Caso de uso | Entrada | Salida | Reglas |
|---|---|---|---|
| UC-01 Seleccionar cliente subsidiaria | `customerData.custentity_alm_check_intercompania = T` | `globalState.esSubsidiaria = true` | RN-01 |
| UC-02 Agregar artículo a subsidiaria | item + units | `price = 6`, `rate` por sourcing de NetSuite | RN-02, RN-03 |
| UC-03 Guardar transacción subsidiaria | Líneas con `price = 6` | Sin validación de descuento | RN-04 |

### 4.3 Patrones de diseño
| Patrón | Dónde | Justificación |
|---|---|---|
| Guard Clause | `CS_Margin_System.js` y `UE_Margin_System_Keeper.js` | Retornar temprano cuando `esSubsidiaria`, evitando anidar lógica. |
| Strategy implícito | `postSourcing` de `CS_Margin_System.js` | Ruta alterna de precio: base (1) vs subsidiaria (6). |

### 4.4 Estructura de archivos
Sin cambios estructurales. Se modifican:
- `src/FileCabinet/SuiteScripts/sistema_margenes/CS_Margin_System.js`
- `src/FileCabinet/SuiteScripts/sistema_margenes/UE_Margin_System_Keeper.js`
- `src/FileCabinet/SuiteScripts/sistema_margenes/CM_Margin_System_Core.js`
- `src/Objects/Custom Fields/Custentity/custentity_alm_check_intercompania.xml`

## 5. Modelo de datos
### 5.1 Registros y campos existentes
| Registro | Campo | Tipo | Uso |
|---|---|---|---|
| Customer | `custentity_alm_check_intercompania` | Checkbox | Detectar subsidiaria; se activará para customer. |
| Transaction line | `price` | Select | Forzar a id 6 para subsidiarias. |
| Transaction line | `rate` | Currency | Precio subsidiaria (sourcing de NetSuite). |
| Transaction line | `custcol_mergn_desc_solicitado` | Percent | Ignorar para subsidiarias. |
| Transaction line | `custcol_drt_sobre_cargo` | Checkbox | Ignorar para subsidiarias. |

### 5.2 Objetos nuevos
Ninguno.

## 6. Lógica por componente
### CS_Margin_System.js
1. Agregar a `globalState`: `esSubsidiaria: false`.
2. En `handleCustomerChange`, agregar la columna `custentity_alm_check_intercompania` al `search.lookupFields.promise` del cliente; setear `globalState.esSubsidiaria`.
3. En `postSourcing` (cambio de `item` o `units`): si `esSubsidiaria`, forzar `price` al parámetro `CUSTPARAM_PRICE_LVL_SUBSIDIARIA` (default 6); no forzar a 1; no ejecutar `backupBasePrice` ni `evaluateLineRules`.
4. En `evaluateLineRules`: si `esSubsidiaria`, retornar inmediatamente.
5. En `validateLine`: si `esSubsidiaria`, retornar `true`.

### UE_Margin_System_Keeper.js
1. En `beforeSubmit`, agregar la columna `custentity_alm_check_intercompania` al `search.lookupFields` del cliente.
2. Si el cliente es subsidiaria, omitir completamente el ciclo de validación en cascada.

### CM_Margin_System_Core.js
1. Agregar función pura `isSubsidiaryCustomer(customerData)` que retorne boolean según el valor del checkbox.

## 7. Gobernanza y rendimiento
| Componente | Operación | Cambio |
|---|---|---|
| CS `handleCustomerChange` | `lookupFields` del cliente | +1 columna |
| UE `beforeSubmit` | `lookupFields` del cliente | +1 columna |
| CS `postSourcing` | `setCurrentSublistValue` de `price` | Sin cambio en conteo de operaciones |

**Total estimado**: 0 unidades de gobernanza adicionales.

## 8. Manejo de errores y bitácora
- Si `custentity_alm_check_intercompania` no está disponible para clientes, registrar warning y tratar al cliente como normal.
- Si el price level 6 no trae `rate`, registrar error y no bloquear (permite intervención manual).

## 9. Seguridad y permisos
- El script corre con los roles actuales.
- El checkbox debe ser editable por administradores o roles de mantenimiento de clientes.

## 10. Consideraciones fiscales
No aplica.

## 11. Riesgos
| ID | Enunciado | Fundamento | Consecuencia | Mitigación |
|---|---|---|---|---|
| R1 | Price level 6 inactivo o sin precios configurados | Configuración | Línea queda sin precio o usa base | Validar en sandbox; log warning |
| R2 | Checkbox no aplicado a clientes | SDF / configuración | Subsidiarias tratadas como clientes normales | Revisar XML del campo antes de deploy |

## 12. Plan de pruebas
| Caso | Datos de entrada | Resultado esperado | Tipo |
|---|---|---|---|
| TC-01 | Cliente subsidiaria, agregar artículo | `price = 6`, `rate` = precio subsidiaria, sin descuento ni sobrecargo | Feliz |
| TC-02 | Cliente normal | Flujo actual sin cambios | Feliz |
| TC-03 | Cambiar cliente normal → subsidiaria con líneas existentes | Líneas cambian a `price = 6` | Borde |
| TC-04 | Guardar transacción subsidiaria con descuento ingresado | Guarda sin error (validación omitida) | Borde |

## 13. Despliegue
1. Activar `custentity_alm_check_intercompania` para clientes (SDF deploy del XML modificado).
2. Deploy de los scripts modificados.
3. Marcar el checkbox en los registros de cliente que son subsidiarias.
4. Ejecutar en sandbox: TC-01 a TC-04.

## 14. Decisiones abiertas
Ninguna.

## 15. Supuestos y fuentes
1. Price level "SUBSIDIARIAS" = id 6 (confirmado por solicitante).
2. `custentity_alm_check_intercompania` existe desplegado para vendor; se activará para customer (confirmado por solicitante).
3. El price level 6 contiene precios por artículo correctos (confirmado por solicitante).
