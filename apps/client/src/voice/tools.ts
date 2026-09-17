import { isCanvasView, isOpenableView, type ProjectNode, type ProjectView, type VoiceToolName } from '@ruimte/contracts';
import { clientActions, VOICE_ACTION_CALL } from '@/actions/client-actions';
import { addNodeAtCenter } from '@/shell/commands';
import { focusedCanvas } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { chatClient } from '@/transport/connections';
import type { VoiceActionKind } from '@/voice/state';

interface ToolAction {
    kind: VoiceActionKind;
    label: string;
    detail: string;
    undo?: () => void;
}

export interface VoiceToolExecution {
    output: Record<string, unknown>;
    action?: ToolAction;
}

const ok = (message: string, data: Record<string, unknown> = {}, action?: ToolAction): VoiceToolExecution => ({
    output: { ok: true, message, ...data },
    ...(action ? { action } : {})
});

const failed = (message: string): VoiceToolExecution => ({ output: { ok: false, message } });

const normalized = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const named = <T>(name: string, values: T[], label: (value: T) => string): T | null => {
    const target = normalized(name);
    const exact = values.find((value) => normalized(label(value)) === target);
    if (exact) {
        return exact;
    }
    const candidates = values.filter((value) => normalized(label(value)).includes(target) || target.includes(normalized(label(value))));
    return target !== '' && candidates.length === 1 ? candidates[0]! : null;
};

const objectArguments = (raw: string): Record<string, unknown> | null => {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

const stringArgument = (args: Record<string, unknown>, name: string): string | null =>
    typeof args[name] === 'string' && args[name].trim() !== '' ? args[name].trim() : null;

const nullableStringArgument = (args: Record<string, unknown>, name: string): string | null | undefined =>
    args[name] === null ? null : typeof args[name] === 'string' && args[name].trim() !== '' ? args[name].trim() : undefined;

const activeCanvas = () => {
    const active = activeViewOf(useDocument.getState());
    return active && isCanvasView(active) ? { view: active, canvas: focusedCanvas().getState() } : null;
};

const workspaceSnapshot = (): Record<string, unknown> => {
    const document = useDocument.getState();
    const active = activeViewOf(document);
    const canvas = activeCanvas();
    return {
        project: useProject.getState().current?.name ?? 'Untitled project',
        activeView: active ? { id: active.id, name: active.name, kind: active.kind } : null,
        views: document.views.filter(isOpenableView).map((view) => ({ id: view.id, name: view.name, kind: view.kind })),
        canvas: canvas
            ? {
                  nodes: canvas.canvas.order.map((id) => {
                      const node = canvas.canvas.nodes[id]!;
                      return { id: node.id, title: node.title, kind: node.kind };
                  }),
                  selected: canvas.canvas.selection.map((id) => canvas.canvas.nodes[id]?.title ?? id)
              }
            : null
    };
};

const findView = (name: string | null): ProjectView | null => {
    const document = useDocument.getState();
    if (name === null) {
        return activeViewOf(document);
    }
    return named(name, document.views.filter(isOpenableView), (view) => view.name ?? '');
};

const findNode = (name: string | null): ProjectNode | null => {
    const current = activeCanvas();
    if (!current) {
        return null;
    }
    if (name === null) {
        return current.canvas.selection.length === 1 ? (current.canvas.nodes[current.canvas.selection[0]!] ?? null) : null;
    }
    return named(name, Object.values(current.canvas.nodes), (node) => node.title);
};

const findChat = (name: string | null): { id: string; title: string } | null => {
    const document = useDocument.getState();
    const active = activeViewOf(document);
    const canvas = activeCanvas();
    if (name === null) {
        if (active?.kind === 'chat') {
            return { id: active.id, title: active.name };
        }
        if (canvas) {
            const selected = canvas.canvas.selection.map((id) => canvas.canvas.nodes[id]).filter((node) => node?.kind === 'chat');
            return selected.length === 1 ? { id: selected[0]!.id, title: selected[0]!.title } : null;
        }
        return null;
    }
    const candidates: { id: string; title: string }[] = [];
    for (const view of document.views) {
        if (view.kind === 'chat') {
            candidates.push({ id: view.id, title: view.name });
        } else if (isCanvasView(view)) {
            const nodes = view.id === canvas?.view.id ? Object.values(canvas.canvas.nodes) : view.nodes;
            candidates.push(...nodes.filter((node) => node.kind === 'chat').map((node) => ({ id: node.id, title: node.title })));
        }
    }
    return named(name, candidates, (candidate) => candidate.title);
};

const freeViewName = (base: string): string => {
    const names = new Set(useDocument.getState().views.map((view) => view.name));
    if (!names.has(base)) {
        return base;
    }
    let index = 2;
    while (names.has(`${base} ${index}`)) {
        index += 1;
    }
    return `${base} ${index}`;
};

const createView = (args: Record<string, unknown>): VoiceToolExecution => {
    const kind = stringArgument(args, 'kind');
    const name = nullableStringArgument(args, 'name');
    const url = nullableStringArgument(args, 'url');
    const command = nullableStringArgument(args, 'command');
    if (!kind || [name, url, command].includes(undefined) || !['canvas', 'drawing', 'diagram', 'terminal', 'browser', 'chat'].includes(kind)) {
        return failed('The view kind or name was invalid.');
    }
    const document = useDocument.getState();
    const title = name ?? freeViewName(kind === 'chat' ? 'AI Chat' : kind.charAt(0).toUpperCase() + kind.slice(1));
    const id =
        kind === 'canvas'
            ? document.addCanvasView(title)
            : kind === 'drawing'
              ? document.addDrawingView(title)
              : kind === 'diagram'
                ? document.addDiagramView(title)
                : kind === 'browser'
                  ? document.addStandaloneView({ kind: 'browser', name: title, url: url ?? 'https://www.google.com' })
                  : kind === 'chat'
                    ? document.addStandaloneView({ kind: 'chat', name: title, node: {} })
                    : document.addStandaloneView({ kind: 'terminal', name: title, node: command ? { command } : {} });
    if (!id) {
        return failed(`Ruimte could not create the ${kind} view.`);
    }
    const created = useDocument.getState().views.find((view) => view.id === id);
    const createdTitle = created?.name ?? title;
    return ok(
        `Created and focused “${createdTitle}”.`,
        { viewId: id, view: createdTitle },
        { kind: 'view', label: `Created ${kind} view`, detail: createdTitle }
    );
};

const createCanvasNode = (args: Record<string, unknown>): VoiceToolExecution => {
    const kind = stringArgument(args, 'kind');
    const title = nullableStringArgument(args, 'title');
    const content = nullableStringArgument(args, 'content');
    const url = nullableStringArgument(args, 'url');
    const command = nullableStringArgument(args, 'command');
    if (!kind || [title, content, url, command].includes(undefined) || !['terminal', 'chat', 'browser', 'group', 'note'].includes(kind)) {
        return failed('The canvas node arguments were invalid.');
    }
    const nodeKind = kind as 'terminal' | 'chat' | 'browser' | 'group' | 'note';
    const current = activeCanvas();
    if (!current) {
        return failed('Open a canvas view before creating a canvas node.');
    }
    const id = addNodeAtCenter(nodeKind, {
        ...(title ? { title } : nodeKind === 'note' && content ? { title: content.split('\n')[0]!.slice(0, 48) } : {}),
        ...(url && nodeKind === 'browser' ? { url } : {}),
        ...(command && nodeKind === 'terminal' ? { command } : {})
    });
    if (!id) {
        return failed(`The active canvas could not create the ${kind} node.`);
    }
    if (nodeKind === 'note' && content) {
        focusedCanvas().getState().updateNode(id, { body: content });
    }
    const node = focusedCanvas().getState().nodes[id]!;
    const labels = { terminal: 'terminal', chat: 'AI Chat', browser: 'browser', group: 'group', note: 'note' } as const;
    return ok(
        `Created ${labels[nodeKind]} “${node.title}” in free space on “${current.view.name}”.`,
        { nodeId: id, node: node.title },
        {
            kind: nodeKind === 'terminal' ? 'terminal' : nodeKind === 'chat' ? 'chat' : nodeKind === 'note' ? 'note' : 'node',
            label: `Added ${labels[nodeKind]}`,
            detail: `${node.title} · ${current.view.name}`,
            undo: () => focusedCanvas().getState().undo()
        }
    );
};

export const executeVoiceTool = async (name: VoiceToolName, rawArguments: string): Promise<VoiceToolExecution> => {
    const args = objectArguments(rawArguments);
    if (!args) {
        return failed('The tool arguments were not valid JSON.');
    }
    if (name === 'inspect_workspace') {
        return ok('Read the current Ruimte workspace.', { workspace: workspaceSnapshot() });
    }
    if (name === 'focus_view') {
        const requested = stringArgument(args, 'view');
        const view = requested ? findView(requested) : null;
        if (!view) {
            return failed(`No unique view matched “${requested ?? ''}”.`);
        }
        const result = await clientActions.execute('view.focus', { viewId: view.id }, VOICE_ACTION_CALL);
        if (result.status !== 'completed') {
            return failed(result.status === 'failed' ? result.error.message : 'Focusing this view needs confirmation.');
        }
        const title = result.output.view;
        const undoToken = result.undoToken;
        return ok(
            `Focused the view “${title}”.`,
            { viewId: view.id, view: title },
            {
                kind: 'focus',
                label: 'Focused view',
                detail: title,
                ...(undoToken
                    ? {
                          undo: () => {
                              void clientActions.undo(undoToken, VOICE_ACTION_CALL);
                          }
                      }
                    : {})
            }
        );
    }
    if (name === 'create_view') {
        return createView(args);
    }
    if (name === 'rename_view') {
        const target = nullableStringArgument(args, 'view');
        const nextName = stringArgument(args, 'name');
        if (target === undefined || !nextName) {
            return failed('The view name was invalid.');
        }
        const view = findView(target);
        if (!view) {
            return failed(target === null ? 'There is no active view to rename.' : `No unique view matched “${target}”.`);
        }
        const result = await clientActions.execute('view.rename', { viewId: view.id, name: nextName }, VOICE_ACTION_CALL);
        if (result.status !== 'completed') {
            return failed(result.status === 'failed' ? result.error.message : 'Renaming this view needs confirmation.');
        }
        const previous = result.output.previousName;
        const undoToken = result.undoToken;
        return ok(
            `Renamed “${previous}” to “${nextName}”.`,
            { viewId: view.id, view: nextName },
            {
                kind: 'rename',
                label: 'Renamed view',
                detail: `${previous} → ${nextName}`,
                ...(undoToken
                    ? {
                          undo: () => {
                              void clientActions.undo(undoToken, VOICE_ACTION_CALL);
                          }
                      }
                    : {})
            }
        );
    }
    if (name === 'focus_node') {
        const requested = stringArgument(args, 'node');
        const node = requested ? findNode(requested) : null;
        const current = activeCanvas();
        if (!node || !current) {
            return failed(`No unique node matched “${requested ?? ''}” on the active canvas.`);
        }
        current.canvas.select([node.id]);
        current.canvas.goToNode(node.id);
        return ok(`Focused the node “${node.title}”.`, { nodeId: node.id, node: node.title }, { kind: 'focus', label: 'Focused node', detail: node.title });
    }
    if (name === 'rename_node') {
        const target = nullableStringArgument(args, 'node');
        const nextName = stringArgument(args, 'name');
        const current = activeCanvas();
        if (target === undefined || !nextName || !current) {
            return failed('Open a canvas and provide a valid node name.');
        }
        const node = findNode(target);
        if (!node) {
            return failed(target === null ? 'Select exactly one node before renaming it.' : `No unique node matched “${target}”.`);
        }
        const previous = node.title;
        current.canvas.renameNode(node.id, nextName);
        return ok(
            `Renamed “${previous}” to “${nextName}”.`,
            { nodeId: node.id, node: nextName },
            {
                kind: 'rename',
                label: 'Renamed node',
                detail: `${previous} → ${nextName}`,
                undo: () => focusedCanvas().getState().renameNode(node.id, previous)
            }
        );
    }
    if (name === 'create_canvas_node') {
        return createCanvasNode(args);
    }
    if (name === 'prompt_ai_chat') {
        const target = nullableStringArgument(args, 'chat');
        const prompt = stringArgument(args, 'prompt');
        if (target === undefined || !prompt) {
            return failed('The AI Chat target or prompt was invalid.');
        }
        const chat = findChat(target);
        if (!chat) {
            return failed(target === null ? 'Open an AI Chat view or select exactly one AI Chat node.' : `No unique AI Chat matched “${target}”.`);
        }
        try {
            const queued = await chatClient.send(chat.id, prompt);
            return ok(
                `${queued ? 'Queued' : 'Submitted'} the prompt in “${chat.title}”.`,
                { chatId: chat.id, chat: chat.title, queued },
                {
                    kind: 'chat',
                    label: queued ? 'Queued AI Chat prompt' : 'Prompted AI Chat',
                    detail: `${chat.title}: ${prompt.slice(0, 120)}`
                }
            );
        } catch (error) {
            return failed(error instanceof Error ? `Could not prompt “${chat.title}”: ${error.message}` : `Could not prompt “${chat.title}”.`);
        }
    }
    if (name === 'control_canvas') {
        const action = stringArgument(args, 'action');
        const current = activeCanvas();
        if (!current) {
            return failed('Open a canvas before using a canvas control.');
        }
        if (action === 'fit') {
            current.canvas.fitAll();
            return ok('Fitted all canvas content in view.', {}, { kind: 'focus', label: 'Fit canvas', detail: current.view.name });
        }
        if (action === 'undo' || action === 'redo') {
            current.canvas[action]();
            return ok(
                `${action === 'undo' ? 'Undid' : 'Redid'} the canvas change.`,
                {},
                {
                    kind: 'node',
                    label: action === 'undo' ? 'Undid canvas change' : 'Redid canvas change',
                    detail: current.view.name
                }
            );
        }
        if (action === 'group_selection') {
            const id = current.canvas.groupSelection();
            return id
                ? ok(
                      'Grouped the selected nodes.',
                      { nodeId: id },
                      {
                          kind: 'node',
                          label: 'Grouped selection',
                          detail: current.view.name,
                          undo: () => focusedCanvas().getState().undo()
                      }
                  )
                : failed('Select one or more nodes before grouping them.');
        }
        if (action === 'duplicate_selection') {
            const selected = current.canvas.selection.length === 1 ? current.canvas.nodes[current.canvas.selection[0]!] : null;
            if (!selected) {
                return failed('Select exactly one node before duplicating it.');
            }
            current.canvas.duplicateNode(selected.id);
            const id = focusedCanvas().getState().selection[0];
            return ok(
                `Duplicated “${selected.title}”.`,
                { nodeId: id },
                {
                    kind: 'node',
                    label: 'Duplicated node',
                    detail: selected.title,
                    undo: () => focusedCanvas().getState().undo()
                }
            );
        }
        return failed('The canvas control was invalid.');
    }
    return failed(`Ruimte does not support the tool “${name}”.`);
};
