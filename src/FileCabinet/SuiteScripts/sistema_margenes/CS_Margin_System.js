/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @description Controlador de interfaz de usuario para inyección de precios y validación de reglas en líneas.
 */

define(['N/ui/dialog', 'N/currentRecord', './CM_Margin_System_Core'], (dialog, currentRecord, core) => {

    // Variable global para cachear límites de cabecera y evitar llamadas excesivas al DOM
    const globalState = {
        limiteCliente: 0,
        limiteUsuario: 0, // Inyectado por UE
        reduccionServicioActual: 0, // Nombre estandarizado
        nivelesEnvio: { noEnvio: 0, envioHoy: 0, envioDias: 0 },
        isRecalculating: false
    };

    /**
     * GATILLO 1: (Manejado por el User Event). Aquí solo leemos lo que el UE inyectó.
     */
    const pageInit = (context) => {
        const rec = context.currentRecord;
        // (Ajustar ID del campo)
        globalState.limiteUsuario = parseFloat(rec.getValue({ fieldId: 'custbody_curr_user_discount_limit' })) || 0;
    };
    /**
     * Ejecuta el recálculo e inyección del precio ante cambios en los campos gatillo.
     */
    const fieldChanged = (context) => {
        const { currentRecord: rec, sublistId, fieldId } = context;

        // --- GATILLO 2: CAMBIO DE CLIENTE ---
        if (fieldId === 'entity') {
            const customerId = rec.getValue({ fieldId: 'entity' });
            if (!customerId) return; // Si borraron el cliente, no hacemos nada

            // Búsqueda Asíncrona (Promise) al Custom Record de Niveles de Servicio
            search.lookupFields.promise({
                type: 'customrecord_margin_system_lvl_service', // Asumiendo que el ID del cliente mapea a este registro
                id: customerId, // Ajustar lógica de búsqueda si el ID no es directo
                columns: ['custrecord_serv_lvl_noenvio', 'custrecord_serv_lvl_enviohoy', 'custrecord_serv_lvl_enviodias']
            }).then((result) => {
                // Guardamos en caché
                globalState.nivelesEnvio = {
                    noEnvio: parseFloat(result.custrecord_serv_lvl_noenvio) || 0,
                    envioHoy: parseFloat(result.custrecord_serv_lvl_enviohoy) || 0,
                    envioDias: parseFloat(result.custrecord_serv_lvl_enviodias) || 0
                };
                // Opcional: Guardar esto en un campo de texto oculto en formato JSON (JSON.stringify)
            }).catch((e) => {
                console.error('Error obteniendo niveles de servicio:', e);
            });
            return;
        }

        // --- GATILLO 3: CAMBIO EN TÉRMINOS DE ENTREGA ---
        if (fieldId === 'custbody_termino_entrega') { // (Ajustar ID del campo)
            const terminoSeleccionado = rec.getValue({ fieldId: 'custbody_termino_entrega' });// (Ajustar ID del campo)

            // 1. Mapear el término seleccionado a la reducción (Ejemplo hipotético)
            if (terminoSeleccionado === '1') globalState.reduccionServicioActual = globalState.nivelesEnvio.envioHoy;
            else if (terminoSeleccionado === '2') globalState.reduccionServicioActual = globalState.nivelesEnvio.envioDias;
            else globalState.reduccionServicioActual = 0;

            // (Ajustar ID del campo)
            rec.setValue({ fieldId: 'custbody_hidden_serv_lvl_reduction', value: globalState.reduccionServicioActual, ignoreFieldChange: true });

            // 2. El Patrón de Recálculo Interactivo
            const lineCount = rec.getLineCount({ sublistId: 'item' });
            if (lineCount > 0 && !globalState.isRecalculating) {
                dialog.confirm({
                    title: 'Cambio de Condiciones',
                    message: 'El término de entrega ha cambiado, lo que afecta las capacidades de descuento. ¿Deseas recalcular los límites de las líneas existentes?'
                }).then((success) => {
                    if (success) {
                        globalState.isRecalculating = true;
                        // Bucle for para hacer selectLine y commitLine sobre cada artículo, inyectando la nueva reducción
                        for (let i = 0; i < lineCount; i++) {
                            rec.selectLine({ sublistId: 'item', line: i });
                            // Tu lógica del 'core' se ejecuta aquí
                            rec.commitLine({ sublistId: 'item' });
                        }
                        globalState.isRecalculating = false;
                    }
                });
            }
            return;
        }
        // Limitar ejecución estrictamente a la sublista de artículos
        if (sublistId !== 'item') return;

        // (Ajustar IDs de campos)
        const triggers = ['custcol_margen_desc_solicitado', 'quantity', 'item', 'price', 'rate'];
        if (!triggers.includes(fieldId)) return;

        const itemType = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemtype' });
        const descSolicitado = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_desc_solicitado' })) || 0; // (Ajustar ID del campo)

        // Filtro de exclusión temprana
        if (itemType === 'Group' || itemType === 'Kit' || itemType === 'EndGroup' || descSolicitado === 0) {
            return;
        }

        const params = {
            precioBase: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' })) || 0,
            margenEstandar: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_estandar' })) || 0, // (Ajustar ID del campo)
            descMargenSolicitado: descSolicitado,
            descMargenServicio: globalState.reduccionServicioActual,
            margenMinimoItem: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_minimo_item' })) || 0, // (Ajustar ID del campo)
            limiteCliente: globalState.limiteCliente,
            limiteUsuario: globalState.limiteUsuario
        };

        const result = core.validateMarginRule(params);

        if (result.isValid) {
            // (Ajustar ID del campo)
            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'price',
                value: -1,
                ignoreFieldChange: true // Previene loop de ejecución de fieldChanged
            });

            // Inyección del precio unitario procesado
            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                value: result.finalPrice,
                ignoreFieldChange: true // Previene loop de ejecución de fieldChanged
            });

            // (Ajustar ID del campo)
            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_margen_aplicado',
                value: result.appliedMargin,
                ignoreFieldChange: true
            });
        }
    };

    /**
     * Realiza el bloqueo final antes de permitir que la línea ingrese al sistema.
     */
    const validateLine = (context) => {
        const { currentRecord: rec, sublistId } = context;

        if (sublistId !== 'item') return true;

        const itemType = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemtype' });
        const descSolicitado = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_desc_solicitado' })) || 0; // (Ajustar ID del campo)

        // Filtro de exclusión
        if (itemType === 'Group' || itemType === 'Kit' || itemType === 'EndGroup' || descSolicitado === 0) {
            return true;
        }

        const params = {
            precioBase: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' })) || 0,
            margenEstandar: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_estandar' })) || 0, // (Ajustar ID del campo)
            descMargenSolicitado: descSolicitado,
            descMargenServicio: globalState.reduccionServicioActual,
            margenMinimoItem: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_minimo_item' })) || 0, // (Ajustar ID del campo)  
            limiteCliente: globalState.limiteCliente,
            limiteUsuario: globalState.limiteUsuario
        };

        const result = core.validateMarginRule(params);

        if (!result.isValid) {
            // Genera la alerta asíncrona de NetSuite
            dialog.alert({
                title: 'Restricción de Margen Comercial',
                message: result.errorMessage
            });
            // Bloquea síncronamente el commit de la línea
            return false;
        }

        return true;
    };

    return {
        pageInit,
        fieldChanged,
        validateLine
    };
});