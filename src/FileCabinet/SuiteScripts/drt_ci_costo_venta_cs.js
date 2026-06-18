/**
 *@NApiVersion 2.x
 *@NScriptType ClientScript
 */
define(['N/runtime', 'N/search', 'N/ui/message', 'N/ui/dialog'], function (runtime, search, message, dialog) {
    function validateLine(context) {
        try {
            var currentRecord = context.currentRecord;
            var sublistName = context.sublistId;
            var user = runtime.getCurrentUser();
            var datosTransaction = lookup(search.Type.EMPLOYEE, user.id, ['custentity_drt_modificacion_importe']);
            debugger;
            if (!datosTransaction.success) {
                //throw 'Error al obtener información del empleado. Variable modifica importe.';
              	log.error({
                    title: 'Consulta Empleado',
                    details: JSON.stringify(datosTransaction)
                });
            }
            if (sublistName === 'item') {
                var pfpdescuento = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_pfpdescuento_'
                }) || '';
                var priceLevel = parseFloat(currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'price',
                })) || 1;
                if(parseFloat(pfpdescuento) > 0 ) {
                    currentRecord.setCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'price',
                        value: "1"
                    });
                }
                
                var nweRate = parseFloat(currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_drt_rate_backup'
                }) || currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'rate'
                }) ) || 0;
                
                var nweRateBlock = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_drt_rate_block'
                }) || currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'rate'
                }) || 0;
                
                if( nweRate != nweRateBlock){
                    nweRate = nweRateBlock;
                }
                var backup = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_drt_rate_backup',
                });
                if(!backup){
                    currentRecord.setCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'custcol_drt_rate_backup',
                        value: nweRate
                    });
                }
                

                var unit = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'units_display'
                }).toLowerCase() || '';

                var item = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'item'
                }) || '';
                var quantity = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'quantity'
                }) || '';

                var sobre_cargo = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_drt_sobre_cargo'
                }) || '';
                var largo = '';
                var sobrePrecio = '';

                if (
                    item &&
                    quantity &&
                    unit && (
                        unit == 'm' ||
                        unit == 'mt' ||
                        unit == 'm2'
                    )) {
                    var dataItem = search.lookupFields({
                        type: search.Type.ITEM,
                        id: item,
                        columns: ['custitem_drt_cp_largo', 'custitem_drt_nc_solicitar_corte']
                    }) || '';
                    console.log('dataItem ' + JSON.stringify(dataItem));
                    if (dataItem) {
                        largo = dataItem.custitem_drt_cp_largo;
                        sobrePrecio = dataItem.custitem_drt_nc_solicitar_corte;
                    }
                }
                if (
                    sobrePrecio &&
                    largo &&
                    sobre_cargo
                ) {
                    var porcentaje = quantity / largo;
                    if (porcentaje > 0 && porcentaje < .20) {
                        nweRate *= 1.20;
                    }
                    if (porcentaje >= .20 && porcentaje < .40) {
                        nweRate *= 1.15;
                    }
                    if (porcentaje >= .40 && porcentaje < .60) {
                        nweRate *= 1.10;
                    }
                    if (porcentaje >= .60) {
                        nweRate *= 1.05;
                    }

                }
                debugger;

                if (
                    pfpdescuento 
                ) {
                    nweRate *= 1 - (parseFloat(pfpdescuento) / 100);
                }

                if(!datosTransaction.data.custentity_drt_modificacion_importe) {
                    currentRecord.setCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'price',
                        value: "1"
                    });
                }

                currentRecord.setCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'rate',
                    value: nweRate
                });
            }
            if (sublistName === 'item') {
                var nweRate = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'rate'
                }) || 0;
                if (nweRate <= 0) {
                    if(!datosTransaction.data.custentity_drt_modificacion_importe) {
                        currentRecord.setCurrentSublistValue({
                            sublistId: sublistName,
                            fieldId: 'price',
                            value: "1"
                        });
                    }
                    showmessage({
                            title: "Error",
                            message: 'El monto de venta de: ' + parseFloat(nweRate) + ' No  esta permitido,',
                            type: message.Type.CONFIRMATION
                        },
                        10000
                    );
                }
            }
        } catch (error) {
            log.error({
                title: 'error validateLine',
                details: JSON.stringify(error)
            });
        } finally {
            return true;
        }
    }

    function showmessage(param_message, param_duration) {
        try {
            if (false) {
                var m = {
                    title: "My Title",
                    message: "My Message",
                    cause: 'cause',
                    type: message.Type.CONFIRMATION
                };
                var myMsg = message.create(param_message);

                myMsg.show({
                    duration: param_duration
                });
            } else {
                var options = {
                    title: '',
                    message: '',
                };
                options.title = param_message.title;
                options.message = param_message.message;
                dialog.alert(options)
            }

        } catch (error) {
            log.error({
                title: 'error showmessage',
                details: JSON.stringify(error)
            });
        }
    }


    function fieldChanged(context) {
        var currentRecord = context.currentRecord;
        var sublistName = context.sublistId;
        var sublistFieldName = context.fieldId;
        debugger;
        try {
            if (sublistName === 'item' && (sublistFieldName === 'quantity' || sublistFieldName === 'units')) {
                var backup = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_drt_rate_backup',
                });

                var currRate = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'rate',
                });
                /*currentRecord.setCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'price',
                    value: "1"
                });*/
                var nweRate =  backup || currRate || '';

                
                if(!backup){
                    currentRecord.setCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'custcol_drt_rate_backup',
                        value: nweRate
                    });
                }

            }
            
            if (sublistName === 'item' && sublistFieldName === 'custcol_pfpdescuento_') {
                var pfpdescuento = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_pfpdescuento_'
                });
                currentRecord.setCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'price',
                        value: "1"
                    });
                if (pfpdescuento) {
  var entity = '';
  var maxdiscountEntity = 0;
  var user = runtime.getCurrentUser();
  var customerEntity = currentRecord.getValue('entity') || currentRecord.getValue('customer') || "";
  var customerMaxDiscount = 1000;
  entity = user.name;
  var descuento = parseFloat(pfpdescuento) || 0;
  var mensaje = '';
  var aplicadescuento = 0;

  if (customerEntity) {
    var customer = lookup(search.Type.CUSTOMER, customerEntity, ['custentitydrt_descuieno_maxcustomoe']);
    if (customer.success) {
      customerMaxDiscount = parseFloat(customer.data.custentitydrt_descuieno_maxcustomoe) || 0;
    }
  }

  var maxdiscountItem = parseFloat(currentRecord.getCurrentSublistValue({
    sublistId: sublistName,
    fieldId: 'custcol_drt_descuento_maximo_art'
  })) || 0;

  var datosTransaction = lookup(search.Type.EMPLOYEE, user.id, ['custentity_drt_descuento_maxio']);
  if (datosTransaction.success) {
    if (datosTransaction.data.custentity_drt_descuento_maxio) {
      maxdiscountEntity = parseFloat(datosTransaction.data.custentity_drt_descuento_maxio) || 0;
    }
  }

  if (!customerEntity || !maxdiscountEntity || !maxdiscountItem) {
  mensaje = 'No se puede aplicar descuento, el campo de descuento del articulo, cliente o del empleado está vacío';
    } 
  else if (maxdiscountEntity > 0 && customerMaxDiscount > 0) {
    if (customerMaxDiscount >= maxdiscountEntity && customerMaxDiscount < maxdiscountItem) {
      aplicadescuento = 2;
    } else if (customerMaxDiscount < maxdiscountEntity && maxdiscountEntity <= maxdiscountItem) {
      aplicadescuento = 1;
    } else {
      aplicadescuento = 0;
    }

    var maxDiscount = Math.max(maxdiscountEntity, customerMaxDiscount);

    if (descuento <= maxDiscount && descuento <= maxdiscountItem) {
      mensaje = '';
    } else {
      var itemName = currentRecord.getCurrentSublistText({
        sublistId: sublistName,
        fieldId: 'item'
      }) || '';
      mensaje = 'El artículo ' + itemName + ' está autorizado a un descuento máximo de: ' + maxdiscountItem + '% y el mayor entre el empleado y cliente es de: ' + maxDiscount + '%, no puedo aplicar el descuento de: ' + pfpdescuento + '%';
    }
  } else {
    mensaje = 'No se puede aplicar descuento, el empleado o el cliente no tienen descuento asignado';
  }

  if (mensaje) {
    currentRecord.setCurrentSublistValue({
      sublistId: sublistName,
      fieldId: 'custcol_pfpdescuento_',
      value: 0
    });
    showmessage({
      title: "Descuento",
      message: mensaje,
      type: message.Type.CONFIRMATION
    }, 10000);
  }
}
            }
            if (sublistName === 'item' && sublistFieldName === 'rate') {
                currentRecord.setCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_drt_rate_block',
                    value: currentRecord.getCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'rate'
                    })
                });
            }

            if (sublistName === 'item' && sublistFieldName === 'custcol_drt_rate_backup') {
              var drt_rate =  parseFloat(currentRecord.getCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'custcol_drt_rate_backup'
                    })) || 0;
              if(drt_rate > 0) {
               currentRecord.setCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'rate',
                    value: drt_rate
                });
              }
            }

            if (sublistName === 'item' && sublistFieldName === 'price') {
                var priceLevel = parseFloat(currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'price',
                })) || 1;
                if(priceLevel < 1) {
                    currentRecord.setCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'rate',
                        value: currentRecord.getCurrentSublistValue({
                            sublistId: sublistName,
                            fieldId: 'custcol_drt_rate_backup'
                        })
                    });
                }
            }
        
        } catch (error) {
            log.error({
                title: 'error fieldChanged',
                details: JSON.stringify(error)
            });
        } finally {
            return true;
        }
    }

    function postSourcing(context) {
        try {
            var currentRecord = context.currentRecord;
            var sublistName = context.sublistId;
            var sublistFieldName = context.fieldId;
            if (sublistName === 'item' && (sublistFieldName === 'item' || sublistFieldName === 'quantity' || sublistFieldName === 'units')) {

                var backup = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'custcol_drt_rate_backup',
                });
    
                var currRate = currentRecord.getCurrentSublistValue({
                    sublistId: sublistName,
                    fieldId: 'rate',
                });
                var nweRate = backup|| currRate|| '';

                if(!backup){
                    currentRecord.setCurrentSublistValue({
                        sublistId: sublistName,
                        fieldId: 'custcol_drt_rate_backup',
                        value: nweRate
                    });
                }
                

            }
        } catch (error) {
            log.audit({
                title: 'error',
                details: JSON.stringify(error)
            });
        } finally {
            return true;
        }

    }

    function lookup(param_type, param_id, param_columns) {
        try {
            var respuesta = {
                success: false,
                data: {},
                error: {}
            };
            log.audit({
                title: 'lookup',
                details: ' param_type: ' + param_type +
                    ' param_id: ' + param_id +
                    ' param_columns: ' + param_columns
            });
            if (param_type && param_id && param_columns.length > 0) {

                respuesta.data = search.lookupFields({
                    type: param_type,
                    id: param_id,
                    columns: param_columns
                }) || '';
                respuesta.success = Object.keys(respuesta.data).length > 0;
            } else {
                respuesta.error.message =
                    'Falta Informacion ' +
                    ' *type: ' + param_type +
                    ' *id: ' + param_id +
                    ' *columns: ' + param_columns;
            }
        } catch (error) {
            log.error({
                title: 'error lookup',
                details: JSON.stringify(error)
            });
            respuesta.error = error;
        } finally {
            log.audit({
                title: 'respuesta lookup',
                details: JSON.stringify(respuesta)
            });
            return respuesta;
        }
    }
    return {
        postSourcing: postSourcing,
        fieldChanged: fieldChanged,
        validateLine: validateLine
    }
});