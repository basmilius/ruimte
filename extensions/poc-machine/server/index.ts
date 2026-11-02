import { defineLanguageServer, defineServer } from '@ruimte/extension/server';

const api = defineServer({
    async addServer() {
        await defineLanguageServer({ name: 'POC language server', command: 'cat', languages: ['poc'], patterns: ['*.poc'] });

        return 'Look in Settings, Language servers';
    }
});

export type MachineServer = typeof api;
export default api;
