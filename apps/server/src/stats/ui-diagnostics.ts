import { join } from 'node:path';
import { unrefTimeout } from '@adecore/utils/async';
import { z } from 'zod';
import { errorText } from '../error-text.ts';
import type { SessionEvent } from '../wire.ts';
import type { UsageStateStore } from './usage-counter.ts';

const PERSIST_MS = 60_000;
// A component and a prop are names an agent wrote, so their number is bounded here and not by a catalog.
const MAX_KEYS = 2000;
const MAX_NAME = 64;
// A finished reply is sent again when something beside its blocks changes, so the last ones counted are remembered.
const MAX_SEEN = 2000;

const StateSchema = z.object({
    version: z.literal(1),
    blocks: z.number().int().min(0),
    flawed: z.number().int().min(0),
    counts: z.record(z.string(), z.number().int().min(0))
});
type State = z.infer<typeof StateSchema>;

/* Machine state: no client's file request reaches it (`fs/machine-home.ts`), and nothing sends it anywhere. */
export function uiDiagnosticsPath(home: string): string {
    return join(home, 'usage', 'ui-diagnostics.json');
}

interface UiDiagnosticTallyOptions {
    store: UsageStateStore;
    schedule?: (run: () => void, ms: number) => () => void;
}

/*
 * What agents get wrong in UI blocks on this machine: how many blocks they wrote, how many of those
 * had a diagnostic, and a count per code, component and prop, such as `coerced_prop Stat.value`. It
 * holds names only, never a value or a word of a block, and stays in a file on this machine, where a
 * person reads which rule the catalog still lacks.
 */
export class UiDiagnosticTally {
    private readonly store: UsageStateStore;
    private readonly schedule: (run: () => void, ms: number) => () => void;
    private state: State = { version: 1, blocks: 0, flawed: 0, counts: {} };
    private readonly seen = new Set<string>();
    private pending: (() => void) | null = null;

    constructor(options: UiDiagnosticTallyOptions) {
        this.store = options.store;
        this.schedule = options.schedule ?? ((run, ms) => unrefTimeout(ms, run));
    }

    /* A file that will not read starts the tally over; it is worth less than a daemon that starts. */
    async load(): Promise<void> {
        try {
            const text = await this.store.read();
            const parsed = text === null ? null : StateSchema.safeParse(JSON.parse(text));

            if (parsed?.success) {
                this.state = parsed.data;
            }
        } catch (e) {
            console.warn('The tally of UI diagnostics would not read; it starts over:', errorText(e));
        }
    }

    snapshot(): Readonly<State> {
        return this.state;
    }

    observe(event: SessionEvent): void {
        if (event.event !== 'chat.event') {
            return;
        }

        const { chatId, event: chat } = event.payload;

        if (chat.type !== 'item' || chat.item.kind !== 'assistant' || chat.item.streaming || !chat.item.ui?.length) {
            return;
        }

        const key = `${chatId}:${chat.item.id}`;

        if (this.seen.has(key)) {
            return;
        }

        if (this.seen.size >= MAX_SEEN) {
            this.seen.clear();
        }

        this.seen.add(key);

        for (const block of chat.item.ui) {
            this.state.blocks += 1;
            this.state.flawed += block.diagnostics.length > 0 ? 1 : 0;

            for (const diagnostic of block.diagnostics) {
                this.count(diagnostic.code, diagnostic.component, diagnostic.prop);
            }
        }

        this.dirty();
    }

    async persist(): Promise<void> {
        this.pending?.();
        this.pending = null;

        try {
            await this.store.write(JSON.stringify(this.state));
        } catch (e) {
            console.warn('The tally of UI diagnostics would not write:', errorText(e));
        }
    }

    private count(code: string, component: string | undefined, prop: string | undefined): void {
        const about = component === undefined ? '' : ` ${component.slice(0, MAX_NAME)}${prop === undefined ? '' : `.${prop.slice(0, MAX_NAME)}`}`;
        const name = `${code.slice(0, MAX_NAME)}${about}`;

        if (!Object.hasOwn(this.state.counts, name) && Object.keys(this.state.counts).length >= MAX_KEYS) {
            return;
        }

        this.state.counts[name] = (this.state.counts[name] ?? 0) + 1;
    }

    private dirty(): void {
        this.pending ??= this.schedule(() => {
            this.pending = null;
            void this.persist();
        }, PERSIST_MS);
    }
}
