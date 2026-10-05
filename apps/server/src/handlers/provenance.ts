import { translate, type Dispatcher } from '../dispatcher.ts';
import type { MachineHome } from '../fs/machine-home.ts';
import type { ProvenanceService } from '../provenance/provenance-service.ts';

/* The records are the daemon's own and a client only reads them or sets a review state, so a path gets the same checks a file request does. */
export function registerProvenanceHandlers(dispatcher: Dispatcher, provenance: ProvenanceService, machineHome: MachineHome): void {
    dispatcher.register('provenance.read', (payload) =>
        translate(async () => {
            await machineHome.refuse(payload.path);
            return provenance.read(payload.projectId, payload.path);
        })
    );

    dispatcher.register('provenance.review', (payload) =>
        translate(async () => {
            await machineHome.refuse(payload.path);
            return { updated: await provenance.review(payload.projectId, payload.path, payload.runIds, payload.state) };
        })
    );
}
