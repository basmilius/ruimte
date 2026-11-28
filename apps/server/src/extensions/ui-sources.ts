import { uiSourceName } from '@ruimte/contracts/extension-providers';
import type { UiSourceDescription } from './descriptions.ts';

/* A UI source of an extension as an agent is told of it, by the name a block reads it under. */
export interface ExtensionUiSource {
    name: string;
    description: string;
    parameters?: object;
}

interface SourceProject {
    id: string;
    name: string;
    folder: string;
}

/* What the UI sources ask of the extensions: what each supplies, and what one answers a block. */
export interface UiSourceHost {
    /* With `start`, the process of every extension that lists a source starts for the answer; without, only those that run say theirs. */
    list(start: boolean): Promise<{ extension: string; id: string; described: UiSourceDescription }[]>;
    read(extension: string, source: string, args: Record<string, unknown>, project: SourceProject): Promise<unknown>;
}

interface Known {
    extension: string;
    id: string;
    described: UiSourceDescription;
}

/*
 * The UI sources of extensions, by the name a block reads one under. A source says what it is from its own process, so
 * the list is kept from the last time it was asked, which is what a prompt is written from without waiting. Nothing is
 * kept of what a source answered: a read goes to the extension every time.
 */
export class ExtensionUiSources {
    private known = new Map<string, Known>();
    // The newest ask, so an older one that answers later does not put back what the newer one took away.
    private asked = 0;
    private readonly host: UiSourceHost;
    private readonly projectOf: (projectId: string) => Promise<SourceProject | null>;

    constructor(host: UiSourceHost, projectOf: (projectId: string) => Promise<SourceProject | null>) {
        this.host = host;
        this.projectOf = projectOf;
    }

    /* What the last ask found, in the order the extensions listed them. */
    listed(): ExtensionUiSource[] {
        return [...this.known].map(([name, { described }]) => ({ name, ...described }));
    }

    /* Asks the extensions again. Never rejects: a list that fails keeps what was known. */
    async refresh(start: boolean): Promise<ExtensionUiSource[]> {
        const ask = ++this.asked;

        try {
            const sources = await this.host.list(start);

            if (ask === this.asked) {
                this.known = new Map(sources.map((source) => [uiSourceName(source.extension, source.id), source]));
            }
        } catch {
            // What was known stands; the extension host wrote why a process did not answer to its log.
        }

        return this.listed();
    }

    /* Whether an extension supplies the source now, asked again once for one nobody listed yet, as after a restart. */
    async supplies(name: string): Promise<boolean> {
        return this.known.has(name) || (await this.refresh(true)).some((source) => source.name === name);
    }

    /* What the source answers, for the project of the chat that wrote the block. Rejects with a sentence a person reads in the block. */
    async read(name: string, args: Record<string, unknown>, projectId: string): Promise<unknown> {
        const source = this.known.get(name);
        const project = await this.projectOf(projectId);

        if (source === undefined || project === null) {
            throw new Error(`No extension supplies ${name} here`);
        }

        return this.host.read(source.extension, source.id, args, project);
    }
}
