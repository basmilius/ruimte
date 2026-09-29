import type { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useSettings } from '@/state/settings';
import { readTerminalFont, readTerminalTheme } from '@/terminal/theme';

export const createTerminal = (): Terminal =>
    new Terminal({
        theme: readTerminalTheme(),
        fontFamily: readTerminalFont(),
        fontSize: useSettings.getState().fontSize,
        cursorBlink: true,
        scrollback: 5000,
        macOptionIsMeta: true
    });

/*
 * FitAddon measures the host's border box, so a vertical padding on the host would count as room for a
 * row that is cut off. The host has none; what a whole row does not fill is split above and below, as an
 * offset rather than a padding, since FitAddon subtracts the terminal element's own padding too.
 */
export const fitToHost = (term: Terminal, fit: FitAddon): void => {
    fit.fit();
    const host = term.element?.parentElement;
    // The same private dimensions FitAddon itself divides by.
    const cellHeight: number = (term as unknown as { _core: { _renderService: { dimensions: { css: { cell: { height: number } } } } } })._core._renderService
        .dimensions.css.cell.height;
    if (!host || cellHeight === 0) {
        return;
    }
    const slack = host.clientHeight - term.rows * cellHeight;
    host.style.setProperty('--term-offset', `${Math.max(0, Math.floor(slack / 2))}px`);
};
