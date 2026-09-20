import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';
import { DEFAULT_WEBGL_CONTEXTS, WebglSlots, type SlotChange } from '@/terminal/webgl-slots';

/* Flip to true while debugging the budget; false logs nothing. */
const DEBUG: boolean = false;

const debug = (message: string, id: string): void => {
    if (DEBUG) {
        console.debug(`[webgl] ${message} ${id}`);
    }
};

let webgl2Available: boolean | null = null;

/* Probed once for the page; the probe context is released so it does not count against the browser's cap. */
const hasWebgl2 = (): boolean => {
    if (webgl2Available === null) {
        const context = document.createElement('canvas').getContext('webgl2');
        webgl2Available = context !== null;
        context?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return webgl2Available;
};

/* The canvas the addon just added. xterm names the canvas of every render layer it owns
   (`xterm-link-layer`); the WebGL one is the nameless one. */
const rendererCanvas = (term: Terminal): HTMLCanvasElement | null => {
    const canvases = term.element?.querySelectorAll<HTMLCanvasElement>('.xterm-screen canvas') ?? [];
    return [...canvases].filter((canvas) => canvas.classList.length === 0).at(-1) ?? null;
};

interface Entry {
    term: Terminal;
    /* Refits the host, because the two renderers measure a glyph differently. */
    refit: () => void;
    addon: WebglAddon | null;
    canvas: HTMLCanvasElement | null;
    frame: number | null;
}

/**
 * Keeps the number of live WebGL renderers under the cap, whatever a zoomed-out canvas asks for.
 * A browser drops the oldest of its own contexts without telling anyone, which left a terminal on
 * the DOM renderer for good; here a terminal that loses its context queues up again instead.
 * `WebglSlots` decides who holds one, this class loads and disposes the addons.
 */
class WebglBudget {
    private readonly slots = new WebglSlots(DEFAULT_WEBGL_CONTEXTS);
    private readonly entries = new Map<string, Entry>();

    /* A terminal that mounted visibly asks for a context. The returned function gives it back. */
    register(id: string, term: Terminal, refit: () => void): () => void {
        const entry: Entry = { term, refit, addon: null, canvas: null, frame: null };
        this.entries.set(id, entry);
        if (hasWebgl2()) {
            this.apply(this.slots.request(id));
        }
        return () => {
            if (this.entries.get(id) !== entry) {
                return;
            }
            this.entries.delete(id);
            // The context goes back before the next terminal asks for one, never after.
            this.drop(entry);
            this.apply(this.slots.release(id));
        };
    }

    focus(id: string): void {
        this.apply(this.slots.focus(id));
    }

    blur(id: string): void {
        this.apply(this.slots.blur(id));
    }

    /* Output arrived; a busy terminal outranks an idle one. */
    touch(id: string): void {
        this.apply(this.slots.touch(id));
    }

    setCap(cap: number): void {
        this.apply(this.slots.setCap(cap));
    }

    /* Node ids holding a WebGL renderer, highest ranked first. */
    holders(): string[] {
        return this.slots.holders();
    }

    private apply(change: SlotChange): void {
        // Free first, the browser has to be back under its own limit before the next context exists.
        for (const id of change.revoked) {
            this.unload(id);
        }
        for (const id of change.granted) {
            this.load(id);
        }
    }

    private load(id: string): void {
        const entry = this.entries.get(id);
        if (!entry || entry.addon) {
            return;
        }
        try {
            const addon = new WebglAddon();
            addon.onContextLoss(() => this.handleLoss(id));
            entry.term.loadAddon(addon);
            entry.addon = addon;
            entry.canvas = rendererCanvas(entry.term);
            this.scheduleRefit(entry);
            debug('granted', id);
        } catch {
            // WebGL refused this terminal; the DOM renderer keeps drawing and the slot goes to the next one.
            this.apply(this.slots.lost(id));
        }
    }

    private unload(id: string): void {
        const entry = this.entries.get(id);
        if (!entry?.addon) {
            return;
        }
        this.drop(entry);
        // Disposing the addon puts the DOM renderer back and queues a full repaint; the fit runs
        // after that frame, on the cell size that renderer measured.
        this.scheduleRefit(entry);
        debug('revoked', id);
    }

    private handleLoss(id: string): void {
        debug('context lost', id);
        this.unload(id);
        // Not gone for good, the terminal waits in line and takes a context again when it is focused.
        this.apply(this.slots.lost(id));
    }

    private drop(entry: Entry): void {
        if (entry.frame !== null) {
            window.cancelAnimationFrame(entry.frame);
            entry.frame = null;
        }
        entry.addon?.dispose();
        entry.addon = null;
        // The addon leaves its canvas to the garbage collector, and until that runs the browser
        // still counts the context. Losing it by hand is what makes a released slot a free one.
        entry.canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
        entry.canvas = null;
    }

    private scheduleRefit(entry: Entry): void {
        if (entry.frame !== null) {
            return;
        }
        entry.frame = window.requestAnimationFrame(() => {
            entry.frame = null;
            entry.refit();
        });
    }
}

export const webglBudget = new WebglBudget();
