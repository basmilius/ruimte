import { createMenuCommands, devToolsAccelerator, menuTemplateOf, staticMenuTemplate, type PageKeys } from '@adecore/shell';
import type { MenuShellAction, MenuSpec } from '@ruimte/desktop-bridge';
import { electron } from './electron';
import type { AppIpc } from './ipc';

const { app, Menu } = electron;

export interface MenuOptions {
    pageKeys: PageKeys;
    focused(): Electron.BrowserWindow | null;
    /* A page in a browser node or an HTML preview never sees the key, so there the menu answers. */
    keyBypassesPage(): boolean;
    /* Only where a service the app owns can run: anywhere else quitting already stops the machine. */
    canStopMachine: boolean;
    stopMachine(): void;
    /* A new window on the start screen. */
    openWindow(): Electron.BrowserWindow;
}

export interface AppMenu {
    /* What stands until the page sends its own menu, and again after a reload or a crash. */
    setStatic(): void;
    /* The menu of the window in front. */
    applyOf(window: Electron.BrowserWindow): void;
    /* The window's page is gone, and its menu with it. */
    forget(windowId: number): void;
}

/* Every page builds the menu from what has the focus in it (`apps/client/src/shell/menu`); the shell draws the one in front. */
export function installMenu(ipc: AppIpc, options: MenuOptions): AppMenu {
    // By window id; the one in front is drawn.
    const menuTemplates = new Map<number, Electron.MenuItemConstructorOptions[]>();
    // Settings asked for while no window was open, by the window opened for them; its first menu says its page listens.
    const settingsOnLoad = new Map<number, string | null>();

    const setStatic = (): void => {
        const openSettings = (section: string | null): void => {
            const window = options.focused();
            if (!window) {
                settingsOnLoad.set(options.openWindow().id, section);
                return;
            }
            window.show();
            window.webContents.send('menu:settings', section);
        };
        const newWindow: Electron.MenuItemConstructorOptions = {
            label: 'New Window',
            accelerator: 'CommandOrControl+Shift+N',
            click: (_item, _window, event) => {
                // While this menu stands over a page, that page answers the key itself.
                if (event.triggeredByAccelerator && options.focused() !== null && !options.keyBypassesPage() && options.pageKeys.take()) {
                    return;
                }
                options.openWindow();
            }
        };
        const quitItems: Electron.MenuItemConstructorOptions[] = options.canStopMachine
            ? [{ label: 'Stop Machine and Quit', click: () => options.stopMachine() }]
            : [];
        const template = staticMenuTemplate({
            appName: app.name,
            // Replace macOS's stock About and Settings with client routes.
            appItems: [
                { label: `About ${app.name}…`, click: () => openSettings('about') },
                { type: 'separator' },
                { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => openSettings(null) }
            ],
            fileItems: [newWindow],
            quitItems,
            toggleDevTools: () => options.focused()?.webContents.toggleDevTools()
        });
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    };

    const runMenuCommand = createMenuCommands({
        pageKeys: options.pageKeys,
        window: () => options.focused(),
        keyBypassesPage: () => options.keyBypassesPage()
    });

    const shellMenuItem = (action: MenuShellAction, label: string): Electron.MenuItemConstructorOptions | null => {
        if (action === 'devtools') {
            return { label, accelerator: devToolsAccelerator(), click: () => options.focused()?.webContents.toggleDevTools() };
        }
        return action === 'stop-machine-and-quit' && options.canStopMachine ? { label, click: () => options.stopMachine() } : null;
    };

    const applyOf = (window: Electron.BrowserWindow): void => {
        const template = menuTemplates.get(window.id);
        if (!template) {
            setStatic();
            return;
        }
        try {
            Menu.setApplicationMenu(Menu.buildFromTemplate(template));
        } catch (error) {
            console.error('[ruimte] menu refused', error);
        }
    };

    ipc.on('menu:set', (event, spec: MenuSpec) => {
        const window = ipc.senderWindow(event);
        if (window && settingsOnLoad.has(window.id)) {
            window.webContents.send('menu:settings', settingsOnLoad.get(window.id) ?? null);
            settingsOnLoad.delete(window.id);
        }
        const template = menuTemplateOf(spec, { run: runMenuCommand, shellItem: shellMenuItem });
        if (!window || !template) {
            return;
        }
        menuTemplates.set(window.id, template);
        if (options.focused() === window) {
            applyOf(window);
        }
    });

    return {
        setStatic,
        applyOf,
        forget: (windowId) => void menuTemplates.delete(windowId)
    };
}
