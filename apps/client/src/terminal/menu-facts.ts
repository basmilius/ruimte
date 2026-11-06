import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { terminalHasFind, terminalHasKeyboard } from '@/terminal/xterm';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* A terminal has the keyboard, which takes the clear key for itself (`terminal/xterm.ts`). */
        terminalKeys: boolean;
        /* That terminal has a find bar, which answers the find key. */
        terminalFind: boolean;
    }
}

export function terminalFacts(_host: MenuHost): Pick<MenuFacts, 'terminalKeys' | 'terminalFind'> {
    return { terminalKeys: terminalHasKeyboard(), terminalFind: terminalHasFind() };
}
