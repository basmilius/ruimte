// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
export const electron = require('electron') as typeof import('electron');
