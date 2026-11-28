/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @description Server guardian for user discount limit injection and margin rule validation across sale transactions.
 * @author Saul Ivan Angulo Varela
 * @contact saul.angulo98@gmail.com
 * @version 1.1.0
 * @copyright Saul Angulo Development Services
 * @description - Este script implementa una lógica de validación en cascada para asegurar que los descuentos aplicados en las transacciones de ventas no excedan ni la autoridad del usuario ni la capacidad del artículo, 
 * considerando también penalizaciones por nivel de servicio. La inyección del límite del usuario se realiza al cargar la pantalla para optimizar la experiencia y evitar búsquedas repetitivas.
 * @RiotID - ares98
 */

define(['N/search', 'N/runtime', 'N/error', 'N/record', './CM_Margin_System_Core'], (search, runtime, error, record, core) => {

    /**
     * Hides native conversion buttons exclusively on the Estimate record.
     * This logic is NOT replicated on salesorder, invoice, or cashsale.
     */
    const hideEstimateOnlyButtons = (context) => {
        const { newRecord, form } = context;

        if (newRecord.type !== 'estimate') return;

        try {
            const terminos = newRecord.getValue({ fieldId: 'custbody_freigth_service_terms' });

            // 2 = SIN ENVIO
            if (terminos === '2') {
                log.debug('[CM_DEBUG] Condición de envío: SIN ENVÍO. Bloqueando Orden de Venta.');
                form.removeButton({ id: 'createsalesord' });
            }
            // 1 = HOY, 3 = 3 DIAS
            else if (terminos === '1' || terminos === '3') {
                log.debug('[CM_DEBUG] Condición de envío: CON ENVÍO. Permitiendo creación de transacciones.');
                form.removeButton({ id: 'createcashsale' });
                form.removeButton({ id: 'createinvoice' });
            }
        } catch (e) {
            log.error({ title: 'Error en hideEstimateOnlyButtons', details: e.message });
        }
    };

    /**
     * Carries margin/surcharge state from the source transaction into the target
     * transaction during native transforms (estimate → salesorder, estimate → invoice,
     * estimate → cashsale, salesorder → invoice, salesorder → cashsale).
     * Runs in beforeLoad CREATE so the Client Script sees the correct seeded values.
     */
    const carryOverMarginState = (newRecord) => {
        const createdFrom = newRecord.getValue({ fieldId: 'createdfrom' });
        if (!createdFrom) return;

        try {
            const sourceTypeData = search.lookupFields({
                type: 'transaction',
                id: createdFrom,
                columns: ['recordtype']
            });
            const sourceType = sourceTypeData.recordtype;

            if (!sourceType || !['estimate', 'salesorder'].includes(sourceType)) return;

            const sourceRecord = record.load({
                type: sourceType,
                id: createdFrom
            });

            // Header fields carried from source
            const headerFields = [
                'custbody_cust_serv_lvl',
                'custbody_curr_cust_discount_limit',
                'custbody_customer_level_service_rec',
                'custbody_freigth_service_terms'
            ];

            headerFields.forEach((fieldId) => {
                try {
                    const value = sourceRecord.getValue({ fieldId });
                    if (value !== null && value !== undefined && value !== '') {
                        newRecord.setValue({ fieldId, value, ignoreFieldChange: true });
                    }
                } catch (e) {
                    log.error({ title: `Error carry-over header ${fieldId}`, details: e.message });
                }
            });

            // Line fields carried from source. Matching uses line index because
            // NetSuite native transform preserves line order.
            const lineFields = [
                'custcol_precio_sin_margen',
                'custcol_mergn_desc_solicitado',
                'custcol_margen_aplicado',
                'custcol_sang_monto_sobrecargo_apli',
                'custcol_drt_sobre_cargo'
            ];

            const sourceLineCount = sourceRecord.getLineCount({ sublistId: 'item' });
            const targetLineCount = newRecord.getLineCount({ sublistId: 'item' });
            const linesToProcess = Math.min(sourceLineCount, targetLineCount);

            for (let i = 0; i < linesToProcess; i++) {
                lineFields.forEach((fieldId) => {
                    try {
                        const value = sourceRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId,
                            line: i
                        });
                        if (value !== null && value !== undefined && value !== '') {
                            newRecord.setSublistValue({
                                sublistId: 'item',
                                fieldId,
                                line: i,
                                value,
                                ignoreFieldChange: true
                            });
                        }
                    } catch (e) {
                        log.error({ title: `Error carry-over line ${fieldId}:${i}`, details: e.message });
                    }
                });
            }
        } catch (e) {
            log.error({ title: 'Error en carryOverMarginState', details: e.message });
        }
    };

    /**
     * Trigger 1: User limit and surcharge config injection, plus state carry-over
     * from source transaction on native transforms.
     */
    const beforeLoad = (context) => {
        const newRecord = context.newRecord;

        // Only run on create or edit to initialize data
        if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.EDIT) {
            try {
                const user = runtime.getCurrentUser();

                const employeeData = search.lookupFields({
                    type: search.Type.EMPLOYEE,
                    id: user.id,
                    columns: ['custentity_user_margin_limit']
                });

                const limiteUsuario = parseFloat(employeeData.custentity_user_margin_limit) || 0;
                log.debug('Limite de usuario: ', limiteUsuario);
                newRecord.setValue({
                    fieldId: 'custbody_curr_user_discount_limit',
                    value: limiteUsuario
                });

                const configRecord = search.lookupFields({
                    type: 'customrecord_sang_conf_sobrecargos',
                    id: 1,
                    columns: ['custrecord_sang_sc_rango1', 'custrecord_sang_sc_rango2', 'custrecord_sang_sc_rango3', 'custrecord_sang_sc_rango4']
                });

                // Convert native text percentages to decimal and pack as JSON
                const surchargeConfigJSON = {
                    rango1: (parseFloat(configRecord.custrecord_sang_sc_rango1) || 0) / 100,
                    rango2: (parseFloat(configRecord.custrecord_sang_sc_rango2) || 0) / 100,
                    rango3: (parseFloat(configRecord.custrecord_sang_sc_rango3) || 0) / 100,
                    rango4: (parseFloat(configRecord.custrecord_sang_sc_rango4) || 0) / 100
                };

                newRecord.setValue({
                    fieldId: 'custbody_sang_hidden_surcharge_config',
                    value: JSON.stringify(surchargeConfigJSON)
                });

            } catch (e) {
                log.error({ title: 'Error en beforeLoad - Inyecciones', details: e.message });
                // Do not block load; just log the error
            }

            // Carry margin state from source transaction on native transform
            carryOverMarginState(newRecord);
        }

        if (context.type === context.UserEventType.VIEW) {
            hideEstimateOnlyButtons(context);
        }
    };

    /**
     * Guardián Final: Validación en cascada antes de guardar en Base de Datos.
     */
    const beforeSubmit = (context) => {
        // Solo validamos cuando se crea o se edita la transacción
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) return;

        const newRecord = context.newRecord;

        try {
            // 1. Obtener variables de cabecera en memoria (Ajustar ID de campos)
            const limiteUsuario = parseFloat(newRecord.getValue({ fieldId: 'custbody_curr_user_discount_limit' })) || 0;
            let reduccionServicio = parseFloat(newRecord.getValue({ fieldId: 'custbody_cust_serv_lvl' })) || 0;

            // Normalización de seguridad: Si viene como entero (ej. 20 para 20%), lo pasamos a decimal (0.20)
            // Si ya viene como decimal (0.20), lo dejamos intacto.
            if (reduccionServicio > 1) {
                reduccionServicio = reduccionServicio / 100;
            }

            let limiteCliente = 0;
            const customerId = newRecord.getValue({ fieldId: 'entity' });

            let esSubsidiaria = false;
            if (customerId) {
                const customerData = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['custentity_maxdiscount_margin_percent', 'custentity_alm_check_intercompania']
                });
                limiteCliente = parseFloat(customerData.custentity_maxdiscount_margin_percent) || 0;
                esSubsidiaria = core.isSubsidiaryCustomer(customerData);
            }

            // Las subsidiarias usan el price level "SUBSIDIARIAS" ya calculado;
            // no se valida jerarquía de descuentos ni se aplica sobrecargo.
            if (esSubsidiaria) {
                log.debug('[CM_DEBUG] Cliente subsidiaria detectado. Se omite validación de márgenes.');
                return;
            }

            const lineCount = newRecord.getLineCount({ sublistId: 'item' });

            // 2. Iterar sobre las líneas para validar la matriz matemática
            for (let i = 0; i < lineCount; i++) {
                const itemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });

                if (itemType === 'Group' || itemType === 'Kit' || itemType === 'EndGroup') continue;

                const descSolicitado = (parseFloat(newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_mergn_desc_solicitado',
                    line: i
                })) || 0) / 100;

                if (descSolicitado === 0) continue;

                // Límite máximo del artículo
                const limiteArticulo = (parseFloat(newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_maxdiscount_margin_percent',
                    line: i
                })) || 0) / 100;

                // --- MATEMÁTICA Y VALIDACIÓN EN CASCADA ---

                if (descSolicitado > limiteArticulo) {
                    throw error.create({
                        name: 'ERR_CAPACIDAD_ARTICULO_EXCEDIDA',
                        message: `Línea ${i + 1}: El descuento (${(descSolicitado * 100).toFixed(2)}%) supera la capacidad máxima de este artículo.`,
                    });
                }

                // Regla B: Validamos contra el Límite del Cliente
                const limiteClienteReducido = limiteCliente * (1 - reduccionServicio);
                if (descSolicitado > limiteClienteReducido) {
                    throw error.create({
                        name: 'ERR_LIMITE_CLIENTE_EXCEDIDO',
                        message: `Línea ${i + 1}: El descuento supera el límite del cliente permitido por las condiciones de envío (${(limiteClienteReducido * 100).toFixed(2)}%).`,
                    });
                }

                // Regla C: Validamos contra la Autoridad Personal del Vendedor (Usuario)
                if (descSolicitado > limiteUsuario) {
                    throw error.create({
                        name: 'ERR_LIMITE_USUARIO_EXCEDIDO',
                        message: `Línea ${i + 1}: El descuento (${(descSolicitado * 100).toFixed(2)}%) excede tu límite de autorización personal (${(limiteUsuario * 100).toFixed(2)}%).`,
                    });
                }
            }

        } catch (e) {
            // Re-lanzamos nuestros errores de validación de negocio para bloquear el guardado
            if (e.name === 'ERR_CAPACIDAD_ARTICULO_EXCEDIDA' || e.name === 'ERR_LIMITE_CLIENTE_EXCEDIDO' || e.name === 'ERR_LIMITE_USUARIO_EXCEDIDO') {
                throw e;
            }

            log.error({ title: 'Error crítico en validación beforeSubmit', details: e });
            throw error.create({
                name: 'ERR_SISTEMA_MARGENES',
                message: 'Ocurrió un error al validar los márgenes de la transacción. Detalles: ' + e.message,
                notifyOff: true
            });
        }
    };

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit
    };
});