import { defineLanguageServer, defineServer } from '@ruimte/extension/server';

const api = defineServer({
    async addServer() {
        const added = await defineLanguageServer({ name: 'POC language server', command: 'cat', languages: ['poc'], patterns: ['*.poc'] });

        return added.ok ? 'Look in Settings, Language servers' : added.error.message;
    }
});

export type MachineServer = typeof api;
export default api;
