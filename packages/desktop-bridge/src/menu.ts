import type { MenuNode as ShellMenuNode, MenuSpec as ShellMenuSpec } from '@adecore/shell/bridge';

/*
 * The application menu, built by the client from what has the focus and drawn by the shell as a
 * native menu; the shapes are `@adecore/shell`'s. A click on a command comes back as its id,
 * and the client runs it.
 */

export { MENU_ROLES, type MenuRole } from '@adecore/shell/bridge';

/* What only the shell can carry out, named by the client and run by the shell itself. */
export const MENU_SHELL_ACTIONS = ['stop-machine-and-quit', 'devtools'] as const;

export type MenuShellAction = (typeof MENU_SHELL_ACTIONS)[number];

export type MenuNode = ShellMenuNode<MenuShellAction>;

export type MenuSpec = ShellMenuSpec<MenuShellAction>;
