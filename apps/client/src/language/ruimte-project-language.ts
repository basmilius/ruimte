import { ProjectLanguage as SharedProjectLanguage, type LanguageDocumentHandle, type ProjectFiles, type RenameSuggestionsRequest } from '@adecore/editor-react';
import type { Editor } from '@adecore/editor';
import { fileUriToPath } from '@adecore/lsp';
import { onDeviceClientFor } from '@/ondevice/ondevice-client';
import { parseNames } from '@/ondevice/names-model';
import { namesPrompt } from '@/ondevice/prompts';
import { openFileLink } from '@/shell/panels/file-links';
import { RUIMTE_EDITOR_KEYMAP } from '@/shell/editor-keymap';
import { isApplePlatform } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport/transport';
import { ProjectProblems } from './project-problems';
import { LanguageStatusTracker } from './status';
import { WireLanguageService, type WireLanguageServiceOptions } from './wire-service';
import { shikiLanguageOf } from './language-ids-host';

export class ProjectLanguage extends SharedProjectLanguage {
    declare readonly service: WireLanguageService;
    readonly transport: Transport;
    readonly status: LanguageStatusTracker;
    readonly machineProblems: ProjectProblems;
    // The wire resynchronizes from the sending editor without starting a second document owner.
    private readonly openEditors: Map<string, Editor[]>;

    constructor(
        transport: Transport,
        projectId: string,
        folder: string,
        files: ProjectFiles | null = null,
        openFile: (folder: string, path: string, line: number) => void = (root, path, line) => void openFileLink(root, { path, line, directory: false })
    ) {
        const openEditors = new Map<string, Editor[]>();
        let applyEdit: WireLanguageServiceOptions['applyEdit'];
        const service = new WireLanguageService({
            transport,
            projectId,
            folder,
            textOf: (uri) => openEditors.get(uri)?.[0]?.getText(),
            applyEdit: (params) => applyEdit?.(params) ?? Promise.resolve({ applied: false, failureReason: 'The project language is not ready' })
        });
        super(service, {
            folder,
            ...(files === null ? {} : { files }),
            apple: isApplePlatform(),
            keymap: RUIMTE_EDITOR_KEYMAP,
            openPlace: (place) => {
                const path = fileUriToPath(place.uri);
                if (path !== null) {
                    openFile(folder, path, place.position.line + 1);
                }
            },
            pathOfUri: (uri) => service.pathOfLocation(uri),
            serverNames: (uri) => service.serversOf(uri),
            notify: (notification) => useToasts.getState().show(notification),
            suggestNames: (request, signal) => suggestNames(transport, request, signal)
        });
        this.openEditors = openEditors;
        applyEdit = (params) => this.applyWorkspaceEdit(params.edit);
        this.transport = transport;
        this.status = new LanguageStatusTracker(transport, projectId);
        // Machine reports include documents held by other clients, which the shared editor does not own.
        this.machineProblems = new ProjectProblems(transport, projectId);
        void this.status.refresh().catch(() => undefined);
    }

    override acquire(uri: string, languageId: string, editor: Editor): LanguageDocumentHandle {
        const editors = this.openEditors.get(uri) ?? [];
        editors.push(editor);
        this.openEditors.set(uri, editors);
        let held: LanguageDocumentHandle;
        try {
            held = super.acquire(uri, languageId, editor);
        } catch (error) {
            editors.splice(editors.indexOf(editor), 1);
            if (editors.length === 0) {
                this.openEditors.delete(uri);
            }
            throw error;
        }
        let released = false;
        return {
            uri,
            service: this.service,
            get ready() {
                return held.ready;
            },
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                editors.splice(editors.indexOf(editor), 1);
                if (editors.length === 0) {
                    this.openEditors.delete(uri);
                }
                held.release();
            }
        };
    }

    override dispose(): void {
        super.dispose();
        this.openEditors.clear();
        this.service.dispose();
        this.status.dispose();
        this.machineProblems.dispose();
    }
}

async function suggestNames(transport: Transport, request: RenameSuggestionsRequest, signal: AbortSignal): Promise<readonly string[]> {
    if (!useSettings.getState().aiOnDeviceHelp || signal.aborted) {
        return [];
    }
    const client = onDeviceClientFor(transport);
    if (!(await client.availability()).available || signal.aborted) {
        return [];
    }
    const result = await client.generate(
        {
            purpose: 'names',
            prompt: namesPrompt({ ...request, language: shikiLanguageOf(request.languageId), uses: [...request.uses] })
        },
        signal
    );
    return result.state === 'done' ? parseNames(result.text, request.name, request.languageId, 3) : [];
}

interface Entry {
    language: ProjectLanguage;
    references: number;
}

const entries = new WeakMap<Transport, Map<string, Entry>>();

export function acquireProjectLanguage(
    transport: Transport,
    projectId: string,
    folder: string,
    files: ProjectFiles | null = null
): { language: ProjectLanguage; release(): void } {
    let projects = entries.get(transport);
    if (projects === undefined) {
        projects = new Map();
        entries.set(transport, projects);
    }
    const key = `${projectId}\0${folder}`;
    let entry = projects.get(key);
    if (entry === undefined) {
        entry = { language: new ProjectLanguage(transport, projectId, folder, files), references: 0 };
        projects.set(key, entry);
    }
    entry.references++;
    const held = entry;
    let released = false;
    return {
        language: held.language,
        release: () => {
            if (!released) {
                released = true;
                if (--held.references === 0) {
                    projects.delete(key);
                    held.language.dispose();
                }
            }
        }
    };
}
