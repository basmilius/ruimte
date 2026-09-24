/*
 * One file per surface, per language, so two people never write in the same file and a bundle only
 * carries the words of the screens it draws. A namespace is the folder a component lives in, with
 * `shell` split up because it holds nearly half the interface on its own.
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
    'state'
] as const;

export type Namespace = (typeof NAMESPACES)[number];
