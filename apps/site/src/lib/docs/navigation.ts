export interface NavigationPage {
    title: string;
    href: string;
}

export interface NavigationSection {
    title: string;
    href: string;
    description: string;
    groups: { title: string; pages: NavigationPage[] }[];
}

/* Every page of the site, in reading order. A new part of the documentation is a new section here. */
export const SECTIONS: readonly NavigationSection[] = [
    {
        title: 'Guide',
        href: '/docs/guide',
        description: 'How Ruimte works and how to use it: projects, the canvas, agents in terminals and chats, files, launches, devices and your machines.',
        groups: [
            {
                title: 'Start',
                pages: [
                    { title: 'Introduction', href: '/docs/guide' },
                    { title: 'Install and first project', href: '/docs/guide/getting-started' }
                ]
            },
            {
                title: 'Workspace',
                pages: [
                    { title: 'Projects and views', href: '/docs/guide/projects-and-views' },
                    { title: 'The canvas', href: '/docs/guide/canvas' },
                    { title: 'Browsers and devices', href: '/docs/guide/browsers-and-devices' },
                    { title: 'Drawings and diagrams', href: '/docs/guide/drawings' }
                ]
            },
            {
                title: 'Agents',
                pages: [
                    { title: 'Terminals', href: '/docs/guide/terminals' },
                    { title: 'AI chats', href: '/docs/guide/chats' },
                    { title: 'Needs you', href: '/docs/guide/attention' },
                    { title: 'Plans, forks and visuals', href: '/docs/guide/plans-and-forks' },
                    { title: 'Agents working together', href: '/docs/guide/delegation' },
                    { title: 'Computer use', href: '/docs/guide/computer-use' }
                ]
            },
            {
                title: 'Project tools',
                pages: [
                    { title: 'Files and the editor', href: '/docs/guide/files' },
                    { title: 'Git and worktrees', href: '/docs/guide/git' },
                    { title: 'Launches', href: '/docs/guide/launches' },
                    { title: 'Routines and Output', href: '/docs/guide/routines' },
                    { title: 'Databases', href: '/docs/guide/databases' }
                ]
            },
            {
                title: 'Machines',
                pages: [
                    { title: 'Your account and machines', href: '/docs/guide/machines' },
                    { title: 'Phone and web', href: '/docs/guide/phone-and-web' },
                    { title: 'Work on another machine', href: '/docs/guide/other-machines' },
                    { title: 'A machine without a screen', href: '/docs/guide/headless' },
                    { title: 'Tunnels', href: '/docs/guide/tunnels' }
                ]
            },
            {
                title: 'More',
                pages: [
                    { title: 'Voice', href: '/docs/guide/voice' },
                    { title: 'Settings', href: '/docs/guide/settings' },
                    { title: 'Keyboard shortcuts', href: '/docs/guide/shortcuts' }
                ]
            }
        ]
    },
    {
        title: 'Extensions',
        href: '/docs/extensions',
        description: 'Add panels, nodes, commands, themes and agent tools to Ruimte.',
        groups: [
            {
                title: 'Start',
                pages: [
                    { title: 'Overview', href: '/docs/extensions' },
                    { title: 'Getting started', href: '/docs/extensions/getting-started' },
                    { title: 'The manifest', href: '/docs/extensions/manifest' }
                ]
            },
            {
                title: 'How to',
                pages: [
                    { title: 'Open a panel', href: '/docs/extensions/how-to/panel' },
                    { title: 'Add a node', href: '/docs/extensions/how-to/node' },
                    { title: 'Add a button', href: '/docs/extensions/how-to/button' },
                    { title: 'Add a command', href: '/docs/extensions/how-to/command' },
                    { title: 'Add a settings page', href: '/docs/extensions/how-to/settings' },
                    { title: 'Server and secrets', href: '/docs/extensions/how-to/server' },
                    { title: 'Give agents a tool', href: '/docs/extensions/how-to/agent-tool' },
                    { title: 'When an agent finishes', href: '/docs/extensions/how-to/agent' },
                    { title: 'Make a theme', href: '/docs/extensions/how-to/theme' }
                ]
            },
            {
                title: 'Build',
                pages: [
                    { title: 'Surfaces', href: '/docs/extensions/surfaces' },
                    { title: 'Slots and actions', href: '/docs/extensions/slots' },
                    { title: 'Styling', href: '/docs/extensions/styling' },
                    { title: 'Themes', href: '/docs/extensions/themes' },
                    { title: 'Settings and storage', href: '/docs/extensions/settings' },
                    { title: 'Events', href: '/docs/extensions/events' }
                ]
            },
            {
                title: 'Work with Ruimte',
                pages: [
                    { title: 'The project and the machine', href: '/docs/extensions/machine' },
                    { title: 'Chats and agents', href: '/docs/extensions/chats-and-agents' },
                    { title: 'The server part', href: '/docs/extensions/server' }
                ]
            },
            {
                title: 'Ship',
                pages: [{ title: 'Testing and packing', href: '/docs/extensions/testing' }]
            },
            {
                title: 'Reference',
                pages: [
                    { title: '@ruimte/extension/client', href: '/docs/extensions/reference/client' },
                    { title: '@ruimte/extension/server', href: '/docs/extensions/reference/server' },
                    { title: '@ruimte/extension/ui', href: '/docs/extensions/reference/ui' },
                    { title: '@ruimte/extension/charts', href: '/docs/extensions/reference/charts' },
                    { title: '@ruimte/extension/agents-ui', href: '/docs/extensions/reference/agents-ui' },
                    { title: '@ruimte/extension/testing', href: '/docs/extensions/reference/testing' },
                    { title: 'Changes to the API', href: '/docs/extensions/changelog' }
                ]
            }
        ]
    }
];

export function pagesOf(section: NavigationSection): NavigationPage[] {
    return section.groups.flatMap((group) => group.pages);
}

/* The pages before and after this one, for the links at the bottom of a page. */
export function neighborsOf(href: string): { previous: NavigationPage | null; next: NavigationPage | null } {
    for (const section of SECTIONS) {
        const pages = pagesOf(section);
        const index = pages.findIndex((page) => page.href === href);

        if (index !== -1) {
            return { previous: pages[index - 1] ?? null, next: pages[index + 1] ?? null };
        }
    }

    return { previous: null, next: null };
}
