import { defineServer } from '@ruimte/extension/server';

export default defineServer({
    async now() {
        return new Date().toISOString();
    }
});
