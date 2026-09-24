/*
 * The application menu, built by the client from what has the focus and drawn by the shell as a
 * native menu. The shell only knows these shapes and the fixed lists below; a click on a command
 * comes back as its id, and the client runs it.
 */

/* The native roles the shell accepts. Each still carries a label from the client, so the whole menu
   is in the language of the interface and not half in the system's. */
export const MENU_ROLES = [
    'undo',
    'redo',
    'cut',
    'copy',
    'paste',
    'selectAll',
    'services',
    'hide',
    'hideOthers',
    'unhide',
    'minimize',
    'zoom',
    'front',
    'close',
    'quit',
    'togglefullscreen'
] as const;

export type MenuRole = (typeof MENU_ROLES)[number];

/* What only the shell can carry out, named by the client and run by the shell itself. */
export const MENU_SHELL_ACTIONS = ['stop-machine-and-quit', 'devtools'] as const;

export type MenuShellAction = (typeof MENU_SHELL_ACTIONS)[number];

export type MenuNode =
    | {
          kind: 'command';
          id: string;
          label: string;
          /* An Electron accelerator. Off macOS the shell only shows it; the page's own listeners keep the key. */
          accelerator?: string;
          /* The shortcut as the page prints it, for the menu the web client draws itself. */
          keys?: string;
          enabled?: boolean;
          checked?: boolean;
          /* One of a group of choices, with `checked` on the chosen one. A shell older than this draws a check mark. */
          radio?: boolean;
      }
    | { kind: 'role'; role: MenuRole; label: string }
    | { kind: 'shell'; action: MenuShellAction; label: string }
    | { kind: 'separator' }
    | { kind: 'submenu'; id: string; label: string; items: MenuNode[]; enabled?: boolean };

export interface MenuSpec {
    menus: { id: string; label: string; items: MenuNode[] }[];
}
