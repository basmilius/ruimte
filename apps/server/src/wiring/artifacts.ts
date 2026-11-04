import { join } from 'node:path';
import type { ArtifactProvenance } from '@ruimte/contracts';
import { pinnedVersionsOf } from '../artifacts/artifact-cleanup.ts';
import { agentProvenance } from '../artifacts/artifact-provenance.ts';
import { ArtifactStore } from '../artifacts/artifact-store.ts';
import { Artifacts } from '../artifacts/artifacts.ts';
import type { MachineHome } from '../fs/machine-home.ts';
import type { Routines } from '../routines/routines.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { ProjectsBundle } from './projects.ts';

/* Output on this machine: the store under `$RUIMTE_HOME/artifacts` and what a person and an agent do with it. */
export interface ArtifactsBundle {
    store: ArtifactStore;
    artifacts: Artifacts;
}

interface ArtifactsInput {
    home: string;
    machineId: string;
    machineHome: MachineHome;
    stores: AgentStores;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    later?: { routines(): Routines };
}

export async function wireArtifacts(input: ArtifactsInput): Promise<ArtifactsBundle> {
    const { home, machineId, stores, agents } = input;
    const { chats } = agents;
    const projects = input.projects.store;
    const store = new ArtifactStore({ root: join(home, 'artifacts') });
    // Before a client or an agent can ask, so a save a stop cut short is gone or whole by then.
    await store.load();
    // From the daemon's own records of the caller only: an agent never states where its work came from.
    const provenanceOf = async (caller: string): Promise<ArtifactProvenance> => {
        const chat = chats.get(caller);
        const isChat = chat !== undefined || (await chats.hasStored(caller));
        const taskId = stores.tasks.openFor(caller)?.id;
        // A routine's run is named from the daemon's own record of the chat, never from the call.
        const routine = input.later?.routines().provenanceOf(caller) ?? null;
        const provenance = agentProvenance({
            machineId,
            caller,
            isChat,
            ...(chat === undefined ? {} : { chat: chat.info }),
            ...(taskId === undefined ? {} : { taskId })
        });
        return routine === null ? provenance : { ...provenance, maker: 'routine', ...routine };
    };
    const artifacts = new Artifacts({
        store,
        home,
        machineId,
        projects: { known: () => projects.known(), projectOf: (id) => projects.locate(id)?.projectId ?? null },
        chats: { findAttachment: (chatId, id) => chats.findAttachment(chatId, id), hasStored: (chatId) => chats.hasStored(chatId) },
        machineHome: input.machineHome,
        provenanceOf,
        pinned: () => pinnedVersionsOf(projects.index.pinnedArtifactVersions())
    });
    return { store, artifacts };
}
