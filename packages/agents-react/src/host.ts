/* A color an account may wear, by the name the host stores it under. */
export interface AccentChoice {
    id: string;
    color: string;
}

/*
 * What the app around the chat decides and the chat cannot: its palette, its words for a color. Set
 * once, before the first render, with `setChatHost`; whatever an app leaves out keeps the default
 * here. The same in every scope, so it holds nothing about one host of chats.
 */
export interface ChatHost {
    /* The colors an account may wear in the order a picker offers them, the few it shows first, and their names. */
    accents: {
        all: readonly AccentChoice[];
        featured: readonly string[];
        label(id: string): string;
    };
}

const DEFAULT_HOST: ChatHost = {
    accents: { all: [], featured: [], label: (id) => id }
};

let host: ChatHost = DEFAULT_HOST;

export const setChatHost = (patch: Partial<ChatHost>): void => {
    host = { ...host, ...patch };
};

export const chatHost = (): ChatHost => host;
