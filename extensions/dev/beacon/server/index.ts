import { defineServer } from '@ruimte/extension/server';
import { deviceFindings, findingsFor, reportText, type ReportInput } from './service';

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
