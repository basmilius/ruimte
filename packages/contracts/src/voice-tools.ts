export const VOICE_TOOL_DEFINITIONS = [
    {
        type: 'function',
        name: 'inspect_workspace',
        description: 'Read the current Ruimte project, active view, views, active canvas nodes and selection before choosing an action.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'manage_views',
        description: 'Focus, create or rename a Ruimte view.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['focus', 'create', 'rename'] },
                view: {
                    type: ['string', 'null'],
                    description: 'Existing view name. Use null for the active view or when creating.'
                },
                kind: {
                    type: ['string', 'null'],
                    enum: ['canvas', 'drawing', 'diagram', 'terminal', 'browser', 'chat', null]
                },
                name: {
                    type: ['string', 'null'],
                    description: 'New view name, or null for a generated name.'
                },
                url: {
                    type: ['string', 'null'],
                    description: 'Initial browser URL when creating a browser.'
                },
                command: {
                    type: ['string', 'null'],
                    description: 'Initial terminal command when creating a terminal.'
                }
            },
            required: ['action', 'view', 'kind', 'name', 'url', 'command'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'manage_canvas',
        description: 'Focus, rename, create, duplicate or group nodes, fit the canvas, or undo and redo canvas changes.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['focus_node', 'rename_node', 'create_node', 'duplicate_node', 'group_selection', 'fit', 'undo', 'redo']
                },
                node: {
                    type: ['string', 'null'],
                    description: 'Node title. Use null for the single selected node.'
                },
                kind: {
                    type: ['string', 'null'],
                    enum: ['terminal', 'chat', 'browser', 'group', 'note', null]
                },
                name: {
                    type: ['string', 'null'],
                    description: 'New node name when renaming.'
                },
                title: {
                    type: ['string', 'null'],
                    description: 'Optional title for a new node.'
                },
                content: {
                    type: ['string', 'null'],
                    description: 'Complete note body for a new note.'
                },
                url: {
                    type: ['string', 'null'],
                    description: 'Browser URL for a new browser node.'
                },
                command: {
                    type: ['string', 'null'],
                    description: 'Initial command for a new terminal node.'
                }
            },
            required: ['action', 'node', 'kind', 'name', 'title', 'content', 'url', 'command'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'communicate',
        description: 'Submit a direct prompt to an AI Chat. Do not include meta-language such as ask the chat; send the request itself.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['send_ai_chat'] },
                chat: {
                    type: ['string', 'null'],
                    description: 'AI Chat view or node name. Use null for the active or single selected chat.'
                },
                prompt: {
                    type: 'string',
                    description: 'The direct prompt to submit.'
                }
            },
            required: ['action', 'chat', 'prompt'],
            additionalProperties: false
        },
        strict: true
    }
] as const;

export type VoiceToolName = (typeof VOICE_TOOL_DEFINITIONS)[number]['name'];
