import { createStore } from 'zustand';
import type { ChatImageTargetResult } from '@ruimte/contracts';
import { absoluteOf } from '@/shell/panels/files-tree';
import type { Transport } from '@/transport';

export interface ImageSaveState {
    directory: string;
    name: string;
    checkedPath: string | null;
    target: ChatImageTargetResult | null;
    pending: boolean;
    error: string | null;
    closed: boolean;
}

export function validImageFileName(name: string): boolean {
    return name.trim() !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

export class ImageSaveSession {
    readonly state;
    readonly root: ChatImageTargetResult;
    readonly transport: Transport;
    private readonly source: { chatId: string; attachmentId: string };
    private readonly resolve: (path: string | null) => void;
    private checkId = 0;

    constructor(transport: Transport, source: { chatId: string; attachmentId: string }, root: ChatImageTargetResult, done: (path: string | null) => void) {
        this.transport = transport;
        this.source = source;
        this.root = root;
        this.resolve = done;
        this.state = createStore<ImageSaveState>(() => ({
            directory: '',
            name: root.name,
            checkedPath: null,
            target: null,
            pending: false,
            error: null,
            closed: false
        }));
    }

    path(): string {
        const { directory, name } = this.state.getState();
        return absoluteOf(this.root.folder, directory === '' ? name : `${directory}/${name}`);
    }

    selectDirectory(directory: string): void {
        if (this.state.getState().pending || this.state.getState().closed) {
            return;
        }
        this.state.setState({ directory, checkedPath: null, target: null, error: null });
        void this.check();
    }

    name(name: string): void {
        if (this.state.getState().pending || this.state.getState().closed) {
            return;
        }
        this.state.setState({ name, checkedPath: null, target: null, error: null });
        void this.check();
    }

    async check(): Promise<void> {
        const id = ++this.checkId;
        const path = this.path();
        if (!validImageFileName(this.state.getState().name)) {
            return;
        }
        try {
            const target = await this.transport.request('chat.imageTarget', { ...this.source, path });
            if (id === this.checkId && !this.state.getState().closed) {
                this.state.setState({ checkedPath: path, target });
            }
        } catch (error) {
            if (id === this.checkId && !this.state.getState().closed) {
                this.state.setState({ error: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    async save(replace: boolean): Promise<void> {
        const state = this.state.getState();
        const path = this.path();
        if (state.closed || state.pending || state.checkedPath !== path || state.target === null || !validImageFileName(state.name)) {
            return;
        }
        if (state.target.exists !== replace || (replace && state.target.revision === null)) {
            return;
        }
        this.state.setState({ pending: true, error: null });
        try {
            const result = await this.transport.request('chat.saveImage', {
                ...this.source,
                path,
                ...(replace ? { replace: state.target.revision! } : {})
            });
            this.state.setState({ pending: false, closed: true });
            this.checkId++;
            this.resolve(result.path);
        } catch (error) {
            this.state.setState({ pending: false, checkedPath: null, target: null });
            await this.check();
            if (!this.state.getState().closed) {
                this.state.setState({ error: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    close(): void {
        const state = this.state.getState();
        if (state.pending || state.closed) {
            return;
        }
        this.checkId++;
        this.state.setState({ closed: true });
        this.resolve(null);
    }
}

export const imageSaveDialog = createStore<{ session: ImageSaveSession | null }>(() => ({ session: null }));

export async function requestImageSave(transport: Transport, chatId: string, attachmentId: string): Promise<string | null> {
    if (imageSaveDialog.getState().session !== null) {
        return null;
    }
    const source = { chatId, attachmentId };
    const root = await transport.request('chat.imageTarget', source);
    if (imageSaveDialog.getState().session !== null) {
        return null;
    }
    return new Promise((resolve) => {
        const session = new ImageSaveSession(transport, source, root, (path) => {
            imageSaveDialog.setState({ session: null });
            resolve(path);
        });
        imageSaveDialog.setState({ session });
        void session.check();
    });
}
