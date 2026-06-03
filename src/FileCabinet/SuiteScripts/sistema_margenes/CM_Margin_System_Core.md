# Notas de Release: Sistema de Márgenes Core

**Archivo:** `CM_Margin_System_Core.js`  
**Tipo:** SuiteScript 2.1 Custom Module  

## Dependencias
- `N/log`: Para trazabilidad de entradas, variables matemáticas intermedias y auditoría del estado final.
- `N/error`: Para forzar detenciones controladas si se detectan anomalías matemáticas irrecuperables (ej. margen igual o mayor al 100%).
- `N/format`: Importado por estándar de módulo, disponible para conversiones futuras si el script llamador envía cadenas en lugar de números.

## Descripción Técnica
Este módulo opera como un motor de cálculo puro y sin estado para validar la viabilidad financiera de una transacción. Recibe valores monetarios y porcentajes (en base 1 decimal) a través de un objeto de parámetros, sin interactuar de forma directa con la base de datos de NetSuite (cero impacto en límites de gobernanza).

El flujo de procesamiento consta de dos partes:
1. **Transformación Matemática:** Determina el margen real tras aplicar los descuentos y beneficios de servicio, calcula el precio de venta sugerido basado en el costo, y traduce esto a un porcentaje de descuento nativo entendible por los campos estándar de línea de NetSuite. Incorpora redondeo IEEE 754 (`Number.EPSILON`) en el cálculo del precio final para evitar que los campos de moneda rechacen el valor por exceso de precisión, y una cláusula de seguridad para evitar divisiones por cero si el artículo tiene un precio base nulo.
2. **Evaluación Jerárquica:** Evalúa el resultado contra tres niveles de reglas de negocio (Artículo, Cliente, Empleado). Se interrumpe en la primera regla que falle, retornando un mensaje claro para su renderizado en la interfaz.

## Instrucciones de Despliegue e Integración
- Subir el archivo al File Cabinet en la carpeta `SuiteScripts/Modules` (o la ruta correspondiente de librerías del proyecto).
- Este script no se despliega en ningún registro directamente. Debe inyectarse como dependencia en los scripts de interfaz (User Event, Client Script, Map/Reduce) utilizando la sintaxis de definición Require/Define:
  `define(['./CM_Margin_System_Core'], (marginCore) => { ... })`
- **Requisito de Entrada:** El script llamador es totalmente responsable de transformar los porcentajes de la interfaz (ej. `12.5%`) a formato decimal nativo (`0.125`) antes de pasarlos a la función `marginCore.validateMarginRule(params)`.
- **Manejo del Retorno:** El script llamador debe evaluar la bandera `isValid` de la respuesta JSON. Si es `false`, se debe utilizar `errorMessage` para bloquear la transacción (`return false` en un `validateLine` de Client Script, o lanzar una excepción en un `beforeSubmit` de User Event).

## Consideraciones de Gobernanza y Mantenimiento
- **Consumo:** Este módulo consume 0 unidades de gobierno. Su rendimiento está sujeto únicamente al tiempo de CPU que toma procesar los cálculos aritméticos.
- **Riesgos y Casos Borde:** - Si el `costo` proporcionado es 0 (ej. artículos de inventario mal configurados o servicios), el `finalPrice` resultante será 0. Validar en el script llamador si se permite vender artículos sin costo asociado.
  - El motor captura los errores en un bloque `try/catch` general. Si ocurre una excepción interna no mapeada (ej. el script llamador omite propiedades obligatorias), el motor no arrojará un error fatal a NetSuite, sino que devolverá un JSON con `isValid: false` y la descripción técnica de la falla en `errorMessage`, delegando la acción de bloqueo al script llamador.