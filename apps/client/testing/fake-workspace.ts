import type { ProjectDocument, ProjectLocal, ProjectSummary } from '@ruimte/contracts';
import { dropClientLocal } from '@/project/client-local';
import { forgetCachedList } from '@/project/list';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { dropMachine, enterWorkspace, showStart } from '@/transport/connections';
import { connectFakeMachine, type FakeMachine } from './fake-machine';

const FAKE_PROJECT: ProjectSummary = {
    projectId: 'project-atlas',
    name: 'Atlas',
    color: '#000',
    folder: '/work/atlas',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'A' },
    nameSource: 'chosen'
};

// The web client has no machine of its own to open a project on, so the project is on a machine of the list.
const ENDPOINT: Endpoint = {
    id: 'fake-machine',
    label: 'Fake machine',
    httpBaseUrl: 'http://127.0.0.1:1',
    wsBaseUrl: 'ws://127.0.0.1:1',
    reachability: 'lan',
    daemonId: null,
    daemonPublicKey: null
};

export interface FakeWorkspace {
    close(): void;
}

/*
 * A project open in the window, on a fake machine that answered `project.open` with these views. With
 * `thisMachine` the fake stands in for the machine the app runs, which needs a desktop bridge set first.
 */
export async function openFakeWorkspace(
    machine: FakeMachine,
    document: Omit<ProjectDocument, 'version' | 'rev' | 'name' | 'color'>,
    local: ProjectLocal,
    summary: Partial<ProjectSummary> = {},
    options: { thisMachine?: boolean } = {}
): Promise<FakeWorkspace> {
    const project = { ...FAKE_PROJECT, ...summary };
    machine.answer('project.open', () => ({
        summary: project,
        document: { version: 3, rev: 1, name: FAKE_PROJECT.name, color: FAKE_PROJECT.color, ...document } as ProjectDocument,
        local
    }));
    machine.answer('project.list', () => ({ projects: [project] }));
    const endpointId = options.thisMachine === true ? LOCAL_ENDPOINT_ID : ENDPOINT.id;
    if (endpointId === ENDPOINT.id) {
        useEndpoints.getState().add(ENDPOINT);
    }
    const disconnect = connectFakeMachine(machine, endpointId);
    // Files share a page, and closing an earlier fixture stores its view there, which would win over `local`.
    dropClientLocal(localStorage, endpointId, FAKE_PROJECT.projectId);
    await enterWorkspace(endpointId, { projectId: FAKE_PROJECT.projectId });
    return {
        close(): void {
            showStart();
            dropMachine(endpointId);
            disconnect();
            useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
            if (endpointId === ENDPOINT.id) {
                useEndpoints.getState().remove(ENDPOINT.id);
            } else {
                // The row of this machine stays for the next test, so what it listed goes instead.
                useProjectList.getState().setProjects(endpointId, []);
                forgetCachedList(endpointId);
            }
        }
    };
}
