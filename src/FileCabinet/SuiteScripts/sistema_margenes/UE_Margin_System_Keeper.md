# Release Notes: Sistema de Validación de Márgenes de Descuento

**Archivo:** `UE_Margin_System_Keeper.js`  
**Tipo:** User Event Script  
**Versión API:** SuiteScript 2.1  
**Autor:** Saul Ivan Angulo Varela

## Descripción General
Este script implementa un control de gobernanza comercial a nivel de base de datos (Backend) para transacciones de venta. Actúa como un guardián en el evento `beforeSubmit`, bloqueando el guardado del registro si alguna línea de artículo contiene un descuento que infringe las reglas de negocio establecidas.

## Dependencias
* `N/search`: Para realizar `lookupFields` en los registros vinculados (Cliente y Empleado).
* `N/runtime`: Para identificar al usuario activo que está ejecutando la acción de guardado.
* `N/error`: Para generar y lanzar excepciones personalizadas que detengan la transacción y notifiquen al usuario en pantalla.

## Lógica Técnica
El script se ejecuta exclusivamente en los contextos `CREATE` y `EDIT`. La validación sigue una estructura en cascada:

1. **Recolección de Límites (Tiempo Real):** En lugar de depender de campos en la cabecera del formulario (que pueden ser manipulados o quedar obsoletos durante una sesión de edición prolongada), el script extrae el límite de descuento directamente de la ficha del Empleado activo (`runtime.getCurrentUser()`) y de la ficha del Cliente vinculado.
2. **Normalización de Penalización:** El campo oculto de reducción de nivel de servicio (`custbody_hidden_serv_lvl_reduction`) se normaliza a decimal en caso de que un flujo previo lo inserte como porcentaje entero, previniendo multiplicaciones negativas que rompan la lógica de margen.
3. **Iteración de Líneas:** Recorre la sublista `item` omitiendo artículos de tipo `Group`, `Kit` y `EndGroup`.
4. **Validación Estricta:** Compara el descuento solicitado (`custcol_margen_desc_solicitado`) contra tres variables:
   * Capacidad del artículo (`custcol_maxdiscount_margin_percent`).
   * Límite neto del cliente (Límite base * Penalización de servicio).
   * Límite de autoridad del vendedor.
5. **Bloqueo:** Si cualquier regla falla, lanza un error síncrono que bloquea el `Submit` y muestra una alerta en la UI indicando la línea exacta y el límite excedido.

## Instrucciones de Despliegue
* **Registros Aplicados:** Desplegar en *Sales Order*, *Cash Sale*, *Invoice* y *Estimate*.
* **Roles:** El script debe ejecutarse bajo el rol actual del usuario para respetar los contextos, salvo que el campo de empleado/cliente esté restringido por permisos; en dicho caso, configurar el script para ejecutarse como Administrador en el despliegue.
* **Mapeo de Campos:** Antes de desplegar, es necesario buscar en el código las etiquetas `// <-- (Ajustar ID del campo)` y colocar los IDs de los campos personalizados reales del entorno.

## Gobernanza y Consideraciones
* **Uso de Unidades:** El script consume exactamente **2 unidades de gobernanza** por ejecución en cabecera (dos `search.lookupFields`). La iteración de la sublista no consume unidades adicionales al leerse en memoria.
* **Eficiencia:** Se eliminó el punto de entrada `beforeLoad` del diseño original para evitar consultas innecesarias en la carga de la interfaz, concentrando el costo computacional únicamente en el intento de guardado real.
* **Manejo de Errores:** Si un campo personalizado es eliminado accidentalmente, el bloque `catch` atrapará el error de script nativo y lanzará una excepción genérica `ERR_SISTEMA_MARGENES` mostrando la causa exacta (`e.message`), facilitando su resolución en soporte.