import { DEFAULT_PORT } from '../config.ts';

export interface GreetingFacts {
    version: string;
    host: string;
    port: number;
    home: string;
    /* A person at a terminal rather than a service manager or the desktop app reading the log. */
    interactive: boolean;
}

/**
 * The lines a daemon prints once it listens. A log keeps the one line it always had; a person who
 * just ran `npx ruimte` to try it also learns what is running and what to do with it next.
 */
export const greetingLines = (facts: GreetingFacts): string[] => {
    const address = `ws://${facts.host}:${facts.port}/ws`;
    if (!facts.interactive) {
        return [`ruimte server ${facts.version} listening on ${address} (home: ${facts.home})`];
    }
    const portFlag = facts.port === DEFAULT_PORT ? '' : ` --port ${facts.port}`;
    return [
        `This machine runs Ruimte ${facts.version} on ${address} (home: ${facts.home}). Ctrl+C stops it.`,
        `Next: \`ruimte login${portFlag}\` puts it on your account, \`ruimte pair${portFlag}\` prints a pairing link, and \`ruimte service install${portFlag}\` keeps it running in the background.`
    ];
};
