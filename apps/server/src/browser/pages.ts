import type { BrowserDriveAction, BrowserDriveResult, BrowserPageState } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import type { DriveOutcome } from './drive.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';

/* What one ask may take before the agent hears that nobody answered; a load has its own, shorter, wait in the client. */
const ASK_TIMEOUT_MS = 15_000;

/*
 * The pages this machine does not run itself. In the desktop shell a browser node is a <webview>
 * inside the client, so the daemon only knows it because that client says so: it holds the page and
 * reports where it stands. An agent's verb goes back out over the same link, and the client that
 * holds the page answers under the `askId` it was asked with.
 *
 * Two clients with the same project open each draw their own page under one node, so an ask goes to
 * all of them and the first answer is the one the agent reads.
 */
export class BrowserPages {
    private readonly sinks = new ClientSinks();
    /* Per node, the clients that have it open and where each says the page stands. */
    private readonly pages = new Map<string, Map<string, BrowserPageState>>();
    private readonly asks = new Map<string, (result: BrowserDriveResult) => void>();
    private readonly timeoutMs: number;
    private asked = 0;

    constructor(timeoutMs: number = ASK_TIMEOUT_MS) {
        this.timeoutMs = timeoutMs;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    hold(clientId: string, state: BrowserPageState): void {
        const byClient = this.pages.get(state.browserId) ?? new Map<string, BrowserPageState>();
        byClient.set(clientId, state);
        this.pages.set(state.browserId, byClient);
    }

    release(clientId: string, browserId: string): void {
        const byClient = this.pages.get(browserId);
        if (!byClient) {
            return;
        }
        byClient.delete(clientId);
        if (byClient.size === 0) {
            this.pages.delete(browserId);
        }
    }

    /* A client that went away takes every page it held with it; a socket never says goodbye per node. */
    detachAll(clientId: string): void {
        for (const browserId of [...this.pages.keys()]) {
            this.release(clientId, browserId);
        }
    }

    /* Where the page stood when a client last said so; null when no client holds it. */
    state(browserId: string): BrowserPageState | null {
        return this.pages.get(browserId)?.values().next().value ?? null;
    }

    /* The page as the holders answer for it, or null when nobody has it open. */
    async drive(browserId: string, action: BrowserDriveAction): Promise<DriveOutcome | null> {
        const clients = [...(this.pages.get(browserId)?.keys() ?? [])];
        if (clients.length === 0) {
            return null;
        }
        const askId = `ask-${++this.asked}`;
        const answer = this.ask(askId);
        const event: SessionEvent = { event: 'browser.drive', payload: { askId, browserId, action } };
        for (const clientId of clients) {
            this.sinks.to(clientId, event);
        }
        const result = await answer;
        if (result === null) {
            // A client that never answers still holds the page, so what it last reported beats saying nothing.
            return { state: this.state(browserId), error: 'The page did not answer in time' };
        }
        return {
            state: result.state ?? this.state(browserId),
            ...(result.image === undefined ? {} : { image: Buffer.from(result.image, 'base64') }),
            ...(result.error === undefined ? {} : { error: result.error })
        };
    }

    /* An answer from a client, which resolves the ask it names; one that names none is a late second answer. */
    settle(result: BrowserDriveResult): void {
        this.asks.get(result.askId)?.(result);
    }

    private ask(askId: string): Promise<BrowserDriveResult | null> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.asks.delete(askId);
                resolve(null);
            }, this.timeoutMs);
            this.asks.set(askId, (result) => {
                clearTimeout(timer);
                this.asks.delete(askId);
                resolve(result);
            });
        });
    }
}
