import { isCanvasView, isOpenableView, type ProjectNode, type ProjectView, type VoiceToolName } from '@ruimte/contracts';
import { clientActions, VOICE_ACTION_CALL } from '@/actions/client-actions';
import { focusedCanvas } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
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

const failed = (message: string): VoiceToolExecution => ({
    output: { ok: false, message }
});

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

const findView = (name: string | null): ProjectView | null => {
    const document = useDocument.getState();
    return name === null ? activeViewOf(document) : named(name, document.views.filter(isOpenableView), (view) => view.name ?? '');
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

const undoAction = (undoToken: string | undefined): Pick<ToolAction, 'undo'> | Record<string, never> =>
    undoToken
        ? {
              undo: () => {
                  void clientActions.undo(undoToken, VOICE_ACTION_CALL);
              }
          }
        : {};

const failureOf = (result: { status: string; error?: { message: string } }): VoiceToolExecution =>
    failed(result.status === 'failed' && result.error ? result.error.message : 'This action needs confirmation.');

const manageViews = async (args: Record<string, unknown>): Promise<VoiceToolExecution> => {
    const action = stringArgument(args, 'action');
    const target = nullableStringArgument(args, 'view');
    const kind = nullableStringArgument(args, 'kind');
    const name = nullableStringArgument(args, 'name');
    const url = nullableStringArgument(args, 'url');
    const command = nullableStringArgument(args, 'command');
    if ([target, kind, name, url, command].includes(undefined)) {
        return failed('The view arguments were invalid.');
    }
    if (action === 'create') {
        if (!kind || !['canvas', 'drawing', 'diagram', 'terminal', 'browser', 'chat'].includes(kind)) {
            return failed('Choose a valid kind when creating a view.');
        }
        const result = await clientActions.execute(
            'view.create',
            {
                kind,
                name: name ?? null,
                url: url ?? null,
                command: command ?? null
            },
            VOICE_ACTION_CALL
        );
        if (result.status !== 'completed') {
            return failureOf(result);
        }
        return ok(`Created and focused “${result.output.view}”.`, result.output, {
            kind: 'view',
            label: `Created ${result.output.kind} view`,
            detail: result.output.view
        });
    }
    const view = findView(target ?? null);
    if (!view) {
        return failed(target === null ? 'There is no active view.' : `No unique view matched “${target ?? ''}”.`);
    }
    if (action === 'focus') {
        const result = await clientActions.execute('view.focus', { viewId: view.id }, VOICE_ACTION_CALL);
        if (result.status !== 'completed') {
            return failureOf(result);
        }
        return ok(`Focused the view “${result.output.view}”.`, result.output, {
            kind: 'focus',
            label: 'Focused view',
            detail: result.output.view,
            ...undoAction(result.undoToken)
        });
    }
    if (action === 'rename' && name) {
        const result = await clientActions.execute('view.rename', { viewId: view.id, name }, VOICE_ACTION_CALL);
        if (result.status !== 'completed') {
            return failureOf(result);
        }
        return ok(`Renamed “${result.output.previousName}” to “${name}”.`, result.output, {
            kind: 'rename',
            label: 'Renamed view',
            detail: `${result.output.previousName} → ${name}`,
            ...undoAction(result.undoToken)
        });
    }
    return failed('Choose focus, create or rename and provide the required view arguments.');
};

const manageCanvas = async (args: Record<string, unknown>): Promise<VoiceToolExecution> => {
    const action = stringArgument(args, 'action');
    const target = nullableStringArgument(args, 'node');
    const kind = nullableStringArgument(args, 'kind');
    const name = nullableStringArgument(args, 'name');
    const title = nullableStringArgument(args, 'title');
    const content = nullableStringArgument(args, 'content');
    const url = nullableStringArgument(args, 'url');
    const command = nullableStringArgument(args, 'command');
    if ([target, kind, name, title, content, url, command].includes(undefined)) {
        return failed('The canvas arguments were invalid.');
    }
    const current = activeCanvas();
    if (!current) {
        return failed('Open a canvas before using a canvas action.');
    }
    if (action === 'create_node') {
        if (!kind || !['terminal', 'chat', 'browser', 'group', 'note'].includes(kind)) {
            return failed('Choose a valid kind when creating a canvas node.');
        }
        const result = await clientActions.execute(
            'node.create',
            {
                viewId: current.view.id,
                kind,
                title: title ?? null,
                content: content ?? null,
                url: url ?? null,
                command: command ?? null
            },
            VOICE_ACTION_CALL
        );
        if (result.status !== 'completed') {
            return failureOf(result);
        }
        const labels = {
            terminal: 'terminal',
            chat: 'AI Chat',
            browser: 'browser',
            group: 'group',
            note: 'note',
            drawing: 'drawing',
            diagram: 'diagram',
            file: 'file',
            unknown: 'node'
        } as const;
        return ok(`Created ${labels[result.output.kind]} “${result.output.node}” in free space on “${result.output.view}”.`, result.output, {
            kind: result.output.kind === 'terminal' ? 'terminal' : result.output.kind === 'chat' ? 'chat' : result.output.kind === 'note' ? 'note' : 'node',
            label: `Added ${labels[result.output.kind]}`,
            detail: `${result.output.node} · ${result.output.view}`,
            ...undoAction(result.undoToken)
        });
    }
    if (action === 'fit') {
        const result = await clientActions.execute('canvas.fit', { viewId: current.view.id }, VOICE_ACTION_CALL);
        return result.status === 'completed'
            ? ok('Fitted all canvas content in view.', result.output, {
                  kind: 'focus',
                  label: 'Fit canvas',
                  detail: result.output.view
              })
            : failureOf(result);
    }
    if (action === 'undo' || action === 'redo') {
        const result = await clientActions.execute(action === 'undo' ? 'history.undo' : 'history.redo', { viewId: current.view.id }, VOICE_ACTION_CALL);
        return result.status === 'completed'
            ? ok(result.output.changed ? `${action === 'undo' ? 'Undid' : 'Redid'} the canvas change.` : `There was nothing to ${action}.`, result.output, {
                  kind: 'node',
                  label: action === 'undo' ? 'Undid canvas change' : 'Redid canvas change',
                  detail: result.output.view
              })
            : failureOf(result);
    }
    if (action === 'group_selection') {
        const nodeIds = current.canvas.selection.filter((id) => current.canvas.nodes[id]?.kind !== 'group');
        const result = await clientActions.execute('group.create', { viewId: current.view.id, nodeIds }, VOICE_ACTION_CALL);
        return result.status === 'completed'
            ? ok('Grouped the selected nodes.', result.output, {
                  kind: 'node',
                  label: 'Grouped selection',
                  detail: result.output.view,
                  ...undoAction(result.undoToken)
              })
            : failureOf(result);
    }
    const node = findNode(target ?? null);
    if (!node) {
        return failed(target === null ? 'Select exactly one node first.' : `No unique node matched “${target ?? ''}” on the active canvas.`);
    }
    if (action === 'focus_node') {
        const result = await clientActions.execute('node.focus', { viewId: current.view.id, nodeId: node.id }, VOICE_ACTION_CALL);
        return result.status === 'completed'
            ? ok(`Focused the node “${result.output.node}”.`, result.output, {
                  kind: 'focus',
                  label: 'Focused node',
                  detail: result.output.node
              })
            : failureOf(result);
    }
    if (action === 'rename_node' && name) {
        const result = await clientActions.execute('node.rename', { viewId: current.view.id, nodeId: node.id, name }, VOICE_ACTION_CALL);
        return result.status === 'completed'
            ? ok(`Renamed “${result.output.previousName}” to “${name}”.`, result.output, {
                  kind: 'rename',
                  label: 'Renamed node',
                  detail: `${result.output.previousName} → ${name}`,
                  ...undoAction(result.undoToken)
              })
            : failureOf(result);
    }
    if (action === 'duplicate_node') {
        const result = await clientActions.execute('node.duplicate', { viewId: current.view.id, nodeId: node.id }, VOICE_ACTION_CALL);
        return result.status === 'completed'
            ? ok(`Duplicated “${node.title}”.`, result.output, {
                  kind: 'node',
                  label: 'Duplicated node',
                  detail: node.title,
                  ...undoAction(result.undoToken)
              })
            : failureOf(result);
    }
    return failed('Choose a valid canvas action and provide its required arguments.');
};

const communicate = async (args: Record<string, unknown>): Promise<VoiceToolExecution> => {
    const action = stringArgument(args, 'action');
    const target = nullableStringArgument(args, 'chat');
    const prompt = stringArgument(args, 'prompt');
    if (action !== 'send_ai_chat' || target === undefined || !prompt) {
        return failed('The AI Chat target or prompt was invalid.');
    }
    const chat = findChat(target);
    if (!chat) {
        return failed(target === null ? 'Open an AI Chat view or select exactly one AI Chat node.' : `No unique AI Chat matched “${target}”.`);
    }
    const result = await clientActions.execute('chat.send', { chatId: chat.id, prompt }, VOICE_ACTION_CALL);
    if (result.status !== 'completed') {
        return failureOf(result);
    }
    return ok(`${result.output.queued ? 'Queued' : 'Submitted'} the prompt in “${result.output.chat}”.`, result.output, {
        kind: 'chat',
        label: result.output.queued ? 'Queued AI Chat prompt' : 'Prompted AI Chat',
        detail: `${result.output.chat}: ${prompt.slice(0, 120)}`
    });
};

export const executeVoiceTool = async (name: VoiceToolName, rawArguments: string): Promise<VoiceToolExecution> => {
    const args = objectArguments(rawArguments);
    if (!args) {
        return failed('The tool arguments were not valid JSON.');
    }
    if (name === 'inspect_workspace') {
        const result = await clientActions.execute('workspace.inspect', {}, VOICE_ACTION_CALL);
        return result.status === 'completed'
            ? ok('Read the current Ruimte workspace.', {
                  workspace: result.output
              })
            : failureOf(result);
    }
    if (name === 'manage_views') {
        return manageViews(args);
    }
    if (name === 'manage_canvas') {
        return manageCanvas(args);
    }
    if (name === 'communicate') {
        return communicate(args);
    }
    return failed(`Ruimte does not support the tool “${name}”.`);
};
