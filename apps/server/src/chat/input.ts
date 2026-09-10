import type { ChatAttachment } from '@ruimte/contracts';

interface UserMessageInput {
    text: string;
    attachments?: ChatAttachment[];
    // Written before the text, for what the CLI has no flag for (`ultrathink`).
    prefix?: string;
    // Skills the person picked with `$`; the CLI runs one, and only from its own last text block.
    skills?: string[];
}

const isBoundary = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

const isTokenEnd = (char: string | undefined): boolean => isBoundary(char) || /[.,;:!?)]/.test(char!);

/* Where a `$name` of a known skill sits in the text, as a whole token; -1 when it does not. */
const findSkillToken = (text: string, name: string, from: number): number => {
    const token = `$${name}`;
    let index = text.indexOf(token, from);
    while (index >= 0) {
        if (isBoundary(text[index - 1]) && isTokenEnd(text[index + token.length])) {
            return index;
        }
        index = text.indexOf(token, index + 1);
    }
    return -1;
};

/* The last `$name` in the text that names one of the skills, longest name first on a tie. */
export const lastSkillToken = (text: string, skills: string[]): { index: number; name: string } | null => {
    let best: { index: number; name: string } | null = null;
    for (const name of [...new Set(skills)].sort((a, b) => b.length - a.length)) {
        let index = findSkillToken(text, name, 0);
        while (index >= 0) {
            if (best === null || index > best.index) {
                best = { index, name };
            }
            index = findSkillToken(text, name, index + 1);
        }
    }
    return best;
};

/*
 * The text blocks a prompt with skills becomes. Claude Code expands a skill only from a text block
 * that starts with `/name` and is the last one in the message (verified against 2.1.267 with a
 * skill that writes a marker file), so the last `$name` moves into a block of its own. Anything the
 * person wrote before it stays a block in front, with the earlier `$x` written as `/x` so the model
 * can still reach those through its Skill tool.
 */
export const splitSkillPrompt = (text: string, skills: string[]): { lead: string; invocation: string | null } => {
    const last = lastSkillToken(text, skills);
    if (last === null) {
        return { lead: text, invocation: null };
    }
    const lead = text.slice(0, last.index).replace(/\$([A-Za-z][A-Za-z0-9_:-]*)/g, (match, name: string) => (skills.includes(name) ? `/${name}` : match));
    const rest = text.slice(last.index + last.name.length + 1).replace(/^[ \t]+/, '');
    return { lead: lead.trimEnd(), invocation: rest === '' ? `/${last.name}` : `/${last.name} ${rest}` };
};

/*
 * Where the files someone attached live on this machine. Both CLIs open a file by path with their
 * own tools, images included, which keeps the bytes out of the thread and off the wire.
 */
export const attachmentNote = (attachments: ChatAttachment[]): string =>
    attachments.length === 0 ? '' : `Attached files:\n${attachments.map((attachment) => `- ${attachment.path} (${attachment.name})`).join('\n')}`;

/*
 * The `user` frame the CLI reads on stdin. The message body is the Anthropic API shape: a content
 * array of text blocks, which the CLI passes through unchanged (checked against claude 2.1.266).
 * The attachments are named by path in the leading block, so the invocation of a skill stays last.
 */
export const buildUserMessage = ({ text, attachments = [], prefix = '', skills = [] }: UserMessageInput): Record<string, unknown> => {
    const content: unknown[] = [];
    const { lead, invocation } = splitSkillPrompt(text, skills);
    const note = attachmentNote(attachments);
    // The prefix must be the first thing the model reads, so it joins the leading block.
    const prompt = [`${prefix}${lead}`.trimEnd(), note].filter((part) => part.trim() !== '').join('\n\n');
    if (prompt !== '') {
        content.push({ type: 'text', text: prompt });
    }
    if (invocation !== null) {
        content.push({ type: 'text', text: invocation });
    }
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' };
};
