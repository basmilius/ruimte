import type { ServerFrame } from '@ruimte/contracts';
import type { Dispatcher } from '../dispatcher.ts';
import type { LanguageHost } from '../language/host.ts';
import type { ClientAccess } from '../wire.ts';
import type { GitDeps } from './git.ts';
import type { SessionDeps } from './session.ts';

/* The session handlers over a manager: no CLI has a login, no node runs on another machine, and a kill owes nothing. */
export function sessionDepsWith(manager: SessionDeps['manager'], overrides: Partial<Omit<SessionDeps, 'manager'>> = {}): SessionDeps {
    return {
        manager,
        beforeKill: async () => undefined,
        logins: { commandOf: () => undefined, nameOf: (kind) => kind },
        machineOf: () => null,
        ...overrides
    };
}

/* A machine home that holds no state of its own, so nothing under any path is refused. */
export const HOME_WITHOUT_STATE: GitDeps['machineHome'] = {
    refuse: async () => undefined,
    refuseHolding: async () => undefined,
    stateWithin: async () => []
};

/* The git handlers over what a test names; a service it names nothing for fails the test that reaches it. */
export function gitDepsWith(overrides: Partial<GitDeps> = {}): GitDeps {
    return {
        worktrees: {} as never,
        merges: {} as never,
        statuses: {} as never,
        providers: {} as never,
        prWatches: {} as never,
        placeOf: () => null,
        textModels: { choice: () => null, prepare: async () => null },
        machineHome: HOME_WITHOUT_STATE,
        bundles: {} as never,
        checkpoints: {} as never,
        folderOf: async () => null,
        untrusted: () => false,
        untrustFolder: async () => undefined,
        oneShotPlace: { cwdFor: async (folder) => folder },
        ...overrides
    };
}

/* A machine with no language server running: a file is moved, made and deleted as asked, and no server proposes an edit. */
export const NO_LANGUAGE_SERVERS: Pick<LanguageHost, 'renameFiles' | 'createFiles' | 'deleteFiles' | 'saved'> = {
    renameFiles: async (_clientId, _projectId, _from, _to, _edits, file) => {
        await file.move();
        return [];
    },
    createFiles: async (_clientId, _projectId, _path, _directory, _edits, file) => {
        await file.move();
        return [];
    },
    deleteFiles: async (_clientId, _projectId, _path, _edits, file) => {
        await file.move();
        return [];
    },
    saved: async () => undefined
};

/** Sends one request as `client` and returns the first frame the dispatcher answers with. */
export async function askOnce(dispatcher: Dispatcher, client: { id: string; access?: ClientAccess }, type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ ...client, send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}
