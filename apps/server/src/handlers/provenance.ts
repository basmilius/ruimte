import type { Area } from '../area.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { ProvenanceService } from '../provenance/provenance-service.ts';

interface ProvenanceDeps {
    provenance: ProvenanceService;
    machineHome: Pick<MachineHome, 'refuse'>;
}

/* The records are the daemon's own and a client only reads them or sets a review state, so a path gets the same checks a file request does. */
export function provenanceArea(deps: ProvenanceDeps): Area {
    return { name: 'provenance', sources: [deps.provenance], handlers: (dispatcher) => registerRequests(dispatcher, deps) };
}

function registerRequests(dispatcher: Dispatcher, { provenance, machineHome }: ProvenanceDeps): void {
    dispatcher.register('provenance.read', async (payload) => {
        await machineHome.refuse(payload.path);
        return provenance.read(payload.projectId, payload.path);
    });

    dispatcher.register('provenance.review', async (payload) => {
        await machineHome.refuse(payload.path);
        return { updated: await provenance.review(payload.projectId, payload.path, payload.runIds, payload.state) };
    });
}
