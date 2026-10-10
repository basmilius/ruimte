import {
    evaluateUiBlock,
    UiBlockSchema,
    uiInputValues,
    uiLinkTargets,
    UiState,
    UiFailure,
    UI_CATALOG_VERSION,
    type UiLimits,
    uiValidatedState,
    type UiViewNode
} from '@adecore/intelligent-ui';

export interface NativeUiRequest {
    block: unknown;
    values?: Record<string, unknown>;
    queries?: Record<string, unknown>;
    change?: { nodeId: string; prop: string; value: unknown };
    action?: { nodeId: string };
}

// JavaScriptCore runs without a JIT on an older iPhone, so wall-clock time is looser here; steps still bound the work.
const NATIVE_LIMITS: Partial<UiLimits> = { milliseconds: 250 };

function boundedTree(value: unknown, depth = 0, remaining = { count: 10000 }): void {
    if (depth > 96 || --remaining.count < 0) {
        throw new UiFailure('budget_exceeded', 'The native UI input exceeded its structure budget.');
    }
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) {
            boundedTree(child, depth + 1, remaining);
        }
    }
}

export function evaluateNativeUi(request: NativeUiRequest): Record<string, unknown> {
    boundedTree(request);
    const block = UiBlockSchema.parse(request.block);
    const state = new UiState(block, NATIVE_LIMITS);
    const supported = block.catalogVersion === UI_CATALOG_VERSION;
    if (supported) {
        for (const [name, value] of Object.entries(request.queries ?? {})) {
            state.setQuery(name, value, block);
        }
        const allowed = uiInputValues(block, state);
        for (const [name, value] of Object.entries(request.values ?? {})) {
            if (!Object.hasOwn(allowed, name)) {
                throw new UiFailure('refused_binding', 'Only declared local input bindings can be changed.');
            }
            state.set(name, value);
        }
    }
    let evaluated = evaluateUiBlock(block, state, NATIVE_LIMITS);
    const find = (nodes: readonly UiViewNode[], id: string): UiViewNode | undefined => {
        for (const node of nodes) {
            if (node.id === id) {
                return node;
            }
            const child = find(node.children, id);
            if (child) {
                return child;
            }
        }
    };
    if (request.change || request.action) {
        if (!supported || !block.complete) {
            throw new UiFailure('refused_binding', 'Only a completed supported block can accept local input.');
        }
        if (request.change) {
            const node = find(evaluated.nodes, request.change.nodeId);
            const binding = node?.bindings[request.change.prop];
            if (!node?.complete || node.error || !binding) {
                throw new UiFailure('refused_binding', 'The local input is not available.');
            }
            binding.onValueChange(request.change.value);
        } else {
            const node = find(evaluated.nodes, request.action!.nodeId);
            if (!node?.complete || node.error || !node.onAction || node.props.disabled === true) {
                throw new UiFailure('refused_action', 'The local action is not available.');
            }
            node.onAction();
        }
        // Membership of Segmented and Checklist values is checked against the visible controls as well.
        uiValidatedState(block, uiInputValues(block, state), request.queries, NATIVE_LIMITS);
        evaluated = evaluateUiBlock(block, state, NATIVE_LIMITS);
    }
    const nodes = (input: readonly UiViewNode[]): Record<string, unknown>[] =>
        input.map((node) => ({
            ...node,
            bindings: Object.fromEntries(Object.entries(node.bindings).map(([prop, binding]) => [prop, { value: binding.value }])),
            children: nodes(node.children)
        }));
    let links = {};
    if (supported && block.complete) {
        links = uiLinkTargets(block, uiInputValues(block, state), request.queries, NATIVE_LIMITS);
    }
    return { nodes: nodes(evaluated.nodes), diagnostics: evaluated.diagnostics, values: uiInputValues(block, state), links };
}

export function nativeUiJson(json: string): string {
    if (json.length > 1024 * 1024) {
        throw new UiFailure('budget_exceeded', 'The native UI input is too large.');
    }
    const result = JSON.stringify(evaluateNativeUi(JSON.parse(json)));
    if (result.length > 1024 * 1024) {
        throw new UiFailure('budget_exceeded', 'The native UI result is too large.');
    }
    return result;
}
