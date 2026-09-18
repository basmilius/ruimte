import { isCanvasView, isOpenableView, type ProjectNode, type ProjectView, type VoiceToolName } from '@ruimte/contracts';
import type { ActionName, ActionOutput, ActionResult } from '@ruimte/actions';
import { clientActions, VOICE_ACTION_CALL } from '@/actions/client-actions';
import { intersects, visibleRect } from '@/canvas/math';
import { focusedCanvas, type CanvasState } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useSettings } from '@/state/settings';
import type { VoiceChatFollowUp } from '@/voice/chat-follow-up';
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
    followUp?: VoiceChatFollowUp;
}

const ok = (message: string, data: Record<string, unknown> = {}, action?: ToolAction): VoiceToolExecution => ({
    output: { ok: true, message, ...data },
    ...(action ? { action } : {})
});

const failed = (message: string, data: Record<string, unknown> = {}): VoiceToolExecution => ({
    output: { ok: false, message, ...data }
});

const normalized = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

type NamedMatch<T> = { status: 'found'; value: T } | { status: 'missing' } | { status: 'ambiguous'; candidates: T[] };

const named = <T>(name: string, values: T[], label: (value: T) => string): NamedMatch<T> => {
    const target = normalized(name);
    const exact = values.filter((value) => normalized(label(value)) === target);
    if (exact.length === 1) {
        return { status: 'found', value: exact[0]! };
    }
    if (exact.length > 1) {
        return { status: 'ambiguous', candidates: exact };
    }
    if (target === '') {
        return { status: 'missing' };
    }
    const candidates = values.filter((value) => normalized(label(value)).includes(target) || target.includes(normalized(label(value))));
    return candidates.length === 1
        ? { status: 'found', value: candidates[0]! }
        : candidates.length > 1
          ? { status: 'ambiguous', candidates }
          : { status: 'missing' };
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

const booleanArgument = (args: Record<string, unknown>, name: string): boolean | undefined => (typeof args[name] === 'boolean' ? args[name] : undefined);

const nullableStringsArgument = (args: Record<string, unknown>, name: string): string[] | null | undefined => {
    if (args[name] === null) {
        return null;
    }
    if (!Array.isArray(args[name]) || args[name].some((value) => typeof value !== 'string' || value.trim() === '')) {
        return undefined;
    }
    return (args[name] as string[]).map((value) => value.trim());
};

const nullableIntegerArgument = (args: Record<string, unknown>, name: string): number | null | undefined =>
    args[name] === null ? null : typeof args[name] === 'number' && Number.isInteger(args[name]) ? args[name] : undefined;

const activeCanvas = () => {
    const active = activeViewOf(useDocument.getState());
    return active && isCanvasView(active) ? { view: active, canvas: focusedCanvas().getState() } : null;
};

const findView = (name: string | null): NamedMatch<ProjectView> => {
    const document = useDocument.getState();
    const active = activeViewOf(document);
    return name === null
        ? active
            ? { status: 'found', value: active }
            : { status: 'missing' }
        : named(name, document.views.filter(isOpenableView), (view) => view.name ?? '');
};

const findNode = (name: string | null): NamedMatch<ProjectNode> => {
    const current = activeCanvas();
    if (!current) {
        return { status: 'missing' };
    }
    if (name === null) {
        const selected = current.canvas.selection.length === 1 ? current.canvas.nodes[current.canvas.selection[0]!] : undefined;
        return selected ? { status: 'found', value: selected } : { status: 'missing' };
    }
    return named(name, Object.values(current.canvas.nodes), (node) => node.title);
};

const findChat = (name: string | null): NamedMatch<{ id: string; title: string }> => {
    const document = useDocument.getState();
    const active = activeViewOf(document);
    const canvas = activeCanvas();
    if (name === null) {
        if (active?.kind === 'chat') {
            return { status: 'found', value: { id: active.id, title: active.name } };
        }
        if (canvas) {
            const selected = canvas.canvas.selection.map((id) => canvas.canvas.nodes[id]).filter((node) => node?.kind === 'chat');
            return selected.length === 1 ? { status: 'found', value: { id: selected[0]!.id, title: selected[0]!.title } } : { status: 'missing' };
        }
        return { status: 'missing' };
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

const failureOf = (result: ActionResult): VoiceToolExecution =>
    result.status === 'needs_confirmation'
        ? failed('Ask the user to confirm or cancel this action before continuing.', {
              needs_confirmation: true,
              confirmation_token: result.confirmationToken,
              confirmation: result.confirmation
          })
        : failed(result.status === 'failed' && result.error ? result.error.message : 'The action could not be completed.');

const applyDeletionPreference = async <Name extends ActionName>(pending: Promise<ActionResult<Name>>): Promise<ActionResult<Name>> => {
    const result = await pending;
    if (result.status !== 'needs_confirmation' || useSettings.getState().voiceConfirmDestructiveActions) {
        return result;
    }
    return (await clientActions.confirm(result.confirmationToken, true, VOICE_ACTION_CALL)) as ActionResult<Name>;
};

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
    const matched = findView(target ?? null);
    if (matched.status === 'ambiguous') {
        return failed(`More than one view matched “${target ?? ''}”. Ask which one the user means.`, {
            candidates: matched.candidates.map((view) => ({ id: view.id, name: view.name, kind: view.kind }))
        });
    }
    if (matched.status === 'missing') {
        return failed(target === null ? 'There is no active view.' : `No view matched “${target ?? ''}”.`);
    }
    const view = matched.value;
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
    if (action === 'delete') {
        const result = await applyDeletionPreference(clientActions.execute('view.delete', { viewId: view.id }, VOICE_ACTION_CALL));
        return result.status === 'completed'
            ? ok(`Deleted “${result.output.view}”.`, result.output, {
                  kind: 'delete',
                  label: 'Deleted view',
                  detail: result.output.view
              })
            : failureOf(result);
    }
    return failed('Choose focus, create, rename or delete and provide the required view arguments.');
};

type NodeSet = { nodes: ProjectNode[] } | { failure: VoiceToolExecution };

const nodesInScope = (canvas: CanvasState, scope: string | null): ProjectNode[] => {
    if (scope === 'selected' || scope === null) {
        return canvas.selection.map((id) => canvas.nodes[id]).filter((node): node is ProjectNode => node !== undefined);
    }
    const nodes = Object.values(canvas.nodes).filter((node) => !canvas.hidden.has(node.id));
    if (scope === 'visible') {
        const viewport = visibleRect(canvas.camera, canvas.viewport);
        return nodes.filter((node) => intersects(node, viewport));
    }
    return nodes;
};

const matchNodeSet = (canvas: CanvasState, names: string[] | null, kind: string | null, scope: string | null): NodeSet => {
    const source = nodesInScope(canvas, names === null ? scope : (scope ?? 'all')).filter((node) => kind === null || node.kind === kind);
    if (names !== null) {
        const matches: ProjectNode[] = [];
        for (const name of names) {
            const match = named(name, source, (node) => node.title);
            if (match.status === 'ambiguous') {
                return {
                    failure: failed(`More than one node matched “${name}”. Ask which one the user means.`, {
                        candidates: match.candidates.map((node) => ({ id: node.id, name: node.title, kind: node.kind }))
                    })
                };
            }
            if (match.status === 'missing') {
                return { failure: failed(`No node matched “${name}” in the requested scope.`) };
            }
            matches.push(match.value);
        }
        return { nodes: [...new Map(matches.map((node) => [node.id, node])).values()] };
    }
    return { nodes: source };
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
    const names = nullableStringsArgument(args, 'nodes');
    const scope = nullableStringArgument(args, 'scope');
    if (
        target === undefined ||
        kind === undefined ||
        name === undefined ||
        title === undefined ||
        content === undefined ||
        url === undefined ||
        command === undefined ||
        names === undefined ||
        scope === undefined
    ) {
        return failed('The canvas arguments were invalid.');
    }
    if (scope !== null && !['selected', 'visible', 'all'].includes(scope)) {
        return failed('Choose selected, visible or all as the canvas scope.');
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
    if (action === 'select_nodes' || action === 'group_nodes' || action === 'delete_nodes') {
        const matched = matchNodeSet(current.canvas, names ?? null, kind ?? null, scope ?? null);
        if ('failure' in matched) {
            return matched.failure;
        }
        const nodes = action === 'group_nodes' ? matched.nodes.filter((node) => node.kind !== 'group') : matched.nodes;
        if (nodes.length === 0) {
            return failed('No nodes matched the requested names, kind and scope.');
        }
        const nodeIds = nodes.map((node) => node.id);
        if (action === 'select_nodes') {
            const result = await clientActions.execute('canvas.select', { viewId: current.view.id, nodeIds }, VOICE_ACTION_CALL);
            return result.status === 'completed'
                ? ok(`Selected ${nodeIds.length} ${nodeIds.length === 1 ? 'node' : 'nodes'}.`, result.output, {
                      kind: 'node',
                      label: 'Selected nodes',
                      detail: result.output.nodes.join(', ')
                  })
                : failureOf(result);
        }
        if (action === 'group_nodes') {
            const result = await clientActions.execute('group.create', { viewId: current.view.id, nodeIds }, VOICE_ACTION_CALL);
            return result.status === 'completed'
                ? ok(`Grouped ${nodeIds.length} ${nodeIds.length === 1 ? 'node' : 'nodes'}.`, result.output, {
                      kind: 'node',
                      label: 'Grouped nodes',
                      detail: nodes.map((node) => node.title).join(', '),
                      ...undoAction(result.undoToken)
                  })
                : failureOf(result);
        }
        const result = await applyDeletionPreference(clientActions.execute('node.delete', { viewId: current.view.id, nodeIds }, VOICE_ACTION_CALL));
        return result.status === 'completed'
            ? ok(`Deleted ${nodeIds.length} ${nodeIds.length === 1 ? 'node' : 'nodes'}.`, result.output, {
                  kind: 'delete',
                  label: 'Deleted nodes',
                  detail: nodes.map((node) => node.title).join(', '),
                  ...undoAction(result.undoToken)
              })
            : failureOf(result);
    }
    const matched = findNode(target ?? null);
    if (matched.status === 'ambiguous') {
        return failed(`More than one node matched “${target ?? ''}”. Ask which one the user means.`, {
            candidates: matched.candidates.map((node) => ({ id: node.id, name: node.title, kind: node.kind }))
        });
    }
    if (matched.status === 'missing') {
        return failed(target === null ? 'Select exactly one node first.' : `No node matched “${target ?? ''}” on the active canvas.`);
    }
    const node = matched.value;
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
    const prompt = nullableStringArgument(args, 'prompt');
    const limit = nullableIntegerArgument(args, 'limit');
    const notifyOnCompletion = booleanArgument(args, 'notify_on_completion');
    if (!action || target === undefined || prompt === undefined || limit === undefined || notifyOnCompletion === undefined) {
        return failed('The AI Chat action arguments were invalid.');
    }
    const matched = findChat(target);
    if (matched.status === 'ambiguous') {
        return failed(`More than one AI Chat matched “${target ?? ''}”. Ask which one the user means.`, {
            candidates: matched.candidates
        });
    }
    if (matched.status === 'missing') {
        return failed(target === null ? 'Open an AI Chat view or select exactly one AI Chat node.' : `No AI Chat matched “${target}”.`);
    }
    const chat = matched.value;
    if (action === 'read_ai_chat') {
        const count = limit ?? 20;
        if (count < 1 || count > 20) {
            return failed('Read between 1 and 20 recent AI Chat messages.');
        }
        const result = await clientActions.execute('chat.read', { chatId: chat.id, limit: count }, VOICE_ACTION_CALL);
        return result.status === 'completed'
            ? ok(`Read ${result.output.messages.length} recent messages from “${result.output.chat}”.`, result.output)
            : failureOf(result);
    }
    if (action !== 'send_ai_chat' || !prompt) {
        return failed('Provide a direct prompt when sending to AI Chat.');
    }
    const result = await clientActions.execute('chat.send', { chatId: chat.id, prompt }, VOICE_ACTION_CALL);
    if (result.status !== 'completed') {
        return failureOf(result);
    }
    const cannotFollow = notifyOnCompletion && result.output.turnId === undefined;
    const execution = ok(
        `${result.output.queued ? 'Queued' : 'Submitted'} the prompt in “${result.output.chat}”.${cannotFollow ? ' Update Ruimte on this machine before asking for a completion notification.' : ''}`,
        result.output,
        {
            kind: 'chat',
            label: result.output.queued ? 'Queued AI Chat prompt' : 'Prompted AI Chat',
            detail: `${result.output.chat}: ${prompt.slice(0, 120)}`
        }
    );
    return notifyOnCompletion && result.output.turnId !== undefined
        ? {
              ...execution,
              followUp: {
                  key: endpointKey(currentEndpointId(), chat.id),
                  chat: result.output.chat,
                  turnId: result.output.turnId
              }
          }
        : execution;
};

const controlAction = async (args: Record<string, unknown>): Promise<VoiceToolExecution> => {
    const action = stringArgument(args, 'action');
    const token = stringArgument(args, 'confirmation_token');
    if (!token || (action !== 'confirm' && action !== 'cancel')) {
        return failed('Choose confirm or cancel and provide the confirmation token.');
    }
    const result = await clientActions.confirm(token, action === 'confirm', VOICE_ACTION_CALL);
    if (result.status !== 'completed') {
        return failureOf(result);
    }
    if (result.action === 'view.delete') {
        const output = result.output as ActionOutput<'view.delete'>;
        return ok(`Deleted “${output.view}”.`, output, {
            kind: 'delete',
            label: 'Deleted view',
            detail: output.view
        });
    }
    if (result.action === 'node.delete') {
        const output = result.output as ActionOutput<'node.delete'>;
        return ok(`Deleted ${output.nodeIds.length} ${output.nodeIds.length === 1 ? 'node' : 'nodes'}.`, output, {
            kind: 'delete',
            label: 'Deleted nodes',
            detail: output.nodes.join(', '),
            ...undoAction(result.undoToken)
        });
    }
    return ok('Confirmed the action.', result.output);
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
    if (name === 'control_action') {
        return controlAction(args);
    }
    return failed(`Ruimte does not support the tool “${name}”.`);
};
