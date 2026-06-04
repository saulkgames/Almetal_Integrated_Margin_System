# Release Notes: Refactorización Client Script de Sistema de Márgenes

**Nombre del Script:** `CM_CS_Margin_System.js`
**Tipo:** Client Script (API 2.1)
**Módulo Scope:** `SameAccount`

## Dependencias
* `N/ui/dialog`: Para alertas asíncronas e interacción de confirmación con el usuario.
* `N/search`: Para recuperación asíncrona de niveles de servicio vía `lookupFields.promise`.
* `./CM_Margin_System_Core`: Módulo custom interno que centraliza la lógica de negocio y las matemáticas detrás de las reglas de margen.

## Explicación Técnica

Este desarrollo refactoriza el comportamiento interactivo del cálculo de márgenes a nivel de interfaz de usuario. Se introdujeron las siguientes mejoras y patrones:

1. **Gestión de Estado Global (`globalState`)**
   Se implementó un objeto de estado para cachear valores estáticos y semidinámicos (límites de usuario, cliente, término de entrega anterior y reducciones actuales). Esto minimiza las lecturas constantes al DOM de la transacción y permite mantener consistencia de datos durante operaciones asíncronas.

2. **Mitigación de Race Conditions (Bloqueo de UI)**
   Al cambiar el cliente (`entity`), se lanza una promesa para traer datos cruzados. Para evitar que el usuario tabule rápidamente e interactúe con los términos de entrega antes de que la promesa resuelva, se bloquea (`isDisabled = true`) temporalmente el campo `custbody_termino_entrega` y se libera en las resoluciones `.then()` y `.catch()`.

3. **Recálculo Iterativo Optimizado**
   Cuando un nuevo término de entrega reduce la capacidad de descuento, el script evalúa las líneas existentes. Para proteger el rendimiento en el navegador (límite de gobernanza de Client Scripts vs latencia de DOM), se utiliza `getSublistValue` para leer el estado de la línea sin seleccionarla. Solo si el descuento de la línea viola el nuevo límite, se hace el ciclo `selectLine` -> `commitLine`.

4. **Rollback Asíncrono Defensivo**
   Si el usuario rechaza la advertencia de reducción de capacidades, se debe revertir el campo de términos de entrega. Dado un comportamiento conocido de renderizado en NetSuite (donde reversiones síncronas a veces generan un "ghosting" del valor no deseado en la UI), el `setValue` del rollback se inyectó en un `setTimeout` de 0ms para delegar la actualización a la cola de eventos del navegador.

## Instrucciones de Despliegue
* **Registros de aplicación:** Este script debe ser desplegado sobre los registros de tipo Transacción donde aplique la venta (ej. *Sales Order*, *Estimate/Quote*).
* **Campos Requeridos (Verificar IDs en entorno):** * `custbody_curr_user_discount_limit`
  * `custbody_termino_entrega`
  * `custbody_hidden_serv_lvl_reduction`
  * `custcol_margen_desc_solicitado`, `custcol_margen_estandar`, `custcol_margen_minimo_item`, `custcol_margen_aplicado`.
* **Roles:** No se requiere configuración de Ejecución como Administrador a nivel script, pero sí asegurar que el rol de ventas tenga permisos de vista al Custom Record `customrecord_margin_system_lvl_service`.

## Límites de Gobernanza y Consideraciones
A nivel de puntos de uso, los Client Scripts rara vez exceden el límite de 1000 unidades. Sin embargo, el principal riesgo es el tiempo de ejecución en cliente (browser freeze). 
La optimización con `getSublistValue` mitiga este problema, pero en transacciones atípicamente grandes (más de 300 líneas de artículos) donde todas requieran recálculo, el usuario experimentará un leve cuelgue de pantalla mientras el bucle hace el `commitLine`. Si la operación de NetSuite emite un error de timeout en consola para estos escenarios, se recomienda en un futuro evaluar una transición del recálculo pesado hacia la capa del User Event.