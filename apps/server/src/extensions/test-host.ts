/*
 * `createTestHost` of `@ruimte/extension/testing`: a client of Ruimte in a test's own process. It keeps a project in
 * memory, records what an extension defines and does, and decides what the client host decides with the same shared
 * rules (`@ruimte/contracts/extension-client`): the permission of each call, the places of slots, a lazy component, a
 * shortcut and a path in the project. What it cannot know, the machine and the person, a test scripts under `answers`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    EXTENSION_SLOT_NAMES,
    extensionCallPermission,
    extensionProjectPath,
    isExtensionSlotName,
    missingPermissionMessage
} from '@ruimte/contracts/extension-client';
import type * as PublicClient from '../../../../packages/extension/client';
import type * as PublicTesting from '../../../../packages/extension/testing';
import { TestRefusal } from './test-server.ts';

type Result<Value> = PublicClient.Result<Value>;
type ErrorCode = PublicClient.ExtensionErrorCode;
type NodeInfo = PublicClient.NodeInfo;
type Json = PublicClient.Json;
type Options = PublicTesting.TestHostOptions;
type Answers = PublicTesting.TestHostAnswers;
type Listener = (payload: never) => void;

/* Ends a call with a Result of this code, as the client host's own refusal does. */
export class Refused extends Error {
    readonly code: ErrorCode;

    constructor(code: ErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

export interface HostNode {
    id: string;
    kind: string;
    title: string;
    text: string;
    color: string | null;
    bounds: { x: number; y: number; width: number; height: number };
    viewId: string;
    groupId: string | null;
    agent?: Partial<PublicClient.AgentInfo>;
    path?: string;
    url?: string;
    extension?: { id: string; type: string };
    data?: unknown;
    dataVersion?: number;
}

/* Something an extension put in a slot, as the client host keeps it. */
export interface Entry {
    id: string;
    kind: 'action' | 'menu' | 'widget';
    title: string;
    icon?: string;
    slots: Record<string, unknown>;
    run?: (context: object) => unknown;
    items?: unknown;
}

const NOTE = { width: 320, height: 200 };
const BESIDE_GAP = 240;
const NODE_PLACES = ['node', 'nodes', 'from', 'to'];

/* As it crosses to the machine and back. */
export function wire<Value>(value: unknown): Value {
    return value === undefined ? (undefined as Value) : (JSON.parse(JSON.stringify(value)) as Value);
}

function manifestIn(folder: string): { id?: string; name?: string; permissions?: Record<string, string> } {
    try {
        return JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as { id?: string; name?: string; permissions?: Record<string, string> };
    } catch {
        return {};
    }
}

function wordsIn(folder: string, language: string): Record<string, string> {
    const read = (name: string): Record<string, string> => {
        try {
            return JSON.parse(readFileSync(join(folder, 'locales', `${name}.json`), 'utf8')) as Record<string, string>;
        } catch {
            return {};
        }
    };

    return { ...read('en'), ...read(language) };
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/* The client host of one test, with what it holds and what it saw. */
export class TestHost {
    readonly id: string;
    readonly name: string;
    readonly folder: string;
    readonly permissions: ReadonlySet<string>;
    readonly answers: Answers;
    readonly language: string;
    readonly theme: 'light' | 'dark';
    readonly machineId: string;
    readonly project: { id: string; name: string; folder: string | null } | null;
    readonly views: { id: string; kind: string; name: string }[];
    readonly nodes = new Map<string, HostNode>();
    readonly edges: { from: string; to: string }[] = [];
    readonly createdIds: string[] = [];
    readonly notes: string[] = [];
    readonly revealed: string[] = [];
    readonly definitions: { kind: string; definition: PublicTesting.TestDefinition }[] = [];
    readonly entries: Entry[] = [];
    readonly entryOf = new WeakMap<object, Entry>();
    readonly notifications: PublicTesting.TestHost['notifications'] = [];
    readonly dialogs: PublicTesting.TestHost['dialogs'] = [];
    readonly opened: PublicTesting.TestHost['opened'] = [];
    readonly panels: PublicTesting.TestHost['panels'] = {};
    readonly copied: string[] = [];
    readonly calls: PublicTesting.TestCall[] = [];
    readonly logs: string[] = [];
    readonly storage: { computer: Record<string, Json>; project: Record<string, Json>; machine: Record<string, Json> };
    readonly settings: Record<string, boolean | string>;
    readonly words: Record<string, string>;
    readonly serverCache = new Map<string, Promise<Result<unknown>>>();
    readonly runs: { actionId: string | null; nodeIds: readonly string[] }[] = [];

    activeViewId: string | null;
    selection: string[];

    private readonly listeners = new Map<string, Set<Listener>>();
    private readonly changes = new Set<() => void>();
    private version = 0;
    private nextId = 1;

    constructor(options: Options, folder: string) {
        const manifest = { ...manifestIn(folder), ...options.manifest };
        const project =
            options.project === null
                ? null
                : {
                      id: options.project?.id ?? 'test-project',
                      name: options.project?.name ?? 'Test',
                      folder: options.project?.folder === undefined ? '/test/project' : options.project.folder
                  };

        this.id = manifest.id ?? 'test.extension';
        this.name = manifest.name ?? this.id;
        this.folder = folder;
        this.permissions = new Set(Object.keys(manifest.permissions ?? {}));
        this.answers = options.answers ?? {};
        this.language = options.language ?? 'en';
        this.theme = options.theme ?? 'dark';
        this.machineId = options.machine?.id ?? 'local';
        this.project = project;
        this.views =
            project === null
                ? []
                : (options.project?.views ?? [{ id: 'test-view', kind: 'canvas', name: 'Canvas' }]).map((view) => ({
                      id: view.id,
                      kind: view.kind ?? 'canvas',
                      name: view.name ?? ''
                  }));
        this.activeViewId = this.views[0]?.id ?? null;
        this.storage = {
            computer: wire(options.storage?.computer ?? {}),
            project: wire(options.storage?.project ?? {}),
            machine: wire(options.storage?.machine ?? {})
        };
        this.settings = { ...options.settings };
        this.words = wordsIn(folder, this.language);

        for (const node of options.project?.nodes ?? []) {
            this.nodes.set(node.id, {
                id: node.id,
                kind: node.extension === undefined ? (node.kind ?? 'note') : 'extension',
                title: node.title ?? '',
                text: node.text ?? '',
                color: node.color ?? null,
                bounds: node.bounds ?? { ...NOTE, x: 0, y: 0 },
                viewId: node.view ?? this.activeViewId ?? '',
                groupId: null,
                ...(node.agent === undefined ? {} : { agent: node.agent }),
                ...(node.path === undefined ? {} : { path: node.path }),
                ...(node.url === undefined ? {} : { url: node.url }),
                ...(node.extension === undefined ? {} : { extension: { id: this.id, type: node.extension.type }, data: wire(node.extension.data ?? {}) }),
                ...(node.extension?.dataVersion === undefined ? {} : { dataVersion: node.extension.dataVersion })
            });

            for (const to of node.linkedTo ?? []) {
                this.addEdge(node.id, to);
            }
        }

        this.selection = [...(options.selection ?? [])];
    }

    subscribe(listener: () => void): () => void {
        this.changes.add(listener);

        return () => {
            this.changes.delete(listener);
        };
    }

    snapshot(): number {
        return this.version;
    }

    changed(): void {
        this.version += 1;

        for (const listener of [...this.changes]) {
            listener();
        }
    }

    listen(name: string, listener: Listener): () => void {
        const group = this.listeners.get(name) ?? new Set();

        group.add(listener);
        this.listeners.set(name, group);

        return () => {
            group.delete(listener);
        };
    }

    deliver(name: string, payload: unknown): void {
        for (const listener of [...(this.listeners.get(name) ?? [])]) {
            (listener as (event: unknown) => void)(payload);
        }
    }

    record(kind: string, definition: object): void {
        this.definitions.push({ kind, definition: definition as PublicTesting.TestDefinition });
    }

    addEntry(definition: object, entry: Entry): void {
        const at = this.entries.findIndex((each) => each.id === entry.id);

        if (at >= 0) {
            this.entries.splice(at, 1);
        }

        this.entries.push(entry);
        this.entryOf.set(definition, entry);
    }

    /* The definition of this kind and id, or a throw that lists what there is. */
    defined(kind: string, id: string): PublicTesting.TestDefinition {
        const ofKind = this.definitions.filter((each) => each.kind === kind);
        const found = ofKind.find((each) => (each.definition as { id?: string }).id === id);

        if (found === undefined) {
            const ids = ofKind.map((each) => (each.definition as { id?: string }).id);

            throw new Error(`No ${kind} ${id}. ${ids.length === 0 ? `The extension defined no ${kind}` : `There is ${ids.join(', ')}`}`);
        }

        return found.definition;
    }

    /* Why a call is refused before it starts, as the client host asks it first. */
    permitCall(what: string): void {
        const permission = extensionCallPermission(what);

        if (permission !== null) {
            this.permit(permission);
        }
    }

    permit(permission: string): void {
        if (!this.permissions.has(permission)) {
            throw new Refused('permission-denied', missingPermissionMessage(this.name, permission));
        }
    }

    hookPermission(hook: 'useAgents' | 'useUsageLimits'): void {
        const permission = extensionCallPermission(hook);

        if (permission !== null && !this.permissions.has(permission)) {
            throw new Error(missingPermissionMessage(this.name, permission));
        }
    }

    private refusalOf(what: string, args: unknown[], e: unknown): Result<never> {
        if (e instanceof TypeError) {
            throw e;
        }

        const error =
            e instanceof Refused || e instanceof TestRefusal ? { code: e.code, message: e.message } : { code: 'failed' as const, message: errorText(e) };

        this.logs.push(`${what}: ${error.code}: ${error.message}`);
        this.calls.push({ method: what, args, result: { ok: false, error } });

        return { ok: false, error };
    }

    attempt<Value>(what: string, args: unknown[], run: () => Value): Result<Value> {
        try {
            this.permitCall(what);

            const value = run();

            this.calls.push({ method: what, args, result: { ok: true, value } });

            return { ok: true, value };
        } catch (e) {
            return this.refusalOf(what, args, e);
        }
    }

    async settle<Value>(what: string, args: unknown[], run: () => Value | Promise<Value>): Promise<Result<Value>> {
        try {
            this.permitCall(what);

            const value = await run();

            this.calls.push({ method: what, args, result: { ok: true, value } });

            return { ok: true, value };
        } catch (e) {
            return this.refusalOf(what, args, e);
        }
    }

    /* What a test scripted for a call that asks the machine, or `fallback`, or `unavailable`. */
    async scripted<Value>(path: string, args: unknown[], fallback?: () => Value): Promise<Value> {
        const answer = (this.answers as Record<string, unknown>)[path];

        if (typeof answer === 'function') {
            return wire<Value>(await (answer as (...values: unknown[]) => unknown)(...wire<unknown[]>(args)));
        }

        if (fallback !== undefined) {
            return fallback();
        }

        throw new Refused('unavailable', `Nothing answers ${path} in this test. Give it under answers`);
    }

    projectId(): string {
        if (this.project === null) {
            throw new Refused('no-project', 'This needs an open project');
        }

        return this.project.id;
    }

    inProject(path: string): string {
        const folder = this.project?.folder;

        if (folder === null || folder === undefined) {
            throw new Refused('no-project', 'This needs a project with a folder');
        }

        const full = extensionProjectPath(folder, path);

        if (full === null) {
            throw new Refused('outside-project', `${path} is outside the project folder`);
        }

        return full;
    }

    /* The view in front, if it is a canvas a node can go on. */
    canvasInFront(): string {
        const view = this.views.find((each) => each.id === this.activeViewId);

        if (view?.kind !== 'canvas') {
            throw new Refused('no-canvas', 'This needs a canvas in front');
        }

        return view.id;
    }

    nodeOnCanvas(node: { id: string }): HostNode {
        const found = this.nodes.get(node.id);

        if (found === undefined) {
            throw new Refused('not-found', `No node ${node.id} on a canvas of this window`);
        }

        return found;
    }

    /* Right of the node it is about, as a person would drag it. */
    beside(near: readonly { id: string }[] | undefined): { x: number; y: number } {
        const anchor = near?.[0] === undefined ? undefined : this.nodes.get(near[0].id);

        return anchor === undefined ? { x: 0, y: 0 } : { x: anchor.bounds.x + anchor.bounds.width + BESIDE_GAP, y: anchor.bounds.y + anchor.bounds.height / 2 };
    }

    addNode(kind: string, at: { x: number; y: number }, size: { width: number; height: number }, details: Partial<HostNode>): { id: string } {
        const viewId = this.canvasInFront();
        let id = `${kind}-${this.nextId}`;

        while (this.nodes.has(id)) {
            this.nextId += 1;
            id = `${kind}-${this.nextId}`;
        }

        this.nextId += 1;
        this.nodes.set(id, { id, kind, title: '', text: '', color: null, bounds: { ...at, ...size }, viewId, groupId: null, ...details });
        this.createdIds.push(id);
        this.changed();
        this.deliver('node.added', { node: this.info(id) });

        return { id };
    }

    /*
     * What the client host does before a node draws: data an older `dataVersion` stored moves up through the definition's
     * `migrate`, and is saved with the version it is now. A node from before any version counts as 1.
     */
    migrateNode(definition: object, nodeId: string): void {
        const { dataVersion, migrate } = definition as { dataVersion?: unknown; migrate?: unknown };
        const node = this.nodes.get(nodeId);

        if (node === undefined || typeof dataVersion !== 'number' || typeof migrate !== 'function') {
            return;
        }

        const from = node.dataVersion ?? 1;

        if (from < dataVersion) {
            this.changeNode(nodeId, { data: wire((migrate as (stored: unknown, from: number) => unknown)(node.data, from)), dataVersion });
        }
    }

    addView(kind: string, name: string): { id: string } {
        let count = this.views.length + 1;

        while (this.views.some((view) => view.id === `view-${count}`)) {
            count += 1;
        }

        const id = `view-${count}`;

        this.views.push({ id, kind, name });
        this.changed();

        return { id };
    }

    changeNode(id: string, change: Partial<HostNode>): void {
        const node = this.nodes.get(id);

        if (node !== undefined) {
            Object.assign(node, change);
            this.changed();
            this.deliver('node.changed', { node: this.info(id) });
        }
    }

    addEdge(from: string, to: string): void {
        if (!this.edges.some((edge) => edge.from === from && edge.to === to)) {
            this.edges.push({ from, to });
        }
    }

    remove(ids: readonly string[]): void {
        for (const id of ids) {
            if (this.nodes.delete(id)) {
                this.deliver('node.removed', { id });
            }
        }

        this.selection = this.selection.filter((id) => !ids.includes(id));
        this.edges.splice(0, this.edges.length, ...this.edges.filter((edge) => !ids.includes(edge.from) && !ids.includes(edge.to)));
        this.changed();
    }

    select(ids: readonly string[]): void {
        this.selection = [...ids];
        this.changed();
        this.deliver('selection.changed', { nodes: this.selection.map((id) => this.info(id)) });
    }

    openView(id: string): void {
        this.activeViewId = id;
        this.changed();
        this.deliver('view.changed', { viewId: id });
    }

    /* A readable copy, as the client host hands out: an extension never holds the host's own node. */
    info(id: string): NodeInfo {
        const node = this.nodes.get(id);

        if (node === undefined) {
            return {
                id,
                kind: 'unknown',
                title: '',
                color: null,
                bounds: { x: 0, y: 0, width: 0, height: 0 },
                groupId: null,
                viewId: this.activeViewId ?? '',
                machine: null,
                linkedTo: []
            };
        }

        const agent =
            node.kind === 'chat' || node.kind === 'terminal' || node.kind === 'design'
                ? {
                      provider: 'claude',
                      account: null,
                      status: 'idle' as const,
                      cwd: null,
                      branch: null,
                      worktree: null,
                      ...node.agent
                  }
                : undefined;

        return {
            id,
            kind: node.kind,
            title: node.title,
            color: node.color,
            bounds: { ...node.bounds },
            groupId: node.groupId,
            viewId: node.viewId,
            machine: null,
            linkedTo: this.edges.flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : [])),
            ...(agent === undefined ? {} : { agent }),
            ...(node.path === undefined ? {} : { path: node.path }),
            ...(node.url === undefined ? {} : { url: node.url }),
            ...(node.extension === undefined ? {} : { extension: { ...node.extension } })
        };
    }

    nodesInFront(): NodeInfo[] {
        return [...this.nodes.values()].filter((node) => node.viewId === this.activeViewId).map((node) => this.info(node.id));
    }

    baseContext(): PublicClient.BaseContext {
        const view = this.views.find((each) => each.id === this.activeViewId);

        return {
            project: { id: this.project?.id ?? '', name: this.project?.name ?? '', folder: this.project?.folder ?? null },
            view: view === undefined ? null : { ...view },
            machine: { id: this.machineId },
            theme: this.theme
        };
    }

    /* What a slot tells at this place. The client host reads a node it was handed again, so a ref becomes the node as it is now. */
    context(place: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
        if (!isExtensionSlotName(place)) {
            throw new TypeError(`${place} is no slot. The slots are ${EXTENSION_SLOT_NAMES.join(', ')}`);
        }

        const current = (value: unknown): unknown => {
            if (Array.isArray(value)) {
                return value.map(current);
            }

            if (typeof value === 'string') {
                return this.info(value);
            }

            return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
                ? this.info((value as { id: string }).id)
                : value;
        };
        const told = Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, NODE_PLACES.includes(key) ? current(value) : value]));
        const selected = (): NodeInfo[] => this.selection.map((id) => this.info(id));
        const defaults: Record<string, unknown> = {};

        if (place === 'selectionBar' || place === 'commandPalette') {
            defaults.nodes = selected();
        }

        if (place === 'canvasMenu') {
            defaults.at = { x: 0, y: 0 };
        }

        // Right on a node in the selection means the selection, as for delete.
        if (place === 'nodeMenu' && told.node !== undefined && told.nodes === undefined) {
            const { id } = told.node as NodeInfo;

            defaults.nodes = this.selection.includes(id) ? selected() : [told.node];
        }

        return { ...this.baseContext(), ...defaults, ...told };
    }

    /* How an entry shows at a place, or null where it does not: a throw in its slot costs only itself. */
    shown(entry: Entry, place: string, context: object): PublicTesting.TestSlotShown | null {
        const slot = entry.slots[place];

        if (slot === undefined) {
            return null;
        }

        try {
            const answer = slot === true ? true : (slot as (context: object) => PublicClient.SlotAnswer)(context);

            if (answer === false) {
                return null;
            }

            const details = answer === true ? {} : answer;

            return {
                title: details.title ?? entry.title,
                icon: details.icon ?? entry.icon ?? null,
                disabled: details.disabled ?? false,
                badge: details.badge ?? null,
                order: details.order ?? 0
            };
        } catch (e) {
            this.logs.push(`${entry.id}: ${errorText(e)}`);

            return null;
        }
    }

    entry(definition: object): Entry {
        const entry = this.entryOf.get(definition);

        if (entry === undefined) {
            throw new TypeError('This is no action, menu, widget or node the extension defined. Take one from host.action(id) and its kind');
        }

        return entry;
    }

    /* An action is someone else's code and often slow, so a failure reaches a person, as in Ruimte. */
    async runEntry(entry: Entry, title: string, context: Record<string, unknown>, slot: string): Promise<Result<void>> {
        const nodeIds = ((context.nodes as { id: string }[] | undefined) ?? (context.node === undefined ? [] : [context.node as { id: string }])).map(
            (node) => node.id
        );
        const run = entry.run;
        const busy = this.runs.some(
            (each) => each.actionId === entry.id && (nodeIds.length === 0 || each.nodeIds.length === 0 || each.nodeIds.some((id) => nodeIds.includes(id)))
        );

        if (run === undefined || busy) {
            return { ok: false, error: { code: 'refused', message: `${title} is running on these nodes already` } };
        }

        const tracked = { actionId: entry.id, nodeIds };

        this.runs.push(tracked);
        this.changed();

        try {
            await run({ ...context, slot, signal: new AbortController().signal });

            return { ok: true, value: undefined };
        } catch (e) {
            const message = errorText(e);

            this.notifications.push({ text: title, detail: message, tone: 'error' });
            this.logs.push(`${entry.id.slice(this.id.length + 1)}: ${message}`);

            return { ok: false, error: { code: 'failed', message } };
        } finally {
            this.runs.splice(this.runs.indexOf(tracked), 1);
            this.changed();
        }
    }

    slot(definition: object, place: string, extra?: Record<string, unknown>): PublicTesting.TestSlotShown | null {
        const context = this.context(place, extra);

        return this.shown(this.entry(definition), place, context);
    }

    async run(definition: object, place: string, extra?: Record<string, unknown>): Promise<Result<void>> {
        const context = this.context(place, extra);
        const entry = this.entry(definition);
        const shown = this.shown(entry, place, context);

        if (shown === null) {
            return { ok: false, error: { code: 'refused', message: `${entry.title} does not show in ${place} here` } };
        }

        if (shown.disabled !== false) {
            return {
                ok: false,
                error: { code: 'refused', message: typeof shown.disabled === 'string' ? shown.disabled : `${shown.title} is disabled in ${place} here` }
            };
        }

        return this.runEntry(entry, shown.title, context, place);
    }

    menuItems(menu: object, place: string, extra?: Record<string, unknown>): Result<PublicTesting.TestMenuItem[]> {
        const context = this.context(place, extra);
        const entry = this.entry(menu);

        if (entry.kind !== 'menu') {
            throw new TypeError(`${entry.title} is no menu`);
        }

        if (this.shown(entry, place, context) === null) {
            return { ok: false, error: { code: 'refused', message: `${entry.title} does not show in ${place} here` } };
        }

        try {
            const items = typeof entry.items === 'function' ? (entry.items as (context: object) => unknown[])(context) : ((entry.items as unknown[]) ?? []);

            return { ok: true, value: this.rows(items, context, place) };
        } catch (e) {
            const message = errorText(e);

            this.logs.push(`${entry.id.slice(this.id.length + 1)}: ${message}`);

            return { ok: false, error: { code: 'failed', message } };
        }
    }

    /* An item that names an action which is gone is left out, as in Ruimte. */
    private rows(items: readonly unknown[], context: Record<string, unknown>, place: string): PublicTesting.TestMenuItem[] {
        return items.flatMap((item): PublicTesting.TestMenuItem[] => {
            if (item === 'separator') {
                return ['separator'];
            }

            if (typeof item === 'object' && item !== null && 'actionId' in item) {
                const action = this.entries.find((each) => each.id === (item as { actionId: string }).actionId);

                return action === undefined ? [] : [{ title: action.title, run: () => this.runEntry(action, action.title, context, place) }];
            }

            const row = item as { title: string; run?: () => void; checked?: boolean; items?: unknown[] };

            if (row.items !== undefined) {
                return [{ title: row.title, items: this.rows(row.items, context, place) }];
            }

            return [
                {
                    title: row.title,
                    ...(row.checked === undefined ? {} : { checked: row.checked }),
                    run: async () => {
                        try {
                            row.run?.();

                            return { ok: true, value: undefined };
                        } catch (e) {
                            return { ok: false, error: { code: 'failed', message: errorText(e) } };
                        }
                    }
                }
            ];
        });
    }

    /* What a person answers a dialog, as the test scripted it. */
    ask<Value>(kind: 'confirm' | 'prompt' | 'pick' | 'folder', title: string, answer: Value, body?: string): Value {
        this.dialogs.push({ kind, title, ...(body === undefined ? {} : { body }), answer });

        return answer;
    }
}
