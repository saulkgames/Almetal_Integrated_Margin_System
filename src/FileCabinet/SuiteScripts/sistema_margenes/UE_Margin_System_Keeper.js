/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @description Guardián del Servidor: Inyección de Límite de Usuario y Validación de Reglas de Margen.
 * @appliedtorecord - SalesOrder, CashSale, Invoice, Estimate.
 * @author Saul Ivan Angulo Varela
 * @contact saul.angulo98@gmail.com
 * @version 1.0.0
 * @copyright Saul Angulo Development Services
 * @description - Este script implementa una lógica de validación en cascada para asegurar que los descuentos aplicados en las transacciones de ventas no excedan ni la autoridad del usuario ni la capacidad del artículo, 
 * considerando también penalizaciones por nivel de servicio. La inyección del límite del usuario se realiza al cargar la pantalla para optimizar la experiencia y evitar búsquedas repetitivas.
 * @RiotID - ares98
 */

define(['N/search', 'N/runtime', 'N/error'], (search, runtime, error) => {

    /**
     * Trigger 1: Inyección del límite del usuario al cargar la pantalla.
     */
    const beforeLoad = (context) => {
        // Solo ejecutamos en creación para inicializar el dato
        if (context.type !== context.UserEventType.CREATE) return;

        try {
            const user = runtime.getCurrentUser();
            const newRecord = context.newRecord;

            const employeeData = search.lookupFields({
                type: search.Type.EMPLOYEE,
                id: user.id,
                columns: ['custentity_user_margin_limit']
            });

            const limiteUsuario = parseFloat(employeeData.custentity_user_margin_limit) || 0;

            newRecord.setValue({
                fieldId: 'custbody_curr_user_discount_limit',
                value: limiteUsuario
            });

        } catch (e) {
            log.error({ title: 'Error en beforeLoad - Límite Usuario', details: e.message });
            // No bloqueamos la carga, solo registramos el error
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
            const reduccionServicio = parseFloat(newRecord.getValue({ fieldId: 'custbody_customer_level_service_rec' })) || 0; 
            
            // NUEVO: Extraer el límite del Cliente de forma eficiente (1 Unidad de Gobernanza)
            let limiteCliente = 0;
            const customerId = newRecord.getValue({ fieldId: 'entity' });
            
            if (customerId) {
                const customerData = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['custentity_maxdiscount_margin_percent', ] 
                });
                limiteCliente = parseFloat(customerData.custentity_maxdiscount_margin_percent) || 0;
            }
            
            const lineCount = newRecord.getLineCount({ sublistId: 'item' });

            // 2. Iterar sobre las líneas para validar la matriz matemática
            for (let i = 0; i < lineCount; i++) {
                const itemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                
                // Exclusión de artículos que no aplican
                if (itemType === 'Group' || itemType === 'Kit' || itemType === 'EndGroup') continue;

                const descSolicitado = parseFloat(newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_mergn_desc_solicitado', 
                    line: i
                })) || 0;

                if (descSolicitado === 0) continue;

                // Límite máximo del artículo
                const limiteArticulo = parseFloat(newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_maxdiscount_margin_percent',
                    line: i
                })) || 0;

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