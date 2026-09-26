// What a CLI still accepts without the turn becoming slower than the answer is worth; a Claude user
// frame this large is legal but sluggish.
export const PROMPT_MAX_CHARS = 120000;

// Below this the counter would only be noise; a prompt this long is already unusual.
export const PROMPT_COUNTER_FROM = 100000;

/*
 * From this many bytes a paste of text becomes a file beside the prompt instead of text in it. A log
 * or a file that large is something to read with a tool, not words for the model to take in on
 * every turn, and in the textarea it buries what the person actually wants to say.
 */
export const PASTE_ATTACHMENT_FROM_BYTES = 32 * 1024;

const encoder = new TextEncoder();

/* Whether pasted text is large enough to go in as an attachment. Bytes, since that is what the file weighs. */
export const pasteBecomesAttachment = (text: string): boolean =>
    text.length * 3 >= PASTE_ATTACHMENT_FROM_BYTES && encoder.encode(text).length >= PASTE_ATTACHMENT_FROM_BYTES;

/* A name for pasted text that no attachment of the draft has yet: paste-1.txt, paste-2.txt, ... */
export const pastedTextName = (taken: string[]): string => {
    const names = new Set(taken);
    let index = 1;
    while (names.has(`paste-${index}.txt`)) {
        index += 1;
    }
    return `paste-${index}.txt`;
};

export interface PromptGuard {
    count: number;
    // Whether the counter is worth drawing at all.
    visible: boolean;
    tooLong: boolean;
}

export const promptGuard = (text: string): PromptGuard => ({
    count: text.length,
    visible: text.length >= PROMPT_COUNTER_FROM,
    tooLong: text.length > PROMPT_MAX_CHARS
});

/*
 * Commands the CLI lists because its own terminal has them: they change the terminal, the login or
 * the config, or they end a session the chat node does not own.
 */
const TUI_ONLY = new Set([
    'bug',
    'color',
    'config',
    'doctor',
    'exit',
    'heapdump',
    'help',
    'hooks',
    'ide',
    'install-github-app',
    'keybindings',
    'login',
    'logout',
    'migrate-installer',
    'privacy-settings',
    'quit',
    'release-notes',
    'reload-plugins',
    'reload-skills',
    'rename',
    'resume',
    'status',
    'statusline',
    'terminal-setup',
    'theme',
    'upgrade',
    'vim'
]);

/* The commands of the CLI's list that mean something in a chat node. */
export const usableSlashCommands = (names: string[]): string[] => names.filter((name) => !TUI_ONLY.has(name));
