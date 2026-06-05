/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 * @description Controlador de interfaz de usuario para inyección de precios, estado global y validación de reglas en líneas.
 */

define(['N/ui/dialog', 'N/search', './CM_Margin_System_Core'], (dialog, search, core) => {

    // Estado global para cachear límites y controlar el flujo de la UI
    const globalState = {
        limiteCliente: 0,
        limiteUsuario: 0,
        reduccionServicioActual: 0,
        nivelesEnvio: { noEnvio: 0, envioHoy: 0, envioDias: 0 },
        isRecalculating: false,
        terminoEntregaAnterior: null
    };

    /**
     * GATILLO 1: Inicialización de la página. Se lee el estado base inyectado por User Event.
     */
    const pageInit = (context) => {
        const rec = context.currentRecord;

        globalState.limiteUsuario = parseFloat(rec.getValue({ fieldId: 'custbody_curr_user_discount_limit' })) || 0;
        globalState.terminoEntregaAnterior = rec.getValue({ fieldId: 'custbody_freigth_service_terms' });

        console.log('[CM_DEBUG] pageInit completado. Estado inicial:', JSON.stringify(globalState));
    };

    /**
     * GATILLO 2 y 3: Manejador central de cambios en cabecera y líneas.
     * Delega la responsabilidad a funciones auxiliares (helpers) para mantener el código limpio.
     */
    const fieldChanged = (context) => {
        const { currentRecord: rec, sublistId, fieldId } = context;

        if (fieldId === 'entity') {
            handleCustomerChange(rec);
            return;
        }

        if (fieldId === 'custbody_freigth_service_terms') {
            handleTermsChange(rec);
            return;
        }

        // Si es cambio a nivel de línea en la sublista de artículos
        if (sublistId === 'item') {
            evaluateLineRules(rec, fieldId);
        }
    };

    /**
     * GATILLO 4: Bloqueo final antes de permitir que la línea ingrese al sistema.
     */
    const validateLine = (context) => {
        const { currentRecord: rec, sublistId } = context;

        if (sublistId !== 'item') return true;

        // Silenciar bloqueos durante el auto-ajuste iterativo
        if (globalState.isRecalculating) return true;

        const itemType = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemtype' });
        const descSolicitado = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_mergn_desc_solicitado' })) || 0;

        if (itemType === 'Group' || itemType === 'Kit' || itemType === 'EndGroup' || descSolicitado === 0) {
            return true;
        }

        const params = {
            precioBase: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' })) || 0,
            margenEstandar: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_estandar' })) || 0,
            descMargenSolicitado: descSolicitado,
            descMargenServicio: globalState.reduccionServicioActual,
            limiteArticulo: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_maxdiscount_margin_percent' })) || 0,
            limiteCliente: globalState.limiteCliente,
            limiteUsuario: globalState.limiteUsuario
        };

        const result = core.validateMarginRule(params);

        if (!result.isValid) {
            dialog.alert({
                title: 'Restricción de Margen Comercial',
                message: result.errorMessage
            });
            return false;
        }

        return true;
    };

    // ========================================================================
    // FUNCIONES AUXILIARES (HELPERS)
    // ========================================================================

    /**
     * Maneja el cambio de cliente obteniendo su límite y los niveles de servicio asociados.
     * Implementa Promise Chaining para cruzar registros y previene race conditions.
     */
    const handleCustomerChange = (rec) => {
        const customerId = rec.getValue({ fieldId: 'entity' });
        if (!customerId) {
            globalState.limiteCliente = 0;
            globalState.nivelesEnvio = { noEnvio: 0, envioHoy: 0, envioDias: 0 };
            return;
        }

        const termsField = rec.getField({ fieldId: 'custbody_freigth_service_terms' });
        if (termsField) termsField.isDisabled = true; // Prevención de Race Condition

        // PASO 1: Buscar datos directamente en el Cliente
        search.lookupFields.promise({
            type: search.Type.CUSTOMER,
            id: customerId,
            columns: [
                'custentity_maxdiscount_margin_percent',
                'custentity_custrec_service_level'
            ]
        }).then((customerData) => {
            // Asignación de Límite de Cliente (Solución a omisión)
            globalState.limiteCliente = parseFloat(customerData.custentity_maxdiscount_margin_percent) || 0;
            rec.setValue({ fieldId: 'custbody_curr_cust_discount_limit', value: globalState.limiteCliente });

            // Extraer de forma segura el Internal ID del Custom Record vinculado
            const serviceLevelField = customerData.custentity_custrec_service_level;
            const serviceLevelId = (serviceLevelField && serviceLevelField.length > 0)
                ? serviceLevelField[0].value
                : null;

            if (!serviceLevelId) {
                // Si el cliente no tiene un nivel de servicio asignado, limpiamos la caché
                globalState.nivelesEnvio = { noEnvio: 0, envioHoy: 0, envioDias: 0 };
                console.log('[CM_DEBUG] Cliente sin Nivel de Servicio asignado. Límite de cliente:', globalState.limiteCliente);
                if (termsField) termsField.isDisabled = false;
                return Promise.reject('NO_SERVICE_LEVEL'); // Salida temprana limpia
            }
            rec.setValue({ fieldId: 'custbody_customer_level_service_rec', value: serviceLevelId });
            // PASO 2: Buscar los porcentajes en el Custom Record usando el ID obtenido
            return search.lookupFields.promise({
                type: 'customrecord_margin_system_lvl_service',
                id: serviceLevelId,
                columns: ['custrecord_serv_lvl_noenvio', 'custrecord_serv_lvl_enviohoy', 'custrecord_serv_lvl_enviodias']
            });

        }).then((serviceData) => {
            if (serviceData) {
                globalState.nivelesEnvio = {
                    noEnvio: parseFloat(serviceData.custrecord_serv_lvl_noenvio) || 0,
                    envioHoy: parseFloat(serviceData.custrecord_serv_lvl_enviohoy) || 0,
                    envioDias: parseFloat(serviceData.custrecord_serv_lvl_enviodias) || 0
                };
                console.log('[CM_DEBUG] Promesas resueltas. Límite Cliente:', globalState.limiteCliente, '| Niveles:', globalState.nivelesEnvio);
            }
            if (termsField) termsField.isDisabled = false;

        }).catch((e) => {
            if (e !== 'NO_SERVICE_LEVEL') {
                console.error('Error obteniendo datos del cliente/servicio:', e);
            }
            if (termsField) termsField.isDisabled = false;
        });
    };

    /**
     * Evalúa el impacto al cambiar el término de entrega. 
     * Lanza advertencias y controla el flujo de recálculo o rollback.
     */
    const handleTermsChange = (rec) => {
        console.log('[CM_DEBUG] Cambio detectado en término de entrega. Evaluando impacto...');
        const terminoSeleccionado = rec.getValue({ fieldId: 'custbody_freigth_service_terms' });
        let nuevaReduccion = 0;

        // Mapeo exacto según XML: 1=HOY, 2=SIN ENVIO, 3=3 DIAS
        if (terminoSeleccionado === '1') {
            nuevaReduccion = globalState.nivelesEnvio.envioHoy;
        } else if (terminoSeleccionado === '2') {
            nuevaReduccion = globalState.nivelesEnvio.noEnvio;
        } else if (terminoSeleccionado === '3') {
            nuevaReduccion = globalState.nivelesEnvio.envioDias;
        }

        const lineCount = rec.getLineCount({ sublistId: 'item' });

        // Escenario A: Reducción es más estricta y existen líneas
        if (nuevaReduccion > globalState.reduccionServicioActual && lineCount > 0) {
            console.log(`[CM_DEBUG] Entrada al bloque de recálculo. Reducción vieja: ${globalState.reduccionServicioActual} | Nueva: ${nuevaReduccion}`);

            dialog.confirm({
                title: 'Cambio de Condiciones',
                message: 'Este término reduce la capacidad de descuento. Los precios se recalcularán al nuevo límite permitido. ¿Desea continuar?'
            }).then((success) => {
                if (success) {
                    processLineRecalculation(rec, nuevaReduccion, terminoSeleccionado, lineCount);
                } else {
                    // Rechazado: Ejecutar rollback al valor anterior.
                    // Se envuelve en setTimeout a 0ms para ceder el hilo al DOM de NetSuite y evitar "ghosting" visual en el dropdown.
                    setTimeout(() => {
                        rec.setValue({
                            fieldId: 'custbody_termino_entrega',
                            value: globalState.terminoEntregaAnterior,
                            ignoreFieldChange: true
                        });
                        console.log('[CM_DEBUG] Rollback de término de entrega ejecutado vía setTimeout.');
                    }, 0);
                }
            });
        }
        // Escenario B: Igual o más flexible
        else {
            globalState.reduccionServicioActual = nuevaReduccion;
            globalState.terminoEntregaAnterior = terminoSeleccionado;
            rec.setValue({ fieldId: 'custbody_cust_serv_lvl', value: globalState.reduccionServicioActual, ignoreFieldChange: true });
        }
    };

    /**
     * Realiza el recálculo iterativo solo sobre líneas que violan la nueva regla de negocio.
     */
    const processLineRecalculation = (rec, nuevaReduccion, nuevoTermino, lineCount) => {
        globalState.isRecalculating = true;
        globalState.reduccionServicioActual = nuevaReduccion;
        globalState.terminoEntregaAnterior = nuevoTermino;

        rec.setValue({ fieldId: 'custbody_cust_serv_lvl', value: globalState.reduccionServicioActual, ignoreFieldChange: true });

        for (let i = 0; i < lineCount; i++) {
            // 1. Lectura de variables de la línea sin seleccionarla
            const descSolicitado = parseFloat(rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mergn_desc_solicitado', line: i })) || 0;
            const limiteArticulo = parseFloat(rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_maxdiscount_margin_percent', line: i })) || 0;

            // 2. Cálculo de cascada: ¿Quién es el cuello de botella para esta línea específica?
            const limiteClienteReducido = globalState.limiteCliente * (1 - nuevaReduccion);
            const nuevoLimitePermitido = Math.min(limiteArticulo, limiteClienteReducido, globalState.limiteUsuario);

            // 3. Evaluar y corregir si el descuento solicitado excede el nuevo límite real
            if (descSolicitado > nuevoLimitePermitido) {
                rec.selectLine({ sublistId: 'item', line: i });

                rec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_mergn_desc_solicitado',
                    value: nuevoLimitePermitido,
                    ignoreFieldChange: false // false para que dispare el fieldChanged y recalcule price/rate
                });

                console.log(`[CM_DEBUG] Antes de commitLine - Línea: ${i} | Descuento ajustado de ${descSolicitado} a límite máximo: ${nuevoLimitePermitido}`);
                rec.commitLine({ sublistId: 'item' });
                console.log(`[CM_DEBUG] Después de commitLine - Línea: ${i}`);
            }
        }
        globalState.isRecalculating = false;
    };

    /**
     * Aplica reglas de negocio e inyecta precios base y rate al modificar descriptores de margen a nivel línea.
     */
    const evaluateLineRules = (rec, fieldId) => {
        const triggers = ['custcol_mergn_desc_solicitado', 'quantity', 'item', 'price', 'rate'];
        if (!triggers.includes(fieldId)) return;

        const itemType = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemtype' });
        const descSolicitado = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_mergn_desc_solicitado' })) || 0;

        if (itemType === 'Group' || itemType === 'Kit' || itemType === 'EndGroup' || descSolicitado === 0) {
            return;
        }
        
        let descuento = descSolicitado / 100;
        let itemLimit = globalState.limiteCliente / 100;
        let userLimit = globalState.limiteUsuario / 100;
        let serviceReduction = globalState.reduccionServicioActual / 100;
        
        const params = {
            precioBase: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' })) || 0,
            margenEstandar: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_estandar' })) || 0,
            descMargenSolicitado: descuento,
            descMargenServicio: serviceReduction,
            limiteArticulo: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_maxdiscount_margin_percent' })) / 100 || 0,
            limiteCliente: itemLimit,
            limiteUsuario: userLimit
        };

        console.log('[CM_DEBUG] Evaluando reglas de línea. Parámetros:', JSON.stringify(params));
        const result = core.validateMarginRule(params);

        if (result.isValid) {
            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1, ignoreFieldChange: true });
            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: result.finalPrice, ignoreFieldChange: true });
            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_aplicado', value: result.appliedMargin, ignoreFieldChange: true });
        }
    };

    return {
        pageInit,
        fieldChanged,
        validateLine
    };
});