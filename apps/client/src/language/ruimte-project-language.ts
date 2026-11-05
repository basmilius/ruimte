import type { Editor } from '@adecore/editor';
import {
    ClipboardHistory,
    lspLanguageIdOf,
    ProjectLanguage as SharedProjectLanguage,
    shikiLanguageOf,
    shikiLanguageOfPath,
    TemplateRegistry,
    type AcquireOptions,
    type LanguageDocumentHandle,
    type ProjectFiles,
    type RenameSuggestionsRequest
} from '@adecore/editor-react';
import { fileUriToPath, pathToFileUri, type Diagnostic } from '@adecore/lsp';
import i18next from 'i18next';
import { isApplePlatform, openInSystemBrowser } from '@/desktop/bridge';
import { editorAssistClientFor } from '@/editor-assist/client';
import { parseNames } from '@/editor-assist/names-model';
import { namesPrompt } from '@/editor-assist/prompts';
import { RUIMTE_EDITOR_KEYMAP } from '@/shell/editor-keymap';
import { openFileLink } from '@/shell/panels/file-links';
import { isPathBelow } from '@/shell/panels/files-tree';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import type { Transport } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { readPanelHeight, writePanelHeight } from './panel-height';
import type { DraftProjectFiles } from './project-files';
import { createSnippetTransformWorker } from './snippet-transform-worker';
import { LanguageStatusTracker } from './status';
import { draftOfSelection } from './template-draft';
import { TemplatesTracker } from './templates';
import { abortable, WireLanguageService, type WireLanguageServiceOptions } from './wire-service';

export class ProjectLanguage extends SharedProjectLanguage {
    declare readonly service: WireLanguageService;
    readonly transport: Transport;
    readonly status: LanguageStatusTracker;
    // Feeds the registry of `templates` with what the machine holds, and is what a settings tab reads.
    readonly templateSync: TemplatesTracker;
    private readonly projectId: string;
    // The wire resynchronizes from the sending editor without starting a second document owner.
    private readonly editorsByUri: Map<string, Editor[]>;
    private readonly stopDrafts: () => void;

    constructor(
        transport: Transport,
        projectId: string,
        folder: string,
        files: ProjectFiles | DraftProjectFiles | null = null,
        openFile: (folder: string, path: string, line: number) => void = (root, path, line) => void openFileLink(root, { path, line, directory: false })
    ) {
        const editorsByUri = new Map<string, Editor[]>();
        let applyEdit: WireLanguageServiceOptions['applyEdit'];
        const service = new WireLanguageService({
            transport,
            projectId,
            folder,
            textOf: (uri) => editorsByUri.get(uri)?.[0]?.getText(),
            applyEdit: (params) => applyEdit?.(params) ?? Promise.resolve({ applied: false, failureReason: 'The project language is not ready' })
        });
        const panelBodyHeight = readPanelHeight();
        const templates = new TemplateRegistry();
        // The hooks of the host are called long after the constructor, so they may read what is made below.
        let templateSync: TemplatesTracker | undefined;
        super(service, {
            templates,
            openTemplateSettings: () => useUi.getState().setSettings({ open: true, section: 'editor', target: 'editor.templates.live' }),
            saveAsLiveTemplate: (draft) => {
                // A machine that does not know templates has nowhere to keep one.
                if (templateSync !== undefined && templateSync.getSnapshot() !== null) {
                    useUi.getState().setTemplateRequest({ tracker: templateSync, draft: draftOfSelection(draft) });
                }
            },
            i18n: i18next,
            folder,
            ...(files === null ? {} : { files }),
            apple: isApplePlatform(),
            keymap: RUIMTE_EDITOR_KEYMAP,
            // Per project and for this session only: what Paste from History lists is never written to disk.
            clipboard: new ClipboardHistory({ limit: 100 }),
            snippetTransformWorker: createSnippetTransformWorker,
            ...(panelBodyHeight === undefined ? {} : { panelBodyHeight }),
            onPanelResize: writePanelHeight,
            // Machine reports include documents held by other clients, which the shared editor does not own.
            problemSource: (listener) =>
                transport.on('language.diagnostics', (event) => {
                    if (event.projectId === projectId) {
                        listener({ path: event.path, server: event.server, diagnostics: event.diagnostics as Diagnostic[] });
                    }
                }),
            openPlace: (place) => {
                const path = fileUriToPath(place.uri);
                if (path !== null) {
                    openFile(folder, path, place.position.line + 1);
                }
            },
            pathOfUri: (uri) => service.pathOfLocation(uri),
            serverNames: (uri) => service.serversOf(uri),
            // A link a person Mod+clicks; a server's own request to show an address never reaches this (see `server-prompts.ts`).
            openExternal: openInSystemBrowser,
            notify: (notification) => useToasts.getState().show(notification),
            suggestNames: (request, signal) => suggestNames(transport, request, signal)
        });
        this.editorsByUri = editorsByUri;
        applyEdit = (params) => this.applyWorkspaceEdit(params.edit);
        this.transport = transport;
        this.projectId = projectId;
        this.status = new LanguageStatusTracker(transport, projectId);
        void this.status.refresh().catch(() => undefined);
        this.templateSync = templateSync = new TemplatesTracker(transport, projectId, templates);
        void this.templateSync.refresh().catch(() => undefined);
        this.stopDrafts = files !== null && 'watchUnsaved' in files ? holdUnsavedTexts(service, folder, files) : () => undefined;
    }

    override acquire(uri: string, languageId: string, editor: Editor, options?: AcquireOptions): LanguageDocumentHandle {
        const editors = this.editorsByUri.get(uri) ?? [];
        editors.push(editor);
        this.editorsByUri.set(uri, editors);
        const forget = (): void => {
            editors.splice(editors.indexOf(editor), 1);
            if (editors.length === 0) {
                this.editorsByUri.delete(uri);
            }
        };
        let held: LanguageDocumentHandle;
        try {
            held = super.acquire(uri, languageId, editor, options);
        } catch (error) {
            forget();
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
                forget();
                held.release();
            }
        };
    }

    /*
     * Asks the machine for the problems of every file its servers know. The reports come in as `language.diagnostics`
     * events, through `problemSource`, so nothing is read from the answer but whether a server took part.
     */
    override async pullWorkspaceProblems(_uri: string, options: { readonly signal?: AbortSignal } = {}): Promise<boolean> {
        if (!machineAnswers(this.transport.connection, 'language.workspaceProblems')) {
            return false;
        }

        const request = this.transport.request('language.workspaceProblems', { projectId: this.projectId });
        const { servers } = options.signal === undefined ? await request : await abortable(request, options.signal);

        return servers.length > 0;
    }

    override dispose(): void {
        this.stopDrafts();
        super.dispose();
        this.editorsByUri.clear();
        this.service.dispose();
        this.status.dispose();
        this.templateSync.dispose();
    }
}

/* The servers read the unsaved text of every file of the project that a server serves, whether an editor shows it or not. */
function holdUnsavedTexts(service: WireLanguageService, folder: string, files: DraftProjectFiles): () => void {
    let held = new Set<string>();
    return files.watchUnsaved((texts) => {
        const holding = new Set<string>();
        for (const [path, text] of texts) {
            const languageId = isPathBelow(folder, path) ? lspLanguageIdOf(shikiLanguageOfPath(path)) : null;
            if (languageId !== null) {
                const uri = pathToFileUri(path);
                holding.add(uri);
                service.holdText(uri, languageId, text);
            }
        }
        for (const uri of held) {
            if (!holding.has(uri)) {
                service.releaseText(uri);
            }
        }
        held = holding;
    });
}

async function suggestNames(transport: Transport, request: RenameSuggestionsRequest, signal: AbortSignal): Promise<readonly string[]> {
    if (!useSettings.getState().aiCodeHelp || signal.aborted) {
        return [];
    }
    const client = editorAssistClientFor(transport);
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

/* Drops the edit locations in a file or folder that was deleted, for the project language the machine holds open. */
export function forgetDeletedEdits(transport: Transport, projectId: string, folder: string, path: string): void {
    const uri = pathToFileUri(path);
    entries
        .get(transport)
        ?.get(`${projectId}\0${folder}`)
        ?.language.edits.forget((edited) => edited === uri || edited.startsWith(`${uri}/`));
}
