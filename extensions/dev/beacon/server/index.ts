import { defineAgentProvider, defineServer } from '@ruimte/extension/server';
import { deviceFindings, findingsFor, INSPECTOR_MODELS, reportText, type ReportInput } from './service';

export const INSPECTOR = 'inspector';

/*
 * Beacon's own agent, which speaks ACP. Beacon only says which program that is and which models it has; Ruimte starts
 * it for a chat. The program is fictional, so a picker lists Beacon Inspector as not installed.
 */
defineAgentProvider({
    id: INSPECTOR,
    name: 'Beacon Inspector',
    protocol: 'acp',
    spawn: () => ({ command: 'beacon-inspector', args: ['acp'], env: { BEACON_RULES: 'account' } }),
    models: async () => [...INSPECTOR_MODELS]
});

const api = defineServer({
    async findings(url: string) {
        return findingsFor(url);
    },
    async deviceFindings() {
        return deviceFindings();
    },
    async report(input: ReportInput) {
        return reportText(input);
    }
});

export type { Finding, ReportInput } from './service';
export type BeaconServer = typeof api;
export default api;
