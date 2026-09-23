import i18next from 'i18next';
import { create } from 'zustand';
import type { FsReadResult, FsWriteResult } from '@ruimte/contracts';
import { endpointKey } from '@/state/keys';
import { windowWorkspace } from '@/state/window';
import { transportFor } from '@/transport';
import { isConnectionError, TransportError } from '@/transport/transport';

/* How long typing has to pause before the draft goes to disk. */
export const AUTOSAVE_DELAY_MS = 1000;

export type DraftProblem =
    /* A save was refused because the file moved on disk since it was read. */
    | { kind: 'stale' }
    /* A read after `fs.changed` found the file moved while this draft was unsaved. */
    | { kind: 'changed' }
    | { kind: 'error'; message: string };

export interface TextDraft {
    /* What is on disk as far as this client knows, from the last read or the last write. */
    disk: string;
    mtime: number;
    /* What the editors hold; unsaved while it differs from `disk`. */
    text: string;
    saving: boolean;
    problem: DraftProblem | null;
}

export interface DiskText {
    text: string;
    mtime: number;
}

export interface DraftLink {
    read(path: string): Promise<FsReadResult>;
    write(path: string, text: string, expectedMtime: number): Promise<FsWriteResult>;
    /* Settles once the project is open on the machine again after the link came back. */
    projectOpen(): Promise<void>;
}

export const isUnsavedDraft = (draft: TextDraft | undefined): boolean => draft !== undefined && draft.text !== draft.disk;

/* A problem only a person can answer: saving waits for Reload or Overwrite. */
const waitsForPerson = (draft: TextDraft): boolean => draft.problem?.kind === 'stale' || draft.problem?.kind === 'changed';

interface DraftsStore {
    /* Per machine and absolute path (`state/keys.ts`), so every surface on one file shares one draft. */
    rows: Record<string, TextDraft>;
}

export const useTextDrafts = create<DraftsStore>(() => ({ rows: {} }));

interface Pending {
    timer: ReturnType<typeof setTimeout> | null;
    saving: Promise<boolean> | null;
    /* A read that came in while a save was out, weighed once the save settles. */
    heldRead: DiskText | null;
    /* The surfaces drawing this file right now; a clean draft goes with the last of them. */
    holders: number;
}

const messageOf = (error: unknown): string => {
    if (isConnectionError(error)) {
        return i18next.t('panels:file.draft.notConnected');
    }
    return error instanceof TransportError ? error.message : i18next.t('panels:file.draft.saveFailed');
};

/*
 * The text of every file being edited on this client, one draft per file whatever number of tabs,
 * views and nodes show it, so two editors on one file type into the same text and never save over
 * each other. A draft saves itself a moment after the typing stops, and never while a save of the
 * same file is still out. The machine refuses a write over a file that moved (`stale`), and a read
 * that finds the file moved under an unsaved draft stops the saving the same way: only a person
 * decides between the two versions.
 */
export class TextDrafts {
    private readonly linkFor: (endpointId: string) => DraftLink | null;
    private readonly pending = new Map<string, Pending>();

    constructor(linkFor: (endpointId: string) => DraftLink | null) {
        this.linkFor = linkFor;
    }

    draft(endpointId: string, path: string): TextDraft | undefined {
        return useTextDrafts.getState().rows[endpointKey(endpointId, path)];
    }

    isUnsaved(endpointId: string, path: string): boolean {
        return isUnsavedDraft(this.draft(endpointId, path));
    }

    /* A surface drawing the file; the release lets a clean draft go once nothing draws it. */
    hold(endpointId: string, path: string): () => void {
        const key = endpointKey(endpointId, path);
        this.pendingOf(key).holders += 1;
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.pendingOf(key).holders -= 1;
            this.dropIfIdle(key);
        };
    }

    /* An editor opened on what the file read as. A draft that is already there stays and hears the read. */
    open(endpointId: string, path: string, disk: DiskText): void {
        const key = endpointKey(endpointId, path);
        if (useTextDrafts.getState().rows[key] === undefined) {
            this.put(key, { disk: disk.text, mtime: disk.mtime, text: disk.text, saving: false, problem: null });
            return;
        }
        this.received(endpointId, path, disk);
    }

    /* A read of the file came in, the first one or one after `fs.changed`. Nothing happens without a draft. */
    received(endpointId: string, path: string, disk: DiskText): void {
        const key = endpointKey(endpointId, path);
        if (useTextDrafts.getState().rows[key] === undefined) {
            return;
        }
        const pending = this.pendingOf(key);
        if (pending.saving !== null) {
            pending.heldRead = disk;
            return;
        }
        this.weigh(key, disk);
    }

    edit(endpointId: string, path: string, text: string): void {
        const key = endpointKey(endpointId, path);
        const draft = useTextDrafts.getState().rows[key];
        if (draft === undefined || draft.text === text) {
            return;
        }
        this.patch(key, { text });
        this.clearTimer(key);
        if (text === draft.disk || waitsForPerson(draft)) {
            return;
        }
        this.pendingOf(key).timer = setTimeout(() => {
            this.pendingOf(key).timer = null;
            void this.save(endpointId, path);
        }, AUTOSAVE_DELAY_MS);
    }

    /* Writes the draft now. True once nothing is left unsaved; false while a problem stands in the way. */
    save(endpointId: string, path: string): Promise<boolean> {
        const key = endpointKey(endpointId, path);
        const pending = this.pendingOf(key);
        this.clearTimer(key);
        if (pending.saving !== null) {
            return pending.saving.then(() => this.save(endpointId, path));
        }
        const draft = useTextDrafts.getState().rows[key];
        if (draft === undefined || !isUnsavedDraft(draft)) {
            if (draft?.problem?.kind === 'error') {
                this.patch(key, { problem: null });
            }
            return Promise.resolve(true);
        }
        if (waitsForPerson(draft)) {
            return Promise.resolve(false);
        }
        // Past a microtask, so `saving` is set before the write can settle and clear it; what was typed while it was out goes right after.
        const saving = Promise.resolve()
            .then(() => this.write(endpointId, path, draft.text, draft.mtime))
            .then((written) => (written && this.isUnsaved(endpointId, path) ? this.save(endpointId, path) : written));
        pending.saving = saving;
        return saving;
    }

    /* Takes what is on disk now and drops the draft. */
    async reload(endpointId: string, path: string): Promise<void> {
        const key = endpointKey(endpointId, path);
        const disk = await this.readText(endpointId, path);
        if (disk === null || useTextDrafts.getState().rows[key] === undefined) {
            return;
        }
        this.clearTimer(key);
        this.patch(key, { disk: disk.text, mtime: disk.mtime, text: disk.text, problem: null });
    }

    /* Writes the draft over whatever is on disk now, at the mtime it has now. */
    async overwrite(endpointId: string, path: string): Promise<boolean> {
        const key = endpointKey(endpointId, path);
        const disk = await this.readText(endpointId, path);
        if (disk === null || useTextDrafts.getState().rows[key] === undefined) {
            return false;
        }
        this.patch(key, { disk: disk.text, mtime: disk.mtime, problem: null });
        return this.save(endpointId, path);
    }

    /* What a person does when closing without saving: the draft is gone, the file stays as it is on disk. */
    discard(endpointId: string, path: string): void {
        const key = endpointKey(endpointId, path);
        const draft = useTextDrafts.getState().rows[key];
        if (draft === undefined) {
            return;
        }
        this.clearTimer(key);
        this.patch(key, { text: draft.disk, problem: null });
        this.dropIfIdle(key);
    }

    private async write(endpointId: string, path: string, text: string, expectedMtime: number): Promise<boolean> {
        const key = endpointKey(endpointId, path);
        this.patch(key, { saving: true });
        let saved = false;
        let problem: DraftProblem | null = null;
        let written: number | null = null;
        const link = this.linkFor(endpointId);
        if (link === null) {
            problem = { kind: 'error', message: i18next.t('panels:file.draft.notConnected') };
        } else {
            try {
                written = (await this.writeOnce(link, path, text, expectedMtime)).mtime;
                saved = true;
            } catch (error: unknown) {
                problem = error instanceof TransportError && error.code === 'stale' ? { kind: 'stale' } : { kind: 'error', message: messageOf(error) };
            }
        }
        const pending = this.pendingOf(key);
        pending.saving = null;
        if (useTextDrafts.getState().rows[key] === undefined) {
            return saved;
        }
        this.patch(key, written === null ? { saving: false, problem } : { saving: false, problem: null, disk: text, mtime: written });
        const held = pending.heldRead;
        pending.heldRead = null;
        // A read taken before the write landed says nothing new; one taken after it may be our own write coming back.
        if (held !== null && held.mtime !== expectedMtime) {
            this.weigh(key, held);
        }
        this.dropIfIdle(key);
        return saved;
    }

    /* The project hold is per socket and comes back with the client's resume, so a refusal right after a reconnect gets one more try. */
    private async writeOnce(link: DraftLink, path: string, text: string, expectedMtime: number): Promise<FsWriteResult> {
        try {
            return await link.write(path, text, expectedMtime);
        } catch (error: unknown) {
            if (!(error instanceof TransportError) || error.code !== 'outside-project') {
                throw error;
            }
            await link.projectOpen();
            return link.write(path, text, expectedMtime);
        }
    }

    /* A fresh read for Reload and Overwrite. A file that stopped being text, or went, is a problem on the draft. */
    private async readText(endpointId: string, path: string): Promise<DiskText | null> {
        const key = endpointKey(endpointId, path);
        const link = this.linkFor(endpointId);
        try {
            if (link === null) {
                throw new TransportError('not-connected', i18next.t('panels:file.draft.notConnected'));
            }
            const read = await link.read(path);
            if (read.kind !== 'text') {
                throw new TransportError('not-text', i18next.t('panels:file.draft.notText'));
            }
            return { text: read.text, mtime: read.mtime };
        } catch (error: unknown) {
            if (useTextDrafts.getState().rows[key] !== undefined) {
                this.patch(key, { problem: { kind: 'error', message: messageOf(error) } });
            }
            return null;
        }
    }

    /* How a read compares with the draft. Our own write coming back carries the mtime the draft already has. */
    private weigh(key: string, disk: DiskText): void {
        const draft = useTextDrafts.getState().rows[key];
        if (draft === undefined || disk.mtime === draft.mtime) {
            return;
        }
        // Disk caught up with the draft, or the file was only touched: nothing to decide either way.
        if (disk.text === draft.text || disk.text === draft.disk) {
            if (disk.text === draft.text) {
                this.clearTimer(key);
            }
            this.patch(key, { disk: disk.text, mtime: disk.mtime, ...(disk.text === draft.text ? { problem: null } : {}) });
            return;
        }
        if (!isUnsavedDraft(draft)) {
            this.patch(key, { disk: disk.text, mtime: disk.mtime, text: disk.text, problem: null });
            return;
        }
        this.clearTimer(key);
        if (draft.problem?.kind !== 'stale') {
            this.patch(key, { problem: { kind: 'changed' } });
        }
    }

    private put(key: string, draft: TextDraft): void {
        useTextDrafts.setState((state) => ({ rows: { ...state.rows, [key]: draft } }));
    }

    private patch(key: string, patch: Partial<TextDraft>): void {
        useTextDrafts.setState((state) => {
            const draft = state.rows[key];
            return draft === undefined ? state : { rows: { ...state.rows, [key]: { ...draft, ...patch } } };
        });
    }

    private pendingOf(key: string): Pending {
        let pending = this.pending.get(key);
        if (pending === undefined) {
            pending = { timer: null, saving: null, heldRead: null, holders: 0 };
            this.pending.set(key, pending);
        }
        return pending;
    }

    private clearTimer(key: string): void {
        const pending = this.pending.get(key);
        if (pending?.timer != null) {
            clearTimeout(pending.timer);
            pending.timer = null;
        }
    }

    /* An unsaved draft outlives every surface, so zooming a node out or switching a tab loses nothing. */
    private dropIfIdle(key: string): void {
        const pending = this.pending.get(key);
        const draft = useTextDrafts.getState().rows[key];
        if (pending === undefined || pending.holders > 0 || pending.saving !== null || isUnsavedDraft(draft) || draft?.problem != null) {
            return;
        }
        this.pending.delete(key);
        useTextDrafts.setState((state) => {
            const { [key]: _gone, ...rows } = state.rows;
            return { rows };
        });
    }
}

const liveLink = (endpointId: string): DraftLink | null => {
    const transport = transportFor(endpointId);
    if (transport === null) {
        return null;
    }
    return {
        read: (path) => transport.request('fs.read', { path }),
        write: (path, text, expectedMtime) => transport.request('fs.write', { path, text, expectedMtime }),
        projectOpen: () => {
            const connection = windowWorkspace()?.connection;
            return connection?.endpointId === endpointId ? connection.projects.whenOpen() : Promise.resolve();
        }
    };
};

export const textDrafts = new TextDrafts(liveLink);

export const useTextDraft = (endpointId: string, path: string | null): TextDraft | undefined =>
    useTextDrafts((state) => (path === null ? undefined : state.rows[endpointKey(endpointId, path)]));

export const useUnsaved = (endpointId: string, path: string | null): boolean =>
    useTextDrafts((state) => path !== null && isUnsavedDraft(state.rows[endpointKey(endpointId, path)]));
