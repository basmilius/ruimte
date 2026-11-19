import type { AgentKind } from '@ruimte/contracts';
import { SKILL_FILE, type PlacedSkill, type RuimteSkill } from './ruimte-skills.ts';

/* What a skill note starts with, which is how the chat's notes tell it from a brief a person reads in the thread. */
export const SKILL_NOTE_LEAD = 'Ruimte skill ';

// A chat on a plain API reads files only inside its project folder, so it is handed the instructions themselves.
const READS_PROJECT_ONLY: ReadonlySet<AgentKind> = new Set(['nanogpt']);

/* The model and effort a chat runs on, which a skill passes on to the agents it starts. */
export interface SkillRun {
    readonly cli: AgentKind;
    readonly model: string;
    readonly effort: string | null;
}

/* Whether `$name` stands in the text as a token of its own: after the start, whitespace or an opening bracket or quote, and before anything that cannot go on a name. */
function namesSkill(text: string, name: string): boolean {
    return new RegExp(`(?:^|[\\s([{"'])\\$${name}(?![A-Za-z0-9_:-])`).test(text);
}

/* The skills the text names, each once, in the order of the list. */
export function namedSkills(text: string, placed: readonly PlacedSkill[]): PlacedSkill[] {
    return placed.filter((entry) => namesSkill(text, entry.skill.name));
}

function instructionsOf(skill: RuimteSkill): string {
    return skill.files[SKILL_FILE] ?? '';
}

/* What a chat hears in front of a prompt that names a Ruimte skill: what it is for, where its instructions are and what the chat runs on. */
export function skillNote({ skill, path }: PlacedSkill, run: SkillRun): string {
    const effort = run.effort === null ? "the model's default effort" : `effort ${run.effort}`;
    const lines = [
        `${SKILL_NOTE_LEAD}${skill.name}: ${skill.description} The person named it with $${skill.name} in this message.`,
        `This chat runs on cli ${run.cli}, model ${run.model} and ${effort}.`
    ];

    if (path === null || READS_PROJECT_ONLY.has(run.cli)) {
        return [...lines, 'Follow its instructions:', instructionsOf(skill)].join('\n');
    }

    return [...lines, `Read its instructions in ${path} and follow them.`].join('\n');
}
