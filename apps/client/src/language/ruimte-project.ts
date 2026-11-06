import {
    ClipboardHistory,
    ProjectLanguage as SharedProjectLanguage,
    shikiLanguageOf,
    shikiLanguageOfPath,
    TemplateRegistry,
    type ProjectFiles,
    type RenameSuggestionsRequest
} from '@adecore/editor-react';
import { fileUriToPath, lspLanguageIdOf, pathToFileUri, type Diagnostic } from '@adecore/lsp';
import { isApplePlatform } from '@adecore/ui';
import { isPathBelow, namesPrompt, parseNames } from '@ruimte/contracts';
import i18next from 'i18next';
import { openInSystemBrowser } from '@/desktop/bridge';
import { editorAssistClientFor } from '@/editor-assist/client';
import { useTemplateRequest } from '@/language/template-request';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { RUIMTE_EDITOR_KEYMAP } from '@/surface/editor-keymap';
import { openFileLink } from '@/surface/panels/file-links';
import type { Transport } from '@/transport-api/transport';
import { fireAndForget } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { readPanelHeight, writePanelHeight } from './panel-height';
import type { DraftProjectFiles } from './project-files';
import { createSnippetTransformWorker } from './snippet-transform-worker';
import { LanguageStatusTracker } from './status';
import { draftOfSelection } from './template-draft';
import { TemplatesTracker } from './templates';
import { abortable, WireLanguageService } from './wire-service';

/*
 * What Ruimte keeps of a project's language: the shared project over a service that talks to the machine, with the
 * trackers a settings tab and the status item read.
 */
export class RuimteProject {
    readonly language: SharedProjectLanguage<WireLanguageService>;
    readonly transport: Transport;
    readonly status: LanguageStatusTracker;
    // Feeds the registry of `templates` with what the machine holds, and is what a settings tab reads.
    readonly templateSync: TemplatesTracker;
    private readonly stopDrafts: () => void;

    constructor(
        transport: Transport,
        projectId: string,
        folder: string,
        files: ProjectFiles | DraftProjectFiles | null = null,
        openFile: (folder: string, path: string, line: number) => void = (root, path, line) => void openFileLink(root, { path, line, directory: false })
    ) {
        const panelBodyHeight = readPanelHeight();
        const templates = new TemplateRegistry();
        this.transport = transport;
        this.language = new SharedProjectLanguage(
            (project) =>
                new WireLanguageService({
                    transport,
                    projectId,
                    folder,
                    textOf: (uri) => project.openTextOf(uri),
                    applyEdit: (params) => project.applyWorkspaceEdit(params.edit)
                }),
            {
                templates,
                openTemplateSettings: () => useUi.getState().setSettings({ open: true, section: 'editor', target: 'editor.templates.live' }),
                saveAsLiveTemplate: (draft) => {
                    // A machine that does not know templates has nowhere to keep one.
                    if (this.templateSync.getSnapshot() !== null) {
                        useTemplateRequest.getState().setRequest({ tracker: this.templateSync, draft: draftOfSelection(draft) });
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
                /*
                 * Asks the machine for the problems of every file its servers know. The reports come in as `language.diagnostics`
                 * events, through `problemSource`, so nothing is read from the answer but whether a server took part.
                 */
                pullWorkspaceProblems: async (_uri, options) => {
                    if (!machineAnswers(transport.connection, 'language.workspaceProblems')) {
                        return false;
                    }

                    const request = transport.request('language.workspaceProblems', { projectId });
                    const { servers } = options.signal === undefined ? await request : await abortable(request, options.signal);

                    return servers.length > 0;
                },
                openPlace: (place) => {
                    const path = fileUriToPath(place.uri);
                    if (path !== null) {
                        openFile(folder, path, place.position.line + 1);
                    }
                },
                pathOfUri: (uri) => this.language.service.pathOfLocation(uri),
                serverNames: (uri) => this.language.service.serversOf(uri),
                // A link a person Mod+clicks; a server's own request to show an address never reaches this (see `server-prompts.ts`).
                openExternal: openInSystemBrowser,
                notify: (notification) => useToasts.getState().show(notification),
                suggestNames: (request, signal) => suggestNames(transport, request, signal)
            }
        );
        this.status = new LanguageStatusTracker(transport, projectId);
        void fireAndForget('status.refresh', this.status.refresh());
        this.templateSync = new TemplatesTracker(transport, projectId, templates);
        void fireAndForget('templateSync.refresh', this.templateSync.refresh());
        this.stopDrafts = files !== null && 'watchUnsaved' in files ? holdUnsavedTexts(this.language.service, folder, files) : () => undefined;
    }

    dispose(): void {
        this.stopDrafts();
        this.language.dispose();
        this.language.service.dispose();
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
    project: RuimteProject;
    references: number;
}

const entries = new WeakMap<Transport, Map<string, Entry>>();

export function acquireProject(
    transport: Transport,
    projectId: string,
    folder: string,
    files: ProjectFiles | null = null
): { project: RuimteProject; release(): void } {
    let projects = entries.get(transport);
    if (projects === undefined) {
        projects = new Map();
        entries.set(transport, projects);
    }
    const key = `${projectId}\0${folder}`;
    let entry = projects.get(key);
    if (entry === undefined) {
        entry = { project: new RuimteProject(transport, projectId, folder, files), references: 0 };
        projects.set(key, entry);
    }
    entry.references++;
    const held = entry;
    let released = false;
    return {
        project: held.project,
        release: () => {
            if (!released) {
                released = true;
                if (--held.references === 0) {
                    projects.delete(key);
                    held.project.dispose();
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
        ?.project.language.edits.forget((edited) => edited === uri || edited.startsWith(`${uri}/`));
}
