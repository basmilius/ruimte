import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { CodedError, Serializer, SYSTEM_WATCH, settled, writeAtomic, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import {
    BUILT_IN_LIVE_TEMPLATE_KEYS,
    BUILT_IN_POSTFIX_TEMPLATE_KEYS,
    LiveTemplateSchema,
    PostfixTemplateSchema,
    TEMPLATES_VERSION,
    type LiveTemplate,
    type LiveTemplateInput,
    type PersonalTemplates,
    type PostfixTemplate,
    type PostfixTemplateInput,
    type ProjectTemplates,
    type TemplateAddedBy,
    type TemplateConfigurePayload,
    type TemplateConfigureResult,
    type TemplateKind,
    type TemplateListResult,
    type TemplateRemovePayload,
    type TemplateRemoveResult,
    type TemplateSavePayload,
    type TemplateSaveResult
} from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import {
    PROJECT_DIR,
    WATCH_SETTLE_MS,
    closeLoaded,
    readJsonDocument,
    readTextOf,
    tooNewMessage,
    watchDirectories,
    watchOutsideEdits,
    type JsonDocumentParse,
    type JsonDocumentRead
} from '../projects/project-files.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { problemInLiveTemplate, problemInPostfixTemplate } from './template-check.ts';
import {
    EMPTY_TEMPLATES,
    entryRaw,
    parsePersonalTemplates,
    parseProjectTemplates,
    serializeTemplates,
    settingsOf,
    templatesOf,
    type TemplateDocument,
    type TemplateEntry
} from './template-file.ts';

export const PERSONAL_TEMPLATES_FILE = 'editor-templates.json';

const PROJECT_TEMPLATES_FILE = 'templates.json';

type TemplateErrorCode =
    | 'project-not-found'
    | 'rev-conflict'
    | 'templates-too-new'
    | 'templates-invalid'
    | 'template-invalid'
    | 'template-not-found'
    | 'template-key-taken';

export class TemplateError extends CodedError<TemplateErrorCode> {}

/* The templates a save or an agent's add carries, in the shape a client sends them. */
export type TemplateDraft = { kind: 'live'; template: LiveTemplateInput } | { kind: 'postfix'; template: PostfixTemplateInput };

/* A template an agent can see: where it comes from, and its body unless the daemon does not hold it (a built-in one). */
export interface AgentTemplateRow {
    id: string;
    kind: TemplateKind;
    key: string;
    languages: string[];
    source: 'built-in' | 'personal' | 'project';
    description: string | null;
    body: string | null;
}

interface TemplateProjects {
    folderOf(projectId: string): string | null;
    /* The clients that have the project open, which is who may read its templates and who hears a change. */
    holdersOf(projectId: string): string[];
}

/* One file on disk: what it held when this store last read or wrote it, and the revision a write names. */
interface TemplateFile {
    readonly path: string;
    readonly personal: boolean;
    revision: number;
    // The exact text last read or written, so the watcher tells our own write from someone else's.
    text: string;
    document: TemplateDocument;
}

interface Watched {
    watchers: DirectoryWatcher[];
    settle: Settled | null;
}

interface LoadedPersonal extends Watched {
    file: TemplateFile;
}

interface LoadedProject extends Watched {
    projectId: string;
    file: TemplateFile;
}

type Loaded = LoadedPersonal | LoadedProject;

function parserOf(personal: boolean): (text: string) => JsonDocumentParse<TemplateDocument> {
    return personal ? parsePersonalTemplates : parseProjectTemplates;
}

/* A file from a newer Ruimte or one that breaks the schema is refused, never set aside: a later release or a person fixes it. */
async function readTemplateFile(path: string, personal: boolean, setAside: boolean): Promise<JsonDocumentRead<TemplateDocument>> {
    const read = await readJsonDocument(path, parserOf(personal), { setAside });

    if (read.kind === 'too-new') {
        throw new TemplateError('templates-too-new', tooNewMessage('templates file', read.version, TEMPLATES_VERSION));
    }

    if (read.kind === 'invalid') {
        throw new TemplateError('templates-invalid', read.message);
    }

    if (read.kind === 'corrupt') {
        console.warn(`Set aside a templates file that would not parse: ${read.setAside}`);
    }

    return read;
}

function personalSnapshot(file: TemplateFile): PersonalTemplates {
    const { document } = file;

    return {
        revision: file.revision,
        live: templatesOf(document.live),
        postfix: templatesOf(document.postfix),
        disabled: [...document.disabled],
        settings: settingsOf(document.settings)
    };
}

function projectSnapshot(file: TemplateFile): ProjectTemplates {
    return { revision: file.revision, live: templatesOf(file.document.live), postfix: templatesOf(file.document.postfix) };
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}

/* The fields of a template in the order a file lists them; a field it lacks is undefined, so a changed template drops it. */
function fieldsOf(draft: TemplateDraft, id: string, addedBy: TemplateAddedBy | undefined): Record<string, unknown> {
    // A person's save leaves the mark of an agent where it is.
    const mark = addedBy === undefined ? {} : { addedBy };

    if (draft.kind === 'live') {
        const { key, body, description, languages, places } = draft.template;

        return {
            id,
            key,
            body,
            description,
            languages: unique(languages),
            places: places === undefined || places.length === 0 ? undefined : unique(places),
            ...mark
        };
    }

    const { key, body, description, example, languages, expression } = draft.template;

    return { id, key, body, description, example, languages: unique(languages), expression, ...mark };
}

function problemInDraft(draft: TemplateDraft): string | null {
    return draft.kind === 'live' ? problemInLiveTemplate(draft.template) : problemInPostfixTemplate(draft.template);
}

function rowOf(kind: TemplateKind, source: 'personal' | 'project', template: LiveTemplate | PostfixTemplate): AgentTemplateRow {
    return {
        id: template.id,
        kind,
        key: template.key,
        languages: template.languages,
        source,
        description: template.description ?? null,
        body: template.body
    };
}

function sharesLanguage(left: readonly string[], right: readonly string[]): boolean {
    return left.some((language) => right.includes(language));
}

/*
 * The editor's templates: a person's own in `$RUIMTE_HOME/editor-templates.json`, and a project's shared
 * ones in `.ruimte/templates.json`, which a team commits. Every write goes against the revision the
 * client read, and the revision moves on an edit made outside this store as well, so a pull never
 * gets written over. The project file is written only when its text changes. Nothing here runs a
 * template: they are text, and a client expands them.
 */
export class TemplateStore {
    private readonly personalPath: string;
    private readonly projects: TemplateProjects;
    private readonly seams: WatchSeams;
    private readonly now: () => number;
    private readonly sinks = new ClientSinks();
    private readonly writes = new Serializer();
    private readonly loaded = new Map<string, LoadedProject>();
    private personal: LoadedPersonal | null = null;
    // Revisions count up from the start time, so one never repeats after a restart or after a project was let go and read again.
    private clock: number;

    constructor(options: { path: string; projects: TemplateProjects; seams?: WatchSeams; now?: () => number }) {
        this.personalPath = options.path;
        this.projects = options.projects;
        this.seams = options.seams ?? SYSTEM_WATCH;
        this.now = options.now ?? Date.now;
        this.clock = this.now();
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* A person's templates and, for a project this client holds, the project's. */
    list(clientId: string, projectId: string | undefined): Promise<TemplateListResult> {
        return this.writes.run(async () => {
            const personal = await this.loadPersonal();
            const personalPart = personalSnapshot(personal.file);

            if (projectId === undefined || !this.holds(clientId, projectId)) {
                return { personal: personalPart, project: null };
            }

            try {
                return { personal: personalPart, project: projectSnapshot((await this.loadProject(projectId)).file) };
            } catch (e) {
                // A project file from a newer Ruimte must not cost a person their own templates; writes to it stay refused.
                if (e instanceof TemplateError && e.code === 'templates-too-new') {
                    return { personal: personalPart, project: null, projectTooNew: true };
                }

                if (e instanceof TemplateError && e.code === 'templates-invalid') {
                    return { personal: personalPart, project: null, projectInvalid: true };
                }

                throw e;
            }
        });
    }

    /* Adds or changes one template; one with an id that is not there yet is added under that id. */
    save(clientId: string, payload: TemplateSavePayload): Promise<TemplateSaveResult> {
        return this.writes.run(async () => {
            const loaded = await this.scopeOf(clientId, payload.scope, payload.projectId);
            await this.writable(loaded, payload.revision);

            return this.put(loaded, payload, undefined);
        });
    }

    remove(clientId: string, payload: TemplateRemovePayload): Promise<TemplateRemoveResult> {
        return this.writes.run(async () => {
            const loaded = await this.scopeOf(clientId, payload.scope, payload.projectId);
            await this.writable(loaded, payload.revision);
            const { document } = loaded.file;
            const entries: readonly TemplateEntry<LiveTemplate | PostfixTemplate>[] = document[payload.kind];

            if (!entries.some((entry) => entry.template?.id === payload.id)) {
                throw new TemplateError('template-not-found', `There is no ${payload.kind} template ${payload.id}`);
            }

            await this.commit(loaded, { ...document, [payload.kind]: entries.filter((entry) => entry.template?.id !== payload.id) });

            return { revision: loaded.file.revision };
        });
    }

    /* Which built-in templates are off and the editor's switches; both are a person's, never a project's. */
    configure(payload: TemplateConfigurePayload): Promise<TemplateConfigureResult> {
        return this.writes.run(async () => {
            const loaded = await this.loadPersonal();
            await this.writable(loaded, payload.revision);
            const { document } = loaded.file;
            const named = Object.entries(payload.settings ?? {}).filter(([, value]) => value !== undefined);

            await this.commit(loaded, {
                ...document,
                disabled: payload.disabled === undefined ? document.disabled : unique(payload.disabled),
                settings: { ...document.settings, ...Object.fromEntries(named) }
            });

            return { revision: loaded.file.revision, disabled: [...loaded.file.document.disabled], settings: settingsOf(loaded.file.document.settings) };
        });
    }

    /* Every template in reach of an agent of a project: the enabled built-in ones, the person's own and the project's. */
    listForAgent(projectId: string): Promise<AgentTemplateRow[]> {
        return this.writes.run(async () => this.reachOf(await this.fresh(await this.loadPersonal()), projectId));
    }

    /*
     * Adds a template for an agent to the person's own set, marked as the agent's. It never changes or removes
     * one, and refuses a key that an enabled template of the same kind and a shared language already has,
     * among the built-in ones, the person's and the project's, so an agent never shadows what a person relies on.
     */
    addByAgent(draft: TemplateDraft, chatId: string, projectId: string): Promise<TemplateSaveResult> {
        return this.writes.run(async () => {
            const loaded = await this.fresh(await this.loadPersonal());
            this.refuseAgentAdd(draft, await this.reachOf(loaded, projectId));

            return this.put(loaded, draft, { kind: 'agent', chatId, at: this.now() });
        });
    }

    /* The checks of `addByAgent` without the write, for a dry run. */
    checkAgentAdd(draft: TemplateDraft, projectId: string): Promise<void> {
        return this.writes.run(async () => {
            this.refuseAgentAdd(draft, await this.reachOf(await this.fresh(await this.loadPersonal()), projectId));
        });
    }

    /* Stops watching a project nobody holds any more; the next read loads it again. */
    closeProject(projectId: string): void {
        closeLoaded(this.loaded, projectId);
    }

    closeAll(): void {
        for (const projectId of [...this.loaded.keys()]) {
            this.closeProject(projectId);
        }

        for (const watcher of this.personal?.watchers ?? []) {
            watcher.close();
        }

        this.personal?.settle?.stop();
        this.personal = null;
    }

    private async reachOf(personal: LoadedPersonal, projectId: string): Promise<AgentTemplateRow[]> {
        const { document } = personal.file;
        const project = await this.projectDocumentOf(projectId);
        const builtIn = (kind: TemplateKind): AgentTemplateRow[] =>
            (kind === 'live' ? BUILT_IN_LIVE_TEMPLATE_KEYS : BUILT_IN_POSTFIX_TEMPLATE_KEYS)
                .filter((template) => !document.disabled.includes(template.id))
                .map((template) => ({ ...template, kind, languages: [...template.languages], source: 'built-in', description: null, body: null }));

        return (['live', 'postfix'] as const).flatMap((kind) => [
            ...builtIn(kind),
            ...templatesOf<LiveTemplate | PostfixTemplate>(document[kind]).map((template) => rowOf(kind, 'personal', template)),
            ...templatesOf<LiveTemplate | PostfixTemplate>(project?.[kind] ?? []).map((template) => rowOf(kind, 'project', template))
        ]);
    }

    /* The project's file as it stands on disk now; null when it is from a newer Ruimte or breaks the schema, which an agent cannot read around. */
    private async projectDocumentOf(projectId: string): Promise<TemplateDocument | null> {
        try {
            const loaded = await this.loadProject(projectId);
            await this.takeOutsideEdits(loaded);

            return loaded.file.document;
        } catch (e) {
            if (e instanceof TemplateError && (e.code === 'templates-too-new' || e.code === 'templates-invalid')) {
                return null;
            }

            throw e;
        }
    }

    private refuseAgentAdd(draft: TemplateDraft, reach: readonly AgentTemplateRow[]): void {
        if (draft.template.id !== undefined) {
            throw new TemplateError('template-invalid', 'An agent adds new templates and changes none');
        }

        const problem = problemInDraft(draft);

        if (problem !== null) {
            throw new TemplateError('template-invalid', problem);
        }

        const taken = reach.find((row) => row.kind === draft.kind && row.key === draft.template.key && sharesLanguage(row.languages, draft.template.languages));

        if (taken !== undefined) {
            throw new TemplateError(
                'template-key-taken',
                `A ${draft.kind} template with the key ${draft.template.key} already exists for one of those languages (${taken.source})`
            );
        }
    }

    private holds(clientId: string, projectId: string): boolean {
        return this.projects.folderOf(projectId) !== null && this.projects.holdersOf(projectId).includes(clientId);
    }

    private nextRevision(): number {
        this.clock += 1;

        return this.clock;
    }

    private async scopeOf(clientId: string, scope: 'personal' | 'project', projectId: string | undefined): Promise<Loaded> {
        if (scope === 'personal') {
            return this.loadPersonal();
        }

        if (projectId === undefined) {
            throw new TemplateError('project-not-found', 'A project template names its project');
        }

        if (!this.holds(clientId, projectId)) {
            throw new TemplateError('project-not-found', `Project ${projectId} is not open on this client`);
        }

        return this.loadProject(projectId);
    }

    /* Refuses a write based on an older revision, and one that finds the file changed on disk since it was read. */
    private async writable(loaded: Loaded, revision: number): Promise<void> {
        if (revision !== loaded.file.revision) {
            throw new TemplateError('rev-conflict', `The templates are at revision ${loaded.file.revision}, the save was based on ${revision}`);
        }

        if (await this.takeOutsideEdits(loaded)) {
            throw new TemplateError('rev-conflict', `The templates changed on disk; they are now at revision ${loaded.file.revision}`);
        }
    }

    /* Takes in a write the watcher has not reported yet, so a check sees the file as it is. */
    private async fresh(loaded: LoadedPersonal): Promise<LoadedPersonal> {
        await this.takeOutsideEdits(loaded);

        return loaded;
    }

    private async put(loaded: Loaded, draft: TemplateDraft, addedBy: TemplateAddedBy | undefined): Promise<TemplateSaveResult> {
        const problem = problemInDraft(draft);

        if (problem !== null) {
            throw new TemplateError('template-invalid', problem);
        }

        const { document } = loaded.file;
        const id = draft.template.id ?? randomUUID();
        const entries: readonly TemplateEntry<LiveTemplate | PostfixTemplate>[] = document[draft.kind];
        const index = entries.findIndex((entry) => entry.template?.id === id);
        const raw = entryRaw(entries[index]?.raw, fieldsOf(draft, id, addedBy));
        const saved =
            draft.kind === 'live'
                ? ({ kind: 'live', template: LiveTemplateSchema.parse(raw) } as const)
                : ({ kind: 'postfix', template: PostfixTemplateSchema.parse(raw) } as const);
        const entry = { raw, template: saved.template };
        const next = index === -1 ? [...entries, entry] : entries.map((candidate, at) => (at === index ? entry : candidate));

        await this.commit(loaded, { ...document, [draft.kind]: next });

        return { revision: loaded.file.revision, ...saved };
    }

    /* Writes the document when its text differs from the file's, moves the revision and tells the clients. */
    private async commit(loaded: Loaded, document: TemplateDocument): Promise<void> {
        const { file } = loaded;
        const text = serializeTemplates(document, file.personal);
        const nothingToShare = !file.personal && file.text === '' && document.live.length === 0 && document.postfix.length === 0;

        if (text === file.text || nothingToShare) {
            return;
        }

        await mkdir(dirname(file.path), { recursive: true });
        await writeAtomic(file.path, text, file.personal ? 0o600 : 0o644, { durable: true });
        file.text = text;
        file.document = document;
        file.revision = this.nextRevision();
        this.emitChanged(loaded);
    }

    private emitChanged(loaded: Loaded): void {
        if ('projectId' in loaded) {
            const event: SessionEvent = {
                event: 'template.changed',
                payload: { scope: 'project', projectId: loaded.projectId, snapshot: projectSnapshot(loaded.file) }
            };

            for (const clientId of this.projects.holdersOf(loaded.projectId)) {
                this.sinks.to(clientId, event);
            }

            return;
        }

        this.sinks.emit({ event: 'template.changed', payload: { scope: 'personal', snapshot: personalSnapshot(loaded.file) } });
    }

    /* Takes in an edit made outside this store; true when there was one. A file that does not read yet is left for its next event. */
    private async takeOutsideEdits(loaded: Loaded): Promise<boolean> {
        const { file } = loaded;
        const read = await readTemplateFile(file.path, file.personal, false);
        const text = readTextOf(read);

        if (text === null || text === file.text) {
            return false;
        }

        file.text = text;
        file.document = read.kind === 'ok' ? read.document : EMPTY_TEMPLATES;
        file.revision = this.nextRevision();
        this.emitChanged(loaded);

        return true;
    }

    private async readFile(path: string, personal: boolean): Promise<TemplateFile> {
        const read = await readTemplateFile(path, personal, true);

        return {
            path,
            personal,
            revision: this.nextRevision(),
            text: read.kind === 'ok' ? read.text : '',
            document: read.kind === 'ok' ? read.document : EMPTY_TEMPLATES
        };
    }

    private async loadPersonal(): Promise<LoadedPersonal> {
        if (this.personal !== null) {
            return this.personal;
        }

        const loaded: LoadedPersonal = { file: await this.readFile(this.personalPath, true), watchers: [], settle: null };
        const settle = settled(this.seams, WATCH_SETTLE_MS, () =>
            this.writes
                .run(async () => {
                    if (this.personal === loaded) {
                        await this.takeOutsideEdits(loaded);
                    }
                })
                .catch((e: unknown) => console.warn('An outside edit to the templates of this person could not be taken in:', e))
        );

        loaded.settle = settle;
        loaded.watchers = watchDirectories(this.seams, [dirname(this.personalPath)], (filename) => {
            if (filename === null || filename === basename(this.personalPath)) {
                settle.nudge();
            }
        });
        this.personal = loaded;

        return loaded;
    }

    private async loadProject(projectId: string): Promise<LoadedProject> {
        const known = this.loaded.get(projectId);

        if (known) {
            return known;
        }

        const folder = this.projects.folderOf(projectId);

        if (folder === null) {
            throw new TemplateError('project-not-found', `No project ${projectId} on this machine`);
        }

        const loaded: LoadedProject = {
            projectId,
            file: await this.readFile(join(folder, PROJECT_DIR, PROJECT_TEMPLATES_FILE), false),
            watchers: [],
            settle: null
        };
        const { settle, watchers } = watchOutsideEdits({
            seams: this.seams,
            writes: this.writes,
            folder,
            file: PROJECT_TEMPLATES_FILE,
            what: 'templates',
            current: () => this.loaded.get(projectId) === loaded,
            take: () => this.takeOutsideEdits(loaded)
        });

        loaded.settle = settle;
        loaded.watchers = watchers;
        this.loaded.set(projectId, loaded);

        return loaded;
    }
}
