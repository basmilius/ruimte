import {
    canvasContextSources,
    designOfChat,
    isCanvasView,
    isDatabaseView,
    isDesignView,
    nodeChats,
    resolveStoredPath,
    viewChats,
    type ChatItem,
    type ContextSource,
    type ProjectCanvasView,
    type ProjectDatabaseTarget,
    type ProjectView,
    type ViewChat
} from '@ruimte/contracts';

type ReferenceKind =
    | 'canvas'
    | 'chat'
    | 'terminal'
    | 'note'
    | 'text'
    | 'drawing'
    | 'diagram'
    | 'browser'
    | 'device'
    | 'file'
    | 'database'
    | 'artifact'
    | 'routine';

/* A view, node, text or chat of the chat's own project that a person pointed at with `#` (a chat, before `#`, with `@`). */
export interface Reference {
    id: string;
    kind: ReferenceKind;
    name: string;
    /* The canvas a node or a text stands on; null for a view of its own. */
    canvas: { id: string; name: string } | null;
    /* What `read` takes through it: the thing itself, and for a canvas every node and text on it. */
    sources: ContextSource[];
    /* The table a database view shows, which `read` names with the command that reads it. */
    database?: ProjectDatabaseTarget;
}

function viewSource(view: ProjectView, folder: string | null): ContextSource | null {
    switch (view.kind) {
        case 'chat':
            // A chat an inline edit runs in is shown nowhere, so no person points at it.
            return view.hidden === true ? null : { id: view.id, kind: 'chat', title: view.name };
        case 'terminal':
            return { id: view.id, kind: 'terminal', title: view.name };
        case 'browser':
            return { id: view.id, kind: 'browser', title: view.name, text: view.url };
        case 'device':
            return { id: view.id, kind: 'device', title: view.name, device: view.device };
        case 'drawing':
        case 'diagram':
            return { id: view.id, kind: view.kind, title: view.name };
        case 'file':
            return { id: view.id, kind: 'file', title: view.name, text: resolveStoredPath(folder, view.path) ?? view.path };
        default:
            return null;
    }
}

function nodeReference(canvas: ProjectCanvasView, id: string, folder: string | null): Reference | null {
    const node = canvas.nodes.find((candidate) => candidate.id === id);
    const text = canvas.texts.find((candidate) => candidate.id === id);
    if (!node && !text) {
        return null;
    }
    // A node with nothing to read in it (a group, a device that points at none) is no reference either.
    const source = canvasContextSources(canvas, folder).find((candidate) => candidate.id === id || candidate.nodeId === id);
    if (!source) {
        return null;
    }
    const kind: ReferenceKind = node === undefined ? 'text' : node.kind === 'note' ? 'note' : source.kind === 'text' ? 'text' : source.kind;
    const sources = node?.kind === 'design' ? designSources(nodeChats(node)) : [source];
    return { id, kind, name: source.title, canvas: { id: canvas.id, name: canvas.name }, sources };
}

/* Every chat of a design works on the same pages, so a `#` to it reads them all, as a line to it does. */
function designSources(chats: readonly ViewChat[]): ContextSource[] {
    return chats.map((chat) => ({ id: chat.id, kind: 'chat', title: chat.name }));
}

/*
 * The id among the views of one project, as a view of its own or a node or text on a canvas; null for
 * an id the project does not hold or one with nothing an agent could read in it, such as a separator.
 */
export function resolveReference(views: readonly ProjectView[], id: string, folder: string | null): Reference | null {
    for (const view of views) {
        if (view.id === id) {
            if (isCanvasView(view)) {
                return { id, kind: 'canvas', name: view.name, canvas: null, sources: canvasContextSources(view, folder) };
            }
            if (isDatabaseView(view)) {
                const { connectionId, schema, table, mode, where, tableKind } = view;
                const database = {
                    connectionId,
                    schema,
                    table,
                    mode,
                    ...(where === undefined ? {} : { where }),
                    ...(tableKind === undefined ? {} : { tableKind })
                };
                return { id, kind: 'database', name: view.name, canvas: null, sources: [], database };
            }
            if (isDesignView(view)) {
                return { id, kind: 'chat', name: view.name, canvas: null, sources: designSources(viewChats(view)) };
            }
            const source = viewSource(view, folder);
            return source === null ? null : { id, kind: source.kind === 'text' ? 'text' : source.kind, name: source.title, canvas: null, sources: [source] };
        }
    }
    for (const view of views) {
        if (isCanvasView(view)) {
            const reference = nodeReference(view, id, folder);
            if (reference) {
                return reference;
            }
        }
    }
    // A later chat of a design is neither a view nor a node of its own.
    const found = designOfChat(views, id);
    if (found === null) {
        return null;
    }
    const canvas = views.find((view) => view.id === found.design.canvasId);
    return {
        id,
        kind: 'chat',
        name: found.chat.name,
        canvas: canvas !== undefined && isCanvasView(canvas) ? { id: canvas.id, name: canvas.name } : null,
        sources: [{ id, kind: 'chat', title: found.chat.name }]
    };
}

/* The ids that still stand in the project, once each and in the order given; `lookup` answers null for any other. */
export function resolveReferences(ids: readonly string[] | undefined, lookup: (id: string) => Reference | null): Reference[] {
    const references: Reference[] = [];
    for (const id of new Set(ids ?? [])) {
        const reference = lookup(id);
        if (reference !== null) {
            references.push(reference);
        }
    }
    return references;
}

function command(text: string): string {
    return `\`ruimte-context ${text}\``;
}

/* What the agent may do besides reading, as a reference gives it: what a line gives, and for a canvas adding nodes. */
function writeCommand(reference: Reference): string | null {
    const { id, kind, canvas } = reference;
    switch (kind) {
        case 'note':
            return `write with ${command(`node edit ${id}`)}`;
        case 'chat':
        case 'terminal':
            return `message it with ${command(`notify ${id}`)}`;
        case 'diagram':
            return `write with ${command(`view diagram ${reference.sources[0]?.id ?? id}`)}`;
        case 'drawing': {
            const viewId = reference.sources[0]?.id ?? id;
            return `see its elements with ${command(`read ${viewId} --elements`)} · write with ${command(`view drawing ${viewId} --revision R`)}`;
        }
        // A browser or a device that is a view of its own has no node the verbs drive.
        case 'browser':
            return canvas === null ? null : `drive it with ${command(`browser go ${id} --url U`)}`;
        case 'device':
            return canvas === null ? null : `operate it with ${command(`device shot ${id}`)} and the other device verbs`;
        case 'canvas':
            return `read any node on it with ${command('read <id>')} · add nodes with ${command(`node new <kind> --view ${id}`)}`;
        default:
            return null;
    }
}

function referenceLine(reference: Reference): string {
    const what = reference.canvas === null ? reference.kind : `${reference.kind} on ${JSON.stringify(reference.canvas.name)}`;
    const read = command(`read ${reference.id}`);
    const write = writeCommand(reference);
    return `- ${JSON.stringify(reference.name)} (${what}): ${read}${write === null ? '' : ` · ${write}`}`;
}

/* What the agent is told in front of a message that points at views and nodes: where they are, never what they hold. */
export function referenceNote(references: readonly Reference[]): string | null {
    if (references.length === 0) {
        return null;
    }
    return [
        'The person referenced views and nodes of this project in this message. Read each with the command beside it before you answer.',
        ...references.map(referenceLine),
        'When you refer back to one of them, write `#` and its name exactly as listed (#Name), and the person can open it from your answer.'
    ].join('\n');
}

/*
 * What a message carries on to its thread and the note in front of it, from the ids a client sent. `chats`
 * stays what its chips draw, so only a chat resolves there; the rest goes in `references`.
 */
export function attachedReferences(
    attached: { readonly chats?: readonly string[]; readonly references?: readonly string[] },
    lookup: (id: string) => Reference | null
): { chats: string[]; references: string[]; note: string | null } {
    const chats = resolveReferences(attached.chats, lookup).filter((reference) => reference.kind === 'chat');
    const taken = new Set(chats.map((reference) => reference.id));
    const references = resolveReferences(attached.references, lookup).filter((reference) => !taken.has(reference.id));
    return {
        chats: chats.map((reference) => reference.id),
        references: references.map((reference) => reference.id),
        note: referenceNote([...chats, ...references])
    };
}

/* Every id a person attached to a message of this thread, with `@` or with `#`. Only a user item counts, so an agent cannot give itself one. */
export function referencedIds(items: readonly ChatItem[]): string[] {
    return items.flatMap((item) => (item.kind === 'user' ? [...(item.chats ?? []), ...(item.references ?? [])] : []));
}

/*
 * What a chat may read and write in because a person pointed at it in one of its messages, without a
 * line on a canvas. Asked at every call, so a view that went or left the project is no longer one of them.
 */
export function referenced(items: readonly ChatItem[], lookup: (id: string) => Reference | null): Reference[] {
    return resolveReferences(referencedIds(items), lookup);
}

/* Whether a person pointed at this very id, not only at the canvas it stands on: what a write takes. */
export function referencesDirectly(references: readonly Reference[], id: string): boolean {
    return references.some((reference) => reference.id === id);
}
