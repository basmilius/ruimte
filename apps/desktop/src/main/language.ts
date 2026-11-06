import type { DesktopIpc } from './ipc';

export interface InterfaceLanguage {
    /* The language the page last reported, or null before any page did. */
    current(): string | null;
}

/* The page's interface language, for what the shell writes itself: the quit question and dialog filters. */
export function installLanguage(ipc: DesktopIpc): InterfaceLanguage {
    let language: string | null = null;

    ipc.on('app:language', (_event, next: unknown) => {
        if (next === 'en' || next === 'nl') {
            language = next;
        }
    });

    return {
        current: () => language
    };
}
