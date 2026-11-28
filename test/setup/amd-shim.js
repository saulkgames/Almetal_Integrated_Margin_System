/**
 * Minimal AMD shim for loading SuiteScript 2.1 custom modules in Jest.
 * Provides a global `define()` that resolves the module immediately using
 * mocked NetSuite dependencies and exposes the result on `global.amdModule`.
 */
global.define = (deps, factory) => {
    const mocks = {
        'N/error': {
            create: (params) => new Error(params && params.message ? params.message : 'NetSuite error')
        },
        'N/log': {
            audit: () => {},
            error: () => {}
        }
    };

    const args = deps.map((dep) => mocks[dep]);
    global.amdModule = factory(...args);
};

global.amdModule = null;
