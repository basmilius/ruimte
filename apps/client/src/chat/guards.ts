// What a CLI still accepts without the turn becoming slower than the answer is worth; a Claude user
// frame this large is legal but sluggish.
export const PROMPT_MAX_CHARS = 120000;

// Below this the counter would only be noise; a prompt this long is already unusual.
export const PROMPT_COUNTER_FROM = 100000;

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
