/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Módulo centralizado para el cálculo matemático y validación jerárquica de márgenes comerciales.
 */

define(['N/error', 'N/log'], (error, log) => {

    /**
     * @typedef {Object} MarginParams
     * @property {number} precioBase - Precio unitario base de la línea.
     * @property {number} margenEstandar - Margen estándar en porcentaje decimal (ej. 0.20 para 20%).
     * @property {number} descMargenSolicitado - Descuento solicitado por el usuario.
     * @property {number} descMargenServicio - Descuento otorgado por nivel de servicio.
     * @property {number} margenMinimoItem - Umbral mínimo de margen para el artículo.
     * @property {number} limiteCliente - Límite de descuento admitido para el cliente en la cabecera.
     * @property {number} limiteUsuario - Límite de descuento admitido por el rol/usuario.
     */

    /**
     * Procesa la lógica matemática de márgenes y evalúa las restricciones de negocio.
     * @param {MarginParams} params - Objeto contenedor de las variables necesarias para el cálculo.
     * @returns {{isValid: boolean, errorMessage: string, appliedMargin: number, finalPrice: number}}
     */
    const validateMarginRule = (params) => {
        // Desestructuración de parámetros con fallback a 0 para prevenir propagación de NaN
        const precioBase = parseFloat(params.precioBase) || 0;
        const margenEstandar = parseFloat(params.margenEstandar) || 0;
        const descMargenSolicitado = parseFloat(params.descMargenSolicitado) || 0;
        const descMargenServicio = parseFloat(params.descMargenServicio) || 0;
        const margenMinimoItem = parseFloat(params.margenMinimoItem) || 0;
        const limiteCliente = parseFloat(params.limiteCliente) || 0;
        const limiteUsuario = parseFloat(params.limiteUsuario) || 0;

        // Paso A: Costo Implícito
        const costo = precioBase * (1 - margenEstandar);

        // Paso B: Margen Aplicado
        const margenAplicado = margenEstandar - (margenEstandar * (descMargenSolicitado - descMargenServicio));

        // Guarda de seguridad: Prevenir división por cero en el paso C
        if (margenAplicado >= 1) {
            throw error.create({
                name: 'MATH_DIV_BY_ZERO_PREVENTION',
                message: `Cálculo abortado. El margen aplicado resultó en ${margenAplicado}, lo que causaría una división por cero.`,
                notifyOff: true
            });
        }

        // Paso C: Precio Final con redondeo financiero estándar a 2 decimales
        let precioFinal = costo * (1 / (1 - margenAplicado));
        precioFinal = Math.round((precioFinal + Number.EPSILON) * 100) / 100;

        // Validación Jerárquica de reglas de negocio
        let isValid = true;
        let errorMessage = '';

        if (margenAplicado < margenMinimoItem) {
            isValid = false;
            errorMessage = 'Nivel 1: El margen aplicado es menor al mínimo permitido.';
        } else if (descMargenSolicitado > limiteCliente) {
            isValid = false;
            errorMessage = 'Nivel 2: El descuento supera el límite del cliente.';
        } else if (descMargenSolicitado > limiteUsuario) {
            isValid = false;
            errorMessage = 'Nivel 3: El descuento supera tu límite de usuario.';
        }

        // Auditoría de bloqueos (Requisito Adicional)
        if (!isValid) {
            log.audit({
                title: 'Bloqueo en Sistema de Márgenes',
                details: `Validación fallida. Razón: ${errorMessage} | Margen Calculado: ${margenAplicado.toFixed(4)} | Descuento Solicitado: ${descMargenSolicitado.toFixed(4)}`
            });
        }

        return {
            isValid,
            errorMessage,
            appliedMargin: margenAplicado,
            finalPrice: precioFinal
        };
    };

    return { validateMarginRule };
});