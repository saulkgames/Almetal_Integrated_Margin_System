/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/https', 'N/encode'], (https, encode) => {

    /**
     * Genera el header de autenticación Basic en base64.
     */
    const createAuthHeader = (username, password) => {
        const base64Credentials = encode.convert({
            string: `${username}:${password}`,
            inputEncoding: encode.Encoding.UTF_8,
            outputEncoding: encode.Encoding.BASE_64
        });
        return `Basic ${base64Credentials}`;
    };

    /**
     * @param {string} secretId - ID del Secret Manager
     * @param {string[]} requestedKeys - ['img', 'upl', 'mrg','sch']
    */
    const getNasConfig = (requestedKeys) => {
        // Credenciales Hardcoded (Temporal para pruebas)
        const USER = 'RESTlet';
        const PASS = 'ma;1<xP3';
        const BASE_URL = 'https://naspfpjx0.myds.me:3443';

        const masterMap = {
            'img': `${BASE_URL}/api/files/image`,
            'upl': `${BASE_URL}/api/files/upload`,
            'mrg': `${BASE_URL}/api/files/merge`,
            'sch': `${BASE_URL}/api/files/search`
        };

        const endPts = {};
        if (requestedKeys && Array.isArray(requestedKeys)) {
            requestedKeys.forEach(key => {
                if (masterMap[key]) {
                    endPts[key] = masterMap[key];
                }
            });
        }

        return {
            auth: createAuthHeader(USER, PASS),
            endPts: endPts
        };
    };

    /**
     * Expresión regular para validar el formato estándar de un UUID (8-4-4-4-12).
     * Cumple con el estándar de Timbre Fiscal Digital (TFD) del SAT.
     * * @example 
     * 550E8400-E29B-41D4-A716-446655440000 -> true
     * 550E8400-E29B-41D4-A716-446655440000.xml -> false
     * @constant {RegExp}
     */
    const UUID_SAT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    /**
     * Valida si un string contiene un UUID con formato 8-4-4-4-12.
     * @param {string} rawString - El texto a evaluar.
     * @returns {boolean} - True si el formato es válido en alguna parte del texto.
     */
    const isValidUuid = (rawString) => {
        if (!rawString || typeof rawString !== 'string') return null;

        return UUID_SAT_PATTERN.test(rawString);
    };
    /**
     * Esta funcion sera la intermediaria entre netsuite y Synology.
     * Sera la encargada de enviar y resivir los objetos de request y response.
     * @param {Object} ogBillsObject - Este objeto sera el encargado de transportar un arreglo de pdfs 
     *  y mas parametros para enviarlos al endpoint /upload.
     * @returns {Object} - Retorna la respuesta del servidor de vuelta al script.
     */
    const uploadOGBills = (ogBillsObject) => {

    };

    /**
     * Sube imágenes al servidor NAS utilizando la configuración centralizada.
     * @param {Object} options
     * @param {Array<Object>} options.images - Array de objetos, ej: [{ base64img: '...', fileNameIMG: '...' }]
     * @returns {Object} - La respuesta JSON del servidor.
     */
    const uploadImages = (options) => {
        if (!options || !options.images || !options.images.length) {
            return {}; // Retorno temprano si no hay imágenes que procesar
        }

        // Obtener configuración centralizada para el endpoint de imágenes ('img')
        const nasConfig = getNasConfig(['img']);
        const endpoint = nasConfig.endPts.img;

        if (!endpoint) {
            throw error.create({
                name: 'NAS_CONFIG_ERROR',
                message: 'No se pudo resolver el endpoint para la carga de imágenes.'
            });
        }

        try {
            const response = https.post({
                url: endpoint,
                headers: {
                    'Authorization': nasConfig.auth,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(options.images)
            });

            if (response.code !== 200) {
                log.error({
                    title: 'Error en NAS API',
                    details: `Code: ${response.code} | Body: ${response.body}`
                });
                throw error.create({
                    name: 'NAS_UPLOAD_FAILED',
                    message: `Error al subir imágenes al NAS (${response.code}). Revisa los logs para más detalles.`
                });
            }

            return JSON.parse(response.body || '{}');

        } catch (e) {
            log.error({ title: 'Excepción Crítica en uploadImages', details: e });
            throw e;
        }
    };

    return {
        getNasConfig: getNasConfig,
        isValidUuid: isValidUuid,
        uploadOGBills: uploadOGBills,
        uploadImages: uploadImages
    };

});