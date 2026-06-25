/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 * @description Controlador de interfaz de usuario para inyección de precios, estado global y validación de reglas en líneas.
 * @appliedtorecord - Estimate.
 * @author Saul Ivan Angulo Varela
 * @contact saul.angulo98@gmail.com
 * @version 1.0.0
 * @copyright Saul Angulo Development Services
 * @RiotID - ares98
 */

define(['N/ui/dialog', 'N/search', './CM_Margin_System_Core', './CM_Surcharge_System_Core'],
    (dialog, search, core, surchargeCore) => {

        // Estado global para cachear límites y controlar el flujo de la UI
        const globalState = {
            limiteCliente: 0,
            limiteUsuario: 0,
            reduccionServicioActual: 0,
            nivelesEnvio: { noEnvio: 0, envioHoy: 0, envioDias: 0 },
            isRecalculating: false,
            terminoEntregaAnterior: null,
            configSobrecargos: {}
        };

        /**
         * GATILLO 1: Inicialización de la página. Se lee el estado base inyectado por User Event.
         */
        const pageInit = (context) => {
            const rec = context.currentRecord;

            globalState.limiteUsuario = parseFloat(rec.getValue({ fieldId: 'custbody_curr_user_discount_limit' })) || 0;
            globalState.terminoEntregaAnterior = rec.getValue({ fieldId: 'custbody_freigth_service_terms' });
            globalState.limiteCliente = parseFloat(rec.getValue({ fieldId: 'custbody_curr_cust_discount_limit' })) || 0;
            globalState.reduccionServicioActual = parseFloat(rec.getValue({ fieldId: 'custbody_cust_serv_lvl' })) || 0;

            const customerId = rec.getValue({ fieldId: 'entity' });
            if (customerId) {
                handleCustomerChange(rec);
            }
            
            const injectedConfig = rec.getValue({ fieldId: 'custbody_sang_hidden_surcharge_config' });
            if (injectedConfig) {
                try {
                    globalState.configSobrecargos = JSON.parse(injectedConfig);
                } catch (e) {
                    console.error('[CM_ERROR] No se pudo parsear la config de sobrecargos', e);
                }
            }

            console.log('[CM_DEBUG] pageInit completado. Estado inicial:', JSON.stringify(globalState));
        };

        /**
         * GATILLO 2: Manejador central de cambios en cabecera y líneas.
         * EXCLUSIVO para interacciones manuales que NO requieren ir al servidor por datos maestros.
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

            if (sublistId === 'item') {
                // NUEVO: Agregamos quantity y sobre_cargo a los disparadores
                const validTriggers = ['custcol_mergn_desc_solicitado', 'price', 'quantity', 'custcol_drt_sobre_cargo'];
                if (validTriggers.includes(fieldId)) {
                    evaluateLineRules(rec, fieldId);
                }
            }
        };

        /**
         * GATILLO 3: Ejecutado DESPUÉS de que NetSuite trae datos del servidor (Sourcing).
         * Arquitectura en Cascada: Dejamos que NetSuite termine de popular el Rate tras forzar el Nivel de Precio a 1.
         */
        const postSourcing = (context) => {
            const { currentRecord: rec, sublistId, fieldId } = context;

            if (sublistId !== 'item') return;

            // CASO A: Cambia el Artículo o la Unidad de Medida
            if (fieldId === 'item' || fieldId === 'units') {

                try {
                    const idUnidadTransaccion = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'units' });
                    const idUnidadBase = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_drt_unidad_stock' });

                    // Extraemos el texto visible y lo pasamos a minúsculas para evitar errores de tipeo (ej. "M", "Mt")
                    const textoUnidad = (rec.getCurrentSublistText({ sublistId: 'item', fieldId: 'units' }) || '').toLowerCase();
                    const unidadesValidasParaCorte = ['m', 'mt', 'mts', 'm2'];

                    // Si las unidades son diferentes Y la nueva unidad es válida para cortes -> Encendemos el check
                    //console.log(`[CM_DEBUG-TRUE] Ud_Trans: '${textoUnidad}' Se activa sobrecargo - Ud_Values: ${idUnidadTransaccion} vs ${idUnidadBase}`);

                    if (idUnidadTransaccion && idUnidadBase && (idUnidadTransaccion !== idUnidadBase) && unidadesValidasParaCorte.includes(textoUnidad)) {
                        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_drt_sobre_cargo', value: true, ignoreFieldChange: true });
                    } else {
                        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_drt_sobre_cargo', value: false, ignoreFieldChange: true });
                    }
                } catch (e) {
                    console.error('[CM_ERROR] Error en postSourcing durante evaluación de sobrecargo:', e);
                }
                try {
                    const currentPriceLvl = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'price' });

                    // Si el precio está en Custom (-1) o cualquier otro, lo forzamos a Base (1)
                    if (currentPriceLvl != 1) {
                        console.log(`[CM_DEBUG] Forzando Nivel de Precio a 1 debido a cambio en ${fieldId}...`);
                        // Esto disparará una nueva llamada al servidor y volverá a entrar a postSourcing pero con fieldId === 'price'
                        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: 1, ignoreFieldChange: false });
                        return; // Cortamos la ejecución aquí.
                    } else {
                        // Si ya estaba en 1, el rate es correcto. Procedemos a respaldar.
                        backupBasePrice(rec);
                        evaluateLineRules(rec, fieldId);
                    }
                } catch (e) {
                    console.error('[CM_ERROR] Error en postSourcing durante backup de precio:', e);
                }

            }

            // CASO B: Respondiendo al forzado de Precio a 1 (La "Luz Verde")
            else if (fieldId === 'price') {
                const currentPriceLvl = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'price' });

                // Si NetSuite ya terminó de cargar el Nivel Base (1), ahora sí el Rate es 100% confiable
                if (currentPriceLvl == 1) {
                    console.log('[CM_DEBUG] Sourcing de Precio terminado. Respaldando Rate...');
                    backupBasePrice(rec);
                    evaluateLineRules(rec, fieldId);
                }
            }
        };

        /**
         * Función Auxiliar para limpiar descuentos y guardar el precio nativo de forma segura.
         */
        const backupBasePrice = (rec) => {
            globalState.isRecalculating = true; // Bloqueamos tus reglas de validación temporales
            try {
                // Ahora este 'rate' es 100% el precio base de la nueva unidad o artículo
                const precioNativoOriginal = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' })) || 0;

                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_mergn_desc_solicitado', value: '', ignoreFieldChange: true });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_aplicado', value: '', ignoreFieldChange: true });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_precio_sin_margen', value: precioNativoOriginal, ignoreFieldChange: true });

                console.log(`[CM_DEBUG] Línea reseteada. Nuevo Precio de Respaldo: ${precioNativoOriginal}`);
            } catch (e) {
                console.error('[CM_ERROR] Falla durante el reseteo:', e);
            } finally {
                globalState.isRecalculating = false;
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
                descMargenSolicitado: descSolicitado / 100,
                descMargenServicio: globalState.reduccionServicioActual / 100,
                limiteArticulo: (parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_maxdiscount_margin_percent' })) || 0) / 100,
                limiteCliente: globalState.limiteCliente / 100,
                limiteUsuario: globalState.limiteUsuario / 100
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

        const handleCustomerChange = (rec) => {
            const customerId = rec.getValue({ fieldId: 'entity' });
            if (!customerId) {
                globalState.limiteCliente = 0;
                globalState.nivelesEnvio = { noEnvio: 0, envioHoy: 0, envioDias: 0 };
                return;
            }

            const termsField = rec.getField({ fieldId: 'custbody_freigth_service_terms' });
            if (termsField) termsField.isDisabled = true;

            search.lookupFields.promise({
                type: search.Type.CUSTOMER,
                id: customerId,
                columns: [
                    'custentity_maxdiscount_margin_percent',
                    'custentity_custrec_service_level'
                ]
            }).then((customerData) => {
                globalState.limiteCliente = parseFloat(customerData.custentity_maxdiscount_margin_percent) || 0;
                rec.setValue({ fieldId: 'custbody_curr_cust_discount_limit', value: globalState.limiteCliente });

                const serviceLevelField = customerData.custentity_custrec_service_level;
                const serviceLevelId = (serviceLevelField && serviceLevelField.length > 0)
                    ? serviceLevelField[0].value
                    : null;

                if (!serviceLevelId) {
                    globalState.nivelesEnvio = { noEnvio: 0, envioHoy: 0, envioDias: 0 };
                    console.log('[CM_DEBUG] Cliente sin Nivel de Servicio asignado. Límite de cliente:', globalState.limiteCliente);
                    if (termsField) termsField.isDisabled = false;
                    return Promise.reject('NO_SERVICE_LEVEL');
                }
                rec.setValue({ fieldId: 'custbody_customer_level_service_rec', value: serviceLevelId });

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

        const handleTermsChange = (rec) => {
            console.log('[CM_DEBUG] Cambio detectado en término de entrega. Evaluando impacto...');
            const terminoSeleccionado = rec.getValue({ fieldId: 'custbody_freigth_service_terms' });
            let nuevaReduccion = 0;

            if (terminoSeleccionado === '1') {
                nuevaReduccion = globalState.nivelesEnvio.envioHoy;
            } else if (terminoSeleccionado === '2') {
                nuevaReduccion = globalState.nivelesEnvio.noEnvio;
            } else if (terminoSeleccionado === '3') {
                nuevaReduccion = globalState.nivelesEnvio.envioDias;
            }

            const lineCount = rec.getLineCount({ sublistId: 'item' });

            if (nuevaReduccion > globalState.reduccionServicioActual && lineCount > 0) {
                console.log(`[CM_DEBUG] Entrada al bloque de recálculo. Reducción vieja: ${globalState.reduccionServicioActual} | Nueva: ${nuevaReduccion}`);

                dialog.confirm({
                    title: 'Cambio de Condiciones',
                    message: 'Este término reduce la capacidad de descuento. Los precios se recalcularán al nuevo límite permitido. ¿Desea continuar?'
                }).then((success) => {
                    if (success) {
                        processLineRecalculation(rec, nuevaReduccion, terminoSeleccionado, lineCount);
                    } else {
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
            else {
                globalState.reduccionServicioActual = nuevaReduccion;
                globalState.terminoEntregaAnterior = terminoSeleccionado;
                rec.setValue({ fieldId: 'custbody_cust_serv_lvl', value: globalState.reduccionServicioActual, ignoreFieldChange: true });
            }
        };

        const processLineRecalculation = (rec, nuevaReduccion, nuevoTermino, lineCount) => {
            globalState.isRecalculating = true;
            globalState.reduccionServicioActual = nuevaReduccion;
            globalState.terminoEntregaAnterior = nuevoTermino;

            rec.setValue({ fieldId: 'custbody_cust_serv_lvl', value: globalState.reduccionServicioActual, ignoreFieldChange: true });

            for (let i = 0; i < lineCount; i++) {
                const descSolicitado = parseFloat(rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mergn_desc_solicitado', line: i })) || 0;
                const limiteArticulo = parseFloat(rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_maxdiscount_margin_percent', line: i })) || 0;

                // 1. Calculamos el nuevo límite permitido (Matemática de reducción porcentual)
                let limiteClienteReducido = globalState.limiteCliente * (1 - (nuevaReduccion / 100));
                limiteClienteReducido = Math.max(0, parseFloat(limiteClienteReducido.toFixed(2)));

                const nuevoLimitePermitido = Math.min(limiteArticulo, limiteClienteReducido, globalState.limiteUsuario);

                // 2. Evaluamos si la línea necesita intervención
                if (descSolicitado > nuevoLimitePermitido) {
                    rec.selectLine({ sublistId: 'item', line: i });

                    // Seteamos el nuevo límite de descuento SILENCIOSAMENTE
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_mergn_desc_solicitado', value: nuevoLimitePermitido, ignoreFieldChange: true });

                    // 3. Extraemos el Precio Base de Respaldo para garantizar el cálculo correcto
                    const precioRespaldo = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_precio_sin_margen' }));
                    const precioBaseReal = (precioRespaldo && precioRespaldo > 0)
                        ? precioRespaldo
                        : (parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' })) || 0);

                    // 4. Construimos los parámetros usando el NUEVO límite permitido
                    const params = {
                        precioBase: precioBaseReal,
                        margenEstandar: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_estandar' })) || 0,
                        descMargenSolicitado: nuevoLimitePermitido / 100, // Inyectamos el límite corregido
                        descMargenServicio: nuevaReduccion / 100,
                        limiteArticulo: limiteArticulo / 100,
                        limiteCliente: globalState.limiteCliente / 100,
                        limiteUsuario: globalState.limiteUsuario / 100
                    };

                    // 5. Calculamos el nuevo Rate de forma sincrónica e inmediata
                    const result = core.validateMarginRule(params);

                    if (result.isValid) {
                        // 6. Seteamos todos los campos monetarios para asegurar congruencia total
                        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1, ignoreFieldChange: true });
                        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: result.finalPrice, ignoreFieldChange: true });
                        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_aplicado', value: result.appliedMargin, ignoreFieldChange: true });
                    } else {
                        console.warn(`[CM_WARN] El recálculo de la línea ${i} falló las reglas del core.`);
                    }

                    console.log(`[CM_DEBUG] Línea ${i} commiteada - Descuento: ${nuevoLimitePermitido} | Nuevo Rate: ${result.finalPrice}`);
                    // 7. Guardamos la línea de forma segura
                    rec.commitLine({ sublistId: 'item' });
                }
            }

            globalState.isRecalculating = false;
        };

        /**
         * Aplica reglas de negocio e inyecta precios base y rate al modificar descriptores de margen a nivel línea.
         */
        const evaluateLineRules = (rec, fieldId) => {
            const itemType = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemtype' });
            const descSolicitado = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_mergn_desc_solicitado' })) || 0;

            if (itemType === 'Group' || itemType === 'Kit' || itemType === 'EndGroup') {
                return;
            }

            // CAMBIO : Leer el precio congelado de respaldo. Si por alguna razón está en 0, cae al rate nativo.
            const precioRespaldo = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_precio_sin_margen' }));
            const precioBaseReal = (precioRespaldo && precioRespaldo > 0)
                ? precioRespaldo
                : (parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' })) || 0);

            const idUnidadTransaccion = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'units' });
            const idUnidadBase = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_drt_unidad_stock' });
            const textoUnidad = (rec.getCurrentSublistText({ sublistId: 'item', fieldId: 'units' }) || '').toLowerCase();
            const solicitarCorte = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sang_item_solicitar_corte' }) === true;
            const aplicaSobreCargo = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_drt_sobre_cargo' }) === true;

            let montoCargoFisico = 0;

            if (aplicaSobreCargo && solicitarCorte && idUnidadTransaccion && idUnidadBase && (idUnidadTransaccion !== idUnidadBase)) {

                const unidadesValidasParaCorte = ['m', 'mt', 'mts', 'm2'];

                if (unidadesValidasParaCorte.includes(textoUnidad)) {
                    // Pasa ambos filtros: Calculamos el sobrecargo
                    const paramsSobrecargo = {
                        precioBase: precioBaseReal,
                        quantity: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' })) || 0,
                        largoArticulo: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sang_hidden_item_largo' })) || 0,
                        solicitarCorte: solicitarCorte,
                        aplicaSobreCargo: aplicaSobreCargo,
                        configSurcharge: globalState.configSobrecargos
                    };
                    console.log('[CM_DEBUG] Parámetros para cálculo de sobrecargo:', paramsSobrecargo);
                    montoCargoFisico = surchargeCore.calculateSurcharge(paramsSobrecargo);
                    console.log(`[CM_DEBUG] Filtros superados. Cargo calculado: $${montoCargoFisico}`);
                } else {
                    // Falla el Filtro 2 (ej. cambió de Pieza a Kilogramo). Ahorramos memoria.
                    console.log(`[CM_DEBUG] Cambio de unidad a '${textoUnidad}', pero no aplica para cortes. Se omite el motor CM.`);
                }

            } else {
                // Falla el Filtro 1 (Unidades iguales o banderas apagadas)
                console.log(`[CM_DEBUG] Unidades base intactas o banderas apagadas. No se requiere sobrecargo.`);
            }

            if (descSolicitado === 0 && montoCargoFisico === 0) {
                const currentPriceLvl = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'price' });

                // Si la línea estaba en estado "Inflado/Custom", la regresamos a su estado nativo puro
                if (currentPriceLvl == -1) {
                    const qty = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' })) || 0;

                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: 1, ignoreFieldChange: true });
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: precioBaseReal, ignoreFieldChange: true });
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: (precioBaseReal * qty), ignoreFieldChange: true });
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_aplicado', value: '', ignoreFieldChange: true });
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sang_monto_sobrecargo_apli', value: '', ignoreFieldChange: true });
                    console.log('[CM_DEBUG] Línea restaurada al Precio Base. Sin descuento y sin cargo.');
                }
                return; // Cortamos la ejecución, ya no es necesario llamar al Motor de Márgenes
            }

            let descuento = descSolicitado / 100;
            let itemLimit = globalState.limiteCliente / 100;
            let userLimit = globalState.limiteUsuario / 100;
            let serviceReduction = globalState.reduccionServicioActual / 100;

            const params = {
                precioBase: precioBaseReal, // <-- Ahora este valor es inmutable ante cambios de descuento consecutivos
                margenEstandar: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_estandar' })) || 0,
                descMargenSolicitado: descuento,
                descMargenServicio: serviceReduction,
                limiteArticulo: parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_maxdiscount_margin_percent' })) / 100 || 0,
                limiteCliente: itemLimit,
                limiteUsuario: userLimit
            };

            console.log('[CM_DEBUG] Evaluando reglas con Precio Base de Respaldo:', precioBaseReal);
            const result = core.validateMarginRule(params);

            if (result.isValid) {
                const precioAbsolutoFinal = result.finalPrice + montoCargoFisico;
                const qty = parseFloat(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' })) || 0;

                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1, ignoreFieldChange: true });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: precioAbsolutoFinal, ignoreFieldChange: true });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: (precioAbsolutoFinal * qty), ignoreFieldChange: true });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sang_monto_sobrecargo_apli', value: montoCargoFisico, ignoreFieldChange: true });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_margen_aplicado', value: result.appliedMargin, ignoreFieldChange: true });
            } else {

                dialog.alert({
                    title: 'Restricción Comercial',
                    message: `${result.errorMessage}\n\nEl sistema restablecerá este descuento a 0% para proteger la rentabilidad de la operación.`
                }).then(() => {
                    // Seteamos el campo en vacío (0) y DEJAMOS ignoreFieldChange: false.
                    // Esto hará que el script vuelva a correr mágicamente, borrando el descuento inválido
                    // y auto-restaurando el precio base correcto (con o sin sobrecargo) sin que el usuario haga nada.
                    rec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_mergn_desc_solicitado',
                        value: '',
                        ignoreFieldChange: false
                    });
                });
            }
        };

        return {
            pageInit,
            fieldChanged,
            postSourcing,
            validateLine
        };
    });