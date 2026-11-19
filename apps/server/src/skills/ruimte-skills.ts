import { join } from 'node:path';
import { z } from 'zod';
import { bestEffort } from '../best-effort.ts';
import type { SkillDisk, SkillFiles } from './skill-disk.ts';

/* What every folder of a Ruimte skill starts with, which keeps it apart from a person's own skills in the same place. */
export const RUIMTE_SKILL_PREFIX = 'ruimte-';

export const SKILL_FILE = 'SKILL.md';

/* The folders the daemon wrote, beside them; nothing else in the place is the daemon's to change. */
export const SKILLS_RECORD = '.ruimte-skills.json';

// A recorded name is only ever removed as a folder right under the skills folder, so a hand-edited record names nothing else.
const SKILL_NAME = /^ruimte-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SkillsRecordSchema = z.object({ folders: z.array(z.string()) });

export interface RuimteSkill {
    /* The name a prompt calls it by, `ruimte-<title>`, which is also its folder. */
    readonly name: string;
    /* The name a person reads. */
    readonly title: string;
    readonly description: string;
    readonly files: SkillFiles;
}

/* A skill and where its instructions lie on this machine; null while the daemon has not placed them there. */
export interface PlacedSkill {
    readonly skill: RuimteSkill;
    readonly path: string | null;
}

/* One `key: value` line of the front matter a SKILL.md opens with; null where it has none. */
function frontMatterField(text: string, key: string): string | null {
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
    const line = block?.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}:`));

    return line === undefined ? null : line.slice(key.length + 1).trim() || null;
}

/* A skill the daemon ships, from its files; throws for one whose SKILL.md lacks its name or description, which a test of the catalog catches. */
export function builtInSkill(title: string, files: SkillFiles): RuimteSkill {
    const name = `${RUIMTE_SKILL_PREFIX}${title}`;
    const instructions = files[SKILL_FILE];

    if (instructions === undefined) {
        throw new Error(`The skill ${name} has no ${SKILL_FILE}`);
    }

    const description = frontMatterField(instructions, 'description');

    if (frontMatterField(instructions, 'name') !== name || description === null) {
        throw new Error(`The ${SKILL_FILE} of ${name} names it ${name} and describes it in its front matter`);
    }

    return { name, title, description, files };
}

function sameFiles(found: SkillFiles | null | undefined, files: SkillFiles): boolean {
    if (found === null || found === undefined) {
        return false;
    }

    const names = Object.keys(files);

    return Object.keys(found).length === names.length && names.every((name) => found[name] === files[name]);
}

/*
 * The skills Ruimte ships, in a folder each under `$RUIMTE_HOME/skills`. Every start compares those
 * folders with the daemon's own files and rewrites what differs, so a stale or edited copy never
 * outlives a restart, and removes the folder of a skill that left Ruimte. Only a folder the record
 * names is the daemon's: one it did not write stays as it is, also under a name of its own skills.
 */
export class RuimteSkills {
    readonly root: string;
    private readonly skills: readonly RuimteSkill[];
    private readonly disk: SkillDisk;
    private readonly placedNames = new Set<string>();

    constructor(root: string, skills: readonly RuimteSkill[], disk: SkillDisk) {
        this.root = root;
        this.skills = skills;
        this.disk = disk;
    }

    list(): readonly RuimteSkill[] {
        return this.skills;
    }

    placed(): PlacedSkill[] {
        return this.skills.map((skill) => ({ skill, path: this.placedNames.has(skill.name) ? join(this.root, skill.name, SKILL_FILE) : null }));
    }

    /* The folder the CLIs read the skills from, or null while no skill is there. */
    folder(): string | null {
        return this.placedNames.size === 0 ? null : this.root;
    }

    /* Throws only when the record cannot be read or written; a skill that fails to write is left unplaced. */
    async place(): Promise<void> {
        const recorded = await this.recorded();
        const found = new Map(
            await Promise.all(this.skills.map(async (skill) => [skill.name, await this.disk.readFolder(this.folderOf(skill.name))] as const))
        );
        const ours = this.skills.filter((skill) => found.get(skill.name) === null || recorded.has(skill.name));
        const current = new Set(this.skills.map((skill) => skill.name));
        const retired = [...recorded].filter((name) => !current.has(name));
        const differing = ours.filter((skill) => !sameFiles(found.get(skill.name), skill.files));

        if (differing.some((skill) => !recorded.has(skill.name))) {
            // Before the folder, so a write cut short is still the daemon's to finish at the next start.
            await this.record([...recorded, ...differing.map((skill) => skill.name)]);
        }

        for (const skill of ours) {
            if (!differing.includes(skill)) {
                this.placedNames.add(skill.name);
            }
        }

        const gone = new Set<string>();

        await Promise.all([
            ...differing.map((skill) =>
                bestEffort(
                    `Writing the skill ${skill.name}`,
                    this.disk.replaceFolder(this.folderOf(skill.name), skill.files).then(() => this.placedNames.add(skill.name))
                )
            ),
            ...retired.map((name) =>
                bestEffort(
                    `Removing the skill ${name}`,
                    this.disk.remove(this.folderOf(name)).then(() => gone.add(name))
                )
            )
        ]);

        const kept = [...ours.map((skill) => skill.name), ...retired.filter((name) => !gone.has(name))];

        if (kept.length !== recorded.size || kept.some((name) => !recorded.has(name))) {
            await this.record(kept);
        }
    }

    private folderOf(name: string): string {
        return join(this.root, name);
    }

    private async recorded(): Promise<Set<string>> {
        const text = await this.disk.readText(join(this.root, SKILLS_RECORD));

        if (text === null) {
            return new Set();
        }

        let parsed: unknown;

        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = null;
        }

        // A record nobody can read names no folder, so nothing is taken for the daemon's that might be a person's.
        const record = SkillsRecordSchema.safeParse(parsed);

        return new Set(record.success ? record.data.folders.filter((name) => SKILL_NAME.test(name)) : []);
    }

    private record(folders: readonly string[]): Promise<void> {
        return this.disk.writeText(join(this.root, SKILLS_RECORD), `${JSON.stringify({ folders: [...new Set(folders)].sort() }, null, 4)}\n`);
    }
}
