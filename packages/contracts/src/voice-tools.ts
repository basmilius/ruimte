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
        description: 'Focus, create, rename or request deletion of a Ruimte view.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['focus', 'create', 'rename', 'delete'] },
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
        description:
            'Focus, rename, create, duplicate, select, group or request deletion of canvas nodes. Node sets can be matched by spoken names, kind and whether they are selected, visible or anywhere on the canvas.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: [
                        'focus_node',
                        'rename_node',
                        'create_node',
                        'duplicate_node',
                        'select_nodes',
                        'group_nodes',
                        'group_selection',
                        'delete_nodes',
                        'fit',
                        'undo',
                        'redo'
                    ]
                },
                node: {
                    type: ['string', 'null'],
                    description: 'Node title. Use null for the single selected node.'
                },
                kind: {
                    type: ['string', 'null'],
                    enum: ['terminal', 'chat', 'browser', 'group', 'note', 'drawing', 'diagram', 'file', null]
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
                },
                nodes: {
                    type: ['array', 'null'],
                    items: { type: 'string' },
                    description: 'Spoken node names to match. Preserve the user’s wording. Use null when selecting by kind or scope.'
                },
                scope: {
                    type: ['string', 'null'],
                    enum: ['selected', 'visible', 'all', null],
                    description: 'Where to find nodes. Visible means intersecting the current viewport. Null defaults to selected nodes.'
                }
            },
            required: ['action', 'node', 'kind', 'name', 'title', 'content', 'url', 'command', 'nodes', 'scope'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'communicate',
        description:
            'Submit a direct prompt to an AI Chat, or read a limited recent excerpt when the user explicitly asks. Reading never includes reasoning or tool output.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['send_ai_chat', 'read_ai_chat'] },
                chat: {
                    type: ['string', 'null'],
                    description: 'AI Chat view or node name. Use null for the active or single selected chat.'
                },
                prompt: {
                    type: ['string', 'null'],
                    description: 'The direct prompt to submit, or null when reading.'
                },
                limit: {
                    type: ['integer', 'null'],
                    minimum: 1,
                    maximum: 20,
                    description: 'Recent message count when reading. Use null for the default of 20.'
                },
                notify_on_completion: {
                    type: 'boolean',
                    description: 'True only when the user asks Voice to report the result after the AI Chat finishes.'
                }
            },
            required: ['action', 'chat', 'prompt', 'limit', 'notify_on_completion'],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: 'function',
        name: 'control_action',
        description:
            'Confirm or cancel a destructive Ruimte action after the user answers the confirmation question. Never confirm during the same turn that first requested deletion.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['confirm', 'cancel'] },
                confirmation_token: { type: 'string' }
            },
            required: ['action', 'confirmation_token'],
            additionalProperties: false
        },
        strict: true
    }
] as const;

export type VoiceToolName = (typeof VOICE_TOOL_DEFINITIONS)[number]['name'];
