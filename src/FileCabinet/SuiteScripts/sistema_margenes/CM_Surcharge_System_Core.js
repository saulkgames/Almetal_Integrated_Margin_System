/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Módulo centralizado para el cálculo de sobrecargos físicos por corte con regla de mínimo unitario.
 */
define([], () => {
    
    /**
     * Calcula el monto financiero del sobrecargo en base a las reglas físicas y comerciales.
     * @param {Object} params 
     * @returns {number} Monto exacto del sobrecargo unitario.
     */
    const calculateSurcharge = (params) => {
        const { precioBase, quantity, largoArticulo, solicitarCorte, aplicaSobreCargo, configSurcharge } = params;

        // Validaciones de seguridad de datos de línea
        if (!aplicaSobreCargo || !solicitarCorte || !largoArticulo || largoArticulo <= 0 || !quantity || quantity <= 0) {
            return 0;
        }

        const porcentajeUso = quantity / largoArticulo;
        let factorSobrecargo = 0;

        // Evaluación de rangos dinámicos
        if (porcentajeUso > 0 && porcentajeUso < 0.20) {
            factorSobrecargo = configSurcharge.rango1 || 0.20;
        } else if (porcentajeUso >= 0.20 && porcentajeUso < 0.40) {
            factorSobrecargo = configSurcharge.rango2 || 0.15;
        } else if (porcentajeUso >= 0.40 && porcentajeUso < 0.60) {
            factorSobrecargo = configSurcharge.rango3 || 0.10;
        } else if (porcentajeUso >= 0.60) {
            factorSobrecargo = configSurcharge.rango4 || 0.05;
        }

        // 1. Cálculo matemático inicial del sobrecargo por unidad
        let montoCargoExtra = (parseFloat(precioBase) * factorSobrecargo) || 0;

        // 2. NUEVA LÓGICA CONDICIONAL: Asegurar un cargo mínimo de 15 pesos por unidad
        if (montoCargoExtra > 0 && montoCargoExtra < 15) {
            montoCargoExtra = 15;
        }

        return montoCargoExtra;
    };

    return { calculateSurcharge };
});