/*
 * One file per surface, per language, so two people never write in the same file. A namespace is the
 * folder a component lives in, with `shell` split up because it holds nearly half the interface on its own.
 */
export const NAMESPACES = [
    'common',
    'settings',
    'panels',
    'usage',
    'models',
    'shell',
    'chat',
    'canvas',
    'plan',
    'voice',
    'project',
    'machines',
    'browser',
    'drawing',
    'prompts',
    'processes',
    'agents',
    'conflicts',
    'computer',
    'onboarding',
    'state',
    'launches',
    'databases',
    'inline-edit',
    'output',
    'routines'
] as const;
