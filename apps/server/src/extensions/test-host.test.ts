import { expect, test } from 'bun:test';
import { TestHost } from './test-host.ts';

test('names every slot, in the order an author meets them, for a place that is no slot', () => {
    // A folder without a manifest is an extension with the default id.
    const host = new TestHost({}, '/nowhere');

    // An error, not a string: a string only asks the message to contain it, so a slot added at the end would go unnoticed.
    expect(() => host.context('nope')).toThrow(
        new TypeError(
            'nope is no slot. The slots are selectionBar, nodeHeader, nodeMenu, canvasMenu, lineMenu, viewToolbar, viewMenu, panelHeader, commandPalette, ' +
                'projectMenu, sidebarFooter, editorStatusBar, sidebarRow, tabMenu, emptyCanvas, startScreen, projectBanner, threadHeader, emptyThread, ' +
                'toolActions, fileRowBadge, fileBreadcrumb, terminalMenu, browserMenu, textMenu, noteToolbar, routineMenu, composer, messageActions, ' +
                'fileMenu, editorToolbar, editorMenu, diffToolbar, terminalToolbar, browserToolbar, viewAccessory'
        )
    );
});
