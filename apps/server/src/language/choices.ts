import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '@adecore/agents/fs';
import { KIND_PROFILES, type LanguagePreferences } from './profiles.ts';

/*
 * Which of two kinds that serve the same thing the machine uses (`KindProfile.choice`), in one file
 * beside the installs. It is the machine's and never a project's: a project file cannot move a person
 * from one server to another. A choice that names a kind the catalog does not hold for it is ignored.
 */
export class LanguageChoices {
    private readonly path: string;
    private picks: Record<string, LanguageServerKind> = {};

    constructor(options: { path: string }) {
        this.path = options.path;
    }

    async load(): Promise<void> {
        let parsed: { picks?: Record<string, unknown> };
        try {
            parsed = JSON.parse(await readFile(this.path, 'utf8')) as { picks?: Record<string, unknown> };
        } catch (error) {
            if (!isNotFound(error)) {
                console.error(`${this.path} could not be read, so the default servers are used:`, error);
            }
            return;
        }
        for (const [choice, kind] of Object.entries(parsed.picks ?? {})) {
            if (typeof kind === 'string' && kind in KIND_PROFILES && KIND_PROFILES[kind as LanguageServerKind].choice === choice) {
                this.picks[choice] = kind as LanguageServerKind;
            }
        }
    }

    get(): LanguagePreferences {
        return this.picks;
    }

    /* Saves the pick of a kind for its choice. */
    async set(kind: LanguageServerKind): Promise<void> {
        const choice = KIND_PROFILES[kind].choice;
        if (choice === undefined) {
            return;
        }
        this.picks = { ...this.picks, [choice]: kind };
        await mkdir(dirname(this.path), { recursive: true });
        await writeAtomic(this.path, `${JSON.stringify({ picks: this.picks }, null, 2)}\n`);
    }
}
