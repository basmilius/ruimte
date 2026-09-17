export const VOICE_TOOL_DEFINITIONS = [
    {
        type: 'function',
        name: 'inspect_workspace',
        description: 'Read the current Ruimte project, active view, available views, canvas nodes and selection before choosing another tool.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: true
    },
    {
        type: 'function',
        name: 'focus_view',
        description: 'Focus an existing Ruimte view by its visible name.',
        parameters: {
            type: 'object',
            properties: { view: { type: 'string', description: 'The visible view name.' } },
            required: ['view'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'create_view',
        description: 'Create and focus a new canvas, drawing, diagram, terminal, browser or AI Chat view.',
        parameters: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['canvas', 'drawing', 'diagram', 'terminal', 'browser', 'chat'] },
                name: { type: ['string', 'null'], description: 'Optional name. Use null for the default name.' },
                url: { type: ['string', 'null'], description: 'Initial browser URL, or null for other view kinds.' },
                command: { type: ['string', 'null'], description: 'Initial terminal command, or null for other view kinds.' }
            },
            required: ['kind', 'name', 'url', 'command'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'rename_view',
        description: 'Rename an existing view. Pass null to rename the currently active view.',
        parameters: {
            type: 'object',
            properties: {
                view: { type: ['string', 'null'], description: 'The current view name, or null for the active view.' },
                name: { type: 'string', description: 'The new view name.' }
            },
            required: ['view', 'name'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'focus_node',
        description: 'Select and focus one node on the active canvas by its visible title.',
        parameters: {
            type: 'object',
            properties: { node: { type: 'string', description: 'The visible node title.' } },
            required: ['node'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'rename_node',
        description: 'Rename one node on the active canvas. Pass null to use the single selected node.',
        parameters: {
            type: 'object',
            properties: {
                node: { type: ['string', 'null'], description: 'The current node title, or null for the selected node.' },
                name: { type: 'string', description: 'The new node title.' }
            },
            required: ['node', 'name'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'create_canvas_node',
        description: 'Create a terminal, AI chat, browser, group or note in free space on the active canvas.',
        parameters: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['terminal', 'chat', 'browser', 'group', 'note'] },
                title: { type: ['string', 'null'], description: 'Optional visible title.' },
                content: { type: ['string', 'null'], description: 'Note body or null for other node kinds.' },
                url: { type: ['string', 'null'], description: 'Browser URL or null for other node kinds.' },
                command: { type: ['string', 'null'], description: 'Initial terminal command or null.' }
            },
            required: ['kind', 'title', 'content', 'url', 'command'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'prompt_ai_chat',
        description: 'Submit a direct prompt to an AI Chat. The prompt must contain what the target agent should do, without phrases such as ask the chat.',
        parameters: {
            type: 'object',
            properties: {
                chat: { type: ['string', 'null'], description: 'AI Chat view or node name. Use null for the active view or single selected chat node.' },
                prompt: { type: 'string', description: 'The direct prompt to submit.' }
            },
            required: ['chat', 'prompt'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'control_canvas',
        description: 'Control the active canvas or its current selection.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['fit', 'undo', 'redo', 'group_selection', 'duplicate_selection'] }
            },
            required: ['action'],
            additionalProperties: false
        },
        strict: true
    }
] as const;

export type VoiceToolName = (typeof VOICE_TOOL_DEFINITIONS)[number]['name'];
