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
        href: '/guide',
        description: 'How Ruimte works and how to use it: projects, the canvas, agents in terminals and chats, files, launches, devices and your machines.',
        groups: [
            {
                title: 'Start',
                pages: [
                    { title: 'What Ruimte is', href: '/guide' },
                    { title: 'Install and first project', href: '/guide/getting-started' }
                ]
            },
            {
                title: 'Workspace',
                pages: [
                    { title: 'Projects and views', href: '/guide/projects-and-views' },
                    { title: 'The canvas', href: '/guide/canvas' },
                    { title: 'Drawings and diagrams', href: '/guide/drawings' }
                ]
            },
            {
                title: 'Agents',
                pages: [
                    { title: 'Terminals', href: '/guide/terminals' },
                    { title: 'AI chats', href: '/guide/chats' },
                    { title: 'Plans, forks and visuals', href: '/guide/plans-and-forks' },
                    { title: 'Agents working together', href: '/guide/delegation' },
                    { title: 'Needs you', href: '/guide/attention' }
                ]
            },
            {
                title: 'Project tools',
                pages: [
                    { title: 'Files and the editor', href: '/guide/files' },
                    { title: 'Git and worktrees', href: '/guide/git' },
                    { title: 'Launches', href: '/guide/launches' },
                    { title: 'Routines and Output', href: '/guide/routines' },
                    { title: 'Databases', href: '/guide/databases' },
                    { title: 'Browsers and devices', href: '/guide/browsers-and-devices' },
                    { title: 'Computer use', href: '/guide/computer-use' }
                ]
            },
            {
                title: 'Machines',
                pages: [
                    { title: 'Your account and machines', href: '/guide/machines' },
                    { title: 'A machine without a screen', href: '/guide/headless' },
                    { title: 'Work on another machine', href: '/guide/other-machines' },
                    { title: 'Phone and web', href: '/guide/phone-and-web' }
                ]
            },
            {
                title: 'More',
                pages: [
                    { title: 'Voice', href: '/guide/voice' },
                    { title: 'Settings', href: '/guide/settings' },
                    { title: 'Keyboard shortcuts', href: '/guide/shortcuts' }
                ]
            }
        ]
    },
    {
        title: 'Extensions',
        href: '/extensions',
        description: 'Add panels, nodes, commands, themes and agent tools to Ruimte, with a process on the machine when you need one.',
        groups: [
            {
                title: 'Start',
                pages: [
                    { title: 'Overview', href: '/extensions' },
                    { title: 'Your first extension', href: '/extensions/getting-started' },
                    { title: 'The manifest', href: '/extensions/manifest' }
                ]
            },
            {
                title: 'Guides',
                pages: [
                    { title: 'Surfaces', href: '/extensions/surfaces' },
                    { title: 'Slots and actions', href: '/extensions/slots' },
                    { title: 'Chats and agents', href: '/extensions/chats-and-agents' },
                    { title: 'The project and the machine', href: '/extensions/machine' },
                    { title: 'The server part', href: '/extensions/server' },
                    { title: 'Themes', href: '/extensions/themes' },
                    { title: 'Testing and packing', href: '/extensions/testing' }
                ]
            },
            {
                title: 'Reference',
                pages: [
                    { title: '@ruimte/extension/client', href: '/extensions/reference/client' },
                    { title: '@ruimte/extension/server', href: '/extensions/reference/server' },
                    { title: '@ruimte/extension/ui', href: '/extensions/reference/ui' },
                    { title: '@ruimte/extension/testing', href: '/extensions/reference/testing' }
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
