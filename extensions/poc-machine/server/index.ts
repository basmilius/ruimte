import { defineLanguageServer, defineServer } from '@ruimte/extension/server';

const api = defineServer({
    async addServer() {
        defineLanguageServer({ name: 'POC language server', command: 'poc-language-server', languages: ['poc'], patterns: ['*.poc'] });

        return 'Look in Settings, Language servers';
    }
});

export type MachineServer = typeof api;
export default api;
