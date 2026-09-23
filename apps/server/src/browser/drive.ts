import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserDriveAction, BrowserInfo, BrowserPageState } from '@ruimte/contracts';
import type { BrowserManager } from './manager.ts';
import type { BrowserPages } from './pages.ts';

export interface DriveOutcome {
    /* Where the page stands afterwards, null when whoever holds it answered without a state. */
    state: BrowserPageState | null;
    /* The png of a shot. */
    image?: Uint8Array;
    /* What a text ask read off the page. */
    text?: string;
    /* Why it did not happen, in the browser's own words. */
    error?: string;
}

/* A page as an agent reads it: where it is now and what it says, null text when it could not be read. */
export interface PageReading {
    url: string;
    text: string | null;
}

export interface ShotOutcome {
    /* Where the png was written, null when the page is open but could not be photographed. */
    path: string | null;
    state: BrowserPageState | null;
    error?: string;
}

/* A shot is read once, by the agent that asked for it; a day later it is only a file nobody opens. */
const SHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/* An id comes from the project file, so it never becomes a path of its own. */
const fileSafe = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'page';

/* What a client is told about a page, out of what this machine knows of the one it runs itself. */
const pageState = (info: BrowserInfo): BrowserPageState => ({
    browserId: info.browserId,
    url: info.url,
    title: info.title,
    loading: info.loading,
    canGoBack: info.canGoBack,
    canGoForward: info.canGoForward,
    error: info.error
});

/*
 * The one door a verb drives a page through, whichever of the two kinds of page a node turns out to
 * be: one this machine runs itself (a station or a phone attached to it) or one a client holds in a
 * <webview> of its own. A machine that runs the page answers straight away; otherwise the clients
 * holding it are asked. Nobody holding it is not a failure, it is a null, and the verb says so.
 */
export class BrowserDriver {
    private readonly home: string;
    private readonly manager: Pick<BrowserManager, 'drive' | 'capture' | 'text'>;
    private readonly pages: Pick<BrowserPages, 'drive' | 'state'>;

    constructor(home: string, manager: Pick<BrowserManager, 'drive' | 'capture' | 'text'>, pages: Pick<BrowserPages, 'drive' | 'state'>) {
        this.home = home;
        this.manager = manager;
        this.pages = pages;
    }

    async drive(browserId: string, action: BrowserDriveAction): Promise<DriveOutcome | null> {
        const info = await this.manager.drive(browserId, action);
        if (info) {
            return { state: pageState(info) };
        }
        /* Asking for the stand of a page needs nobody woken: a client that holds one reports every
           change of it, so what it last said is what it would answer with. */
        if (action.kind === 'state') {
            const held = this.pages.state(browserId);
            return held === null ? null : { state: held };
        }
        return this.pages.drive(browserId, action);
    }

    /* What the page says wherever it is open, and the address it is at now; null when nobody has it open. */
    async read(browserId: string): Promise<PageReading | null> {
        const own = await this.manager.drive(browserId, { kind: 'state' });
        if (own !== null) {
            return { url: own.url, text: await this.manager.text(browserId) };
        }
        const outcome = await this.pages.drive(browserId, { kind: 'text' });
        if (outcome === null) {
            return null;
        }
        return { url: outcome.state?.url ?? '', text: outcome.text?.trim() ?? null };
    }

    /* The path of a png of that page, written under the machine's own folder; null when nobody has the page open. */
    async shot(browserId: string): Promise<ShotOutcome | null> {
        const own = await this.manager.capture(browserId);
        if (own !== null) {
            const info = await this.manager.drive(browserId, { kind: 'state' });
            return { path: await this.write(browserId, own), state: info === null ? null : pageState(info) };
        }
        const outcome = await this.pages.drive(browserId, { kind: 'shot' });
        if (outcome === null) {
            return null;
        }
        if (!outcome.image) {
            return { path: null, state: outcome.state, error: outcome.error ?? 'The page could not be photographed' };
        }
        return { path: await this.write(browserId, outcome.image), state: outcome.state };
    }

    private async write(browserId: string, image: Uint8Array): Promise<string> {
        const folder = join(this.home, 'screenshots');
        await mkdir(folder, { recursive: true });
        await this.sweep(folder);
        const path = join(folder, `${fileSafe(browserId)}-${Date.now()}.png`);
        await writeFile(path, image);
        return path;
    }

    /* Yesterday's shots, taken away as a new one is written, so nothing here grows without end. */
    private async sweep(folder: string): Promise<void> {
        const oldest = Date.now() - SHOT_MAX_AGE_MS;
        const names = await readdir(folder).catch(() => []);
        for (const name of names) {
            const taken = Number(/-(\d+)\.png$/.exec(name)?.[1]);
            if (Number.isFinite(taken) && taken < oldest) {
                await rm(join(folder, name)).catch(() => undefined);
            }
        }
    }
}
