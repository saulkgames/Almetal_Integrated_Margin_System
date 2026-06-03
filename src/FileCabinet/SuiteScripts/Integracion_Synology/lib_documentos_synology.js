/**
 * @NApiVersion 2.x
 * @ModuleScope SameAccount
 */
define(['N/https', 'N/encode', 'N/render', 'N/file', 'N/log'],
    function (https, encode, render, file, log) {

        /**
         * Crea el header de autenticación Basic. (Función privada del módulo)
         */
        function createAuthHeader(username, password) {
            if (!username || !password) {
                throw new Error('Credenciales no proporcionadas.');
            }
            var base64Credentials = encode.convert({
                string: username + ':' + password,
                inputEncoding: encode.Encoding.UTF_8,
                outputEncoding: encode.Encoding.BASE_64
            });
            return 'Basic ' + base64Credentials;
        }
        /**
          *  Inicializa la configuración de integración.
          * @param {string} secretId - ID del Secret Manager (ej. 'custsecret_syn_auth')
          * @param {string[]} requestedKeys - Lista de endpoints: ['img', 'upl', 'mrg']
          */
        function getNasConfig(secretId, requestedKeys) {
            var BASE_URL = 'https://naspfpjx0.myds.me:3443';
            var masterMap = {
                'img': BASE_URL + '/api/files/image',
                'upl': BASE_URL + '/api/files/upload',
                'mrg': BASE_URL + '/api/files/merge'
            };

            var endPts = {};
            if (requestedKeys && requestedKeys.length > 0) {
                for (var i = 0; i < requestedKeys.length; i++) {
                    var key = requestedKeys[i];
                    if (masterMap.hasOwnProperty(key)) {
                        endPts[key] = masterMap[key];
                    }
                }
            }

            return {
                secretId: secretId ,
                endPts: endPts
            };
        }

        /**
         * Renderiza un PDF de una transacción usando una plantilla FTL.
         * @param {Object} options
         * @param {number} options.recordId - El ID interno del registro a renderizar.
         * @param {string} options.templateId - El ID del script de la plantilla FTL a usar.
         * @returns {File} - El objeto de archivo (File) de SuiteScript.
         */
        function renderTransactionPDF(options) {
            if (!options.recordId || !options.templateId) {
                throw new Error('Se requiere "recordId" y "templateId" para renderizar el PDF.');
            }
            var renderer = render.create();
            renderer.setTemplateByScriptId({ scriptId: options.templateId });
            renderer.addRecord({
                templateName: 'record',
                record: options.record
            });
            return renderer.renderAsPdf();
        }
        /**
        * Renderiza el PDF de la transacción usando la plantilla configurada en el formulario.
        * @param {Object} options - Debe contener 'recordId' (que es el ID interno de la transacción)
        * @param {number} options.recordId - Debe ser un numero, usa parseInt o Number()
        */
        function renderTransaction(options) {
            if (!options.recordId) {
                throw new Error('Se requiere "recordId" (ID interno de la transacción) para renderizar el PDF.');
            }

            var pdfFile = render.transaction({
                entityId: parseInt(options.recordId),
                printMode: render.PrintMode.PDF,
                inCustLocale: true
            });

            return pdfFile;
        }

        /**
         * Sube un único archivo (generalmente PDF) al endpoint /upload.
         * @param {Object} options
         * @returns {Object} - La respuesta JSON del servidor.
         */
        function uploadFile(options) {
            var authHeader = createAuthHeader(options.user, options.password);
            var response = https.post({
                url: options.uploadUrl,
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: options.fileObject.name,
                    base64pdf: options.fileObject.getContents()
                })
            });

            if (response.code !== 200) {
                log.error('Error en uploadFile', 'Code: ' + response.code + ' | Body: ' + response.body);
                throw new Error('Error desde el servidor (' + response.code + '): ' + response.body);
            }
            return JSON.parse(response.body || '{}');
        }

        /**
         * @param {Object} options
         * @param {Array<Object>} options.images - Array de objetos, ej: [{ base64img: '...', fileNameIMG: '...' }]
         * @param {string} options.imageUrl - La URL del endpoint de imágenes.
         * @param {string} options.user - El usuario para la autenticación.
         * @param {string} options.password - La contraseña para la autenticación.
         * @returns {Object} - La respuesta JSON del servidor.
         */
        function uploadImages(options) {
            var authHeader = createAuthHeader(options.user, options.password);
            var response = https.post({
                url: options.imageUrl,
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify(options.images)
            });

            if (response.code !== 200) {
                log.error('Error en uploadImages', 'Code: ' + response.code + ' | Body: ' + response.body);
                throw new Error('Error subiendo imágenes (' + response.code + '): ' + response.body);
            }
            return JSON.parse(response.body || '{}');
        }

        return {
            renderTransactionPDF: renderTransactionPDF,
            uploadFile: uploadFile,
            uploadImages: uploadImages,
            renderTransaction: renderTransaction,
            getNasConfig: getNasConfig
        };
    });