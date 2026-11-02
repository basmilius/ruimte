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
