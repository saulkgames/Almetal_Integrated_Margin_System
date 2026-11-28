const path = require('path');

const corePath = path.join(
    __dirname,
    '..',
    'src',
    'FileCabinet',
    'SuiteScripts',
    'sistema_margenes',
    'CM_Margin_System_Core.js'
);

require(corePath);

const { isSubsidiaryCustomer, validateMarginRule } = global.amdModule;

describe('CM_Margin_System_Core', () => {
    describe('isSubsidiaryCustomer', () => {
        it('returns false when customerData is null', () => {
            expect(isSubsidiaryCustomer(null)).toBe(false);
        });

        it('returns false when customerData is undefined', () => {
            expect(isSubsidiaryCustomer(undefined)).toBe(false);
        });

        it('returns true for boolean true', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: true })).toBe(true);
        });

        it('returns true for NetSuite checked string "T"', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: 'T' })).toBe(true);
        });

        it('returns true for "Y"', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: 'Y' })).toBe(true);
        });

        it('returns true for integer 1', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: 1 })).toBe(true);
        });

        it('returns true for string "1"', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: '1' })).toBe(true);
        });

        it('returns false for NetSuite unchecked string "F"', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: 'F' })).toBe(false);
        });

        it('returns false for boolean false', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: false })).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: '' })).toBe(false);
        });

        it('returns false for integer 0', () => {
            expect(isSubsidiaryCustomer({ custentity_alm_check_intercompania: 0 })).toBe(false);
        });

        it('returns false when checkbox field is missing', () => {
            expect(isSubsidiaryCustomer({})).toBe(false);
        });
    });

    describe('validateMarginRule', () => {
        it('returns valid result when discount is within all limits', () => {
            const result = validateMarginRule({
                precioBase: 100,
                margenEstandar: 20,
                descMargenSolicitado: 0.10,
                descMargenServicio: 0,
                limiteArticulo: 0.20,
                limiteCliente: 0.20,
                limiteUsuario: 0.20
            });
            expect(result.isValid).toBe(true);
            expect(result.finalPrice).toBeGreaterThan(0);
        });

        it('returns invalid when discount exceeds item capacity', () => {
            const result = validateMarginRule({
                precioBase: 100,
                margenEstandar: 20,
                descMargenSolicitado: 0.30,
                descMargenServicio: 0,
                limiteArticulo: 0.20,
                limiteCliente: 0.50,
                limiteUsuario: 0.50
            });
            expect(result.isValid).toBe(false);
        });
    });
});
