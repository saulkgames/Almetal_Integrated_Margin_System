/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Módulo centralizado para el cálculo matemático y validación jerárquica de márgenes comerciales.
 */

define(['N/error', 'N/log'], (error, log) => {

    /**
     * @typedef {Object} MarginParams
     * @property {number} precioBase - Precio unitario base de la línea.
     * @property {number} costo - Costo del artículo, utilizado para cálculos internos.
     * @property {number} margenEstandar - Margen estándar en porcentaje decimal (ej. 0.20 para 20%).
     * @property {number} descMargenSolicitado - Descuento solicitado por el usuario.
     * @property {number} descMargenServicio - Descuento otorgado por nivel de servicio.
     * @property {number} limiteArticulo - Capacidad máxima de descuento del artículo.
     * @property {number} limiteCliente - Límite de descuento admitido para el cliente en la cabecera.
     * @property {number} limiteUsuario - Límite de descuento admitido por el rol/usuario.
     */

    /**
     * Procesa la lógica matemática de márgenes y evalúa las restricciones de negocio.
     * @param {MarginParams} params - Objeto contenedor de las variables necesarias para el cálculo.
     * @returns {{isValid: boolean, errorMessage: string, appliedMargin: number, finalPrice: number}}
     */
    const validateMarginRule = (params) => {
        const precioBase = parseFloat(params.precioBase) || 0;
        const costo = parseFloat(params.costo) || 0;
        const margenEstandar = parseFloat(params.margenEstandar) || 0;
        const descMargenSolicitado = parseFloat(params.descMargenSolicitado) || 0;
        const descMargenServicio = parseFloat(params.descMargenServicio) || 0;
        const limiteArticulo = parseFloat(params.limiteArticulo) || 0;
        const limiteCliente = parseFloat(params.limiteCliente) || 0;
        const limiteUsuario = parseFloat(params.limiteUsuario) || 0;

        let isValid = true;
        let errorMessage = '';
        
        const limiteClienteReducido = limiteCliente * (1 - descMargenServicio);

        if (descMargenSolicitado > limiteArticulo) {
            isValid = false;
            errorMessage = `Nivel 1: El descuento (${(descMargenSolicitado * 100).toFixed(2)}%) supera la capacidad máxima de este artículo.`;
        } else if (descMargenSolicitado > limiteClienteReducido) {
            isValid = false;
            errorMessage = `Nivel 2: El descuento supera el límite del cliente permitido por las condiciones de envío (${(limiteClienteReducido * 100).toFixed(2)}%).`;
        } else if (descMargenSolicitado > limiteUsuario) {
            isValid = false;
            errorMessage = `Nivel 3: El descuento (${(descMargenSolicitado * 100).toFixed(2)}%) supera tu límite de usuario.`;
        }

        if (!isValid) {
            log.audit({
                title: 'Bloqueo en Sistema de Márgenes',
                details: `Validación fallida. Razón: ${errorMessage} | Margen Calculado: ${margenAplicado.toFixed(4)} | Descuento Solicitado: ${descMargenSolicitado.toFixed(4)}`
            });
        }

        const margenAplicado = margenEstandar - (margenEstandar * descMargenSolicitado);

        if (margenAplicado <= 0) {
            throw error.create({
                name: 'MATH_DIV_BY_ZERO_PREVENTION',
                message: `Cálculo abortado. El margen aplicado resultó en ${margenAplicado}, lo que causaría una división por cero.`,
                notifyOff: true
            });
        }

        let precioFinal = costo * (100 / (100 - margenAplicado));
        precioFinal = Math.round((precioFinal + Number.EPSILON) * 100) / 100;

        

        return {
            isValid,
            errorMessage,
            appliedMargin: margenAplicado,
            finalPrice: precioFinal
        };
    };

    return { validateMarginRule };
});