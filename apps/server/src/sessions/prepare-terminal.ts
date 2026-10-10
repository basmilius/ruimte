import { CodedError } from '@adecore/agents/coded-error';
import { shellCommandLine, type ShellLanguage, type TerminalPreparePreview, type TerminalPrepareSource } from '@ruimte/contracts';
import type { ClientConnection } from '../dispatcher.ts';
import type { SessionManager } from './manager.ts';
import type { Session } from './session.ts';

interface SourcePlace {
    cwd: string;
    projectId: string;
}

export interface PrepareTerminalHost {
    machineId: string;
    machine: string;
    sessions: SessionManager;
    source(source: TerminalPrepareSource): SourcePlace | null;
    title(sessionId: string, projectId: string): string | null;
    syntax(language: ShellLanguage, command: string): Promise<boolean>;
    now?(): number;
}

interface Ticket {
    clientId: string;
    source: TerminalPrepareSource;
    place: SourcePlace;
    session: Session;
    revision: number;
    command: string;
    expires: number;
}

const MAX_TICKETS = 100;
const TICKET_LIFETIME_MS = 60_000;

function refuse(message: string): never {
    throw new CodedError('terminal-prepare-refused', message);
}

/* A preview authorizes exactly one paste into the session life and empty prompt it showed. */
export class PrepareTerminal {
    private readonly host: PrepareTerminalHost;
    private readonly tickets = new Map<string, Ticket>();

    constructor(host: PrepareTerminalHost) {
        this.host = host;
    }

    async preview(machineId: string, source: TerminalPrepareSource, client: ClientConnection): Promise<TerminalPreparePreview> {
        this.checkMachine(machineId, client);
        const command = shellCommandLine(source.code);
        const location = this.host.source(source);
        if (command === null || location === null || !(await this.host.syntax(source.language, command))) {
            refuse('Choose one complete shell command from a finished reply.');
        }
        const place = { ...location };
        this.checkSource(source, place, client);
        for (const [token, ticket] of this.tickets) {
            if (ticket.clientId === client.id || ticket.expires <= this.now()) {
                this.tickets.delete(token);
            }
        }
        const targets: TerminalPreparePreview['targets'] = [];
        for (const info of this.host.sessions.list()) {
            const session = this.host.sessions.get(info.sessionId);
            if (!session) {
                continue;
            }
            const prompt = await session.shellPrompt.inspect();
            if (!prompt?.empty || !this.eligible(session, client, place)) {
                continue;
            }
            if (session.shell !== source.language && !(await this.host.syntax(session.shell as ShellLanguage, command))) {
                continue;
            }
            if ((await this.host.sessions.holdsForeground(session.pid)) !== true) {
                continue;
            }
            this.checkSource(source, place, client);
            if (!this.eligible(session, client, place) || session.shellPrompt.snapshot()?.revision !== prompt.revision) {
                continue;
            }
            if (this.tickets.size >= MAX_TICKETS) {
                this.tickets.delete(this.tickets.keys().next().value!);
            }
            const token = crypto.randomUUID();
            this.tickets.set(token, {
                clientId: client.id,
                source: { ...source },
                place,
                session,
                revision: prompt.revision,
                command,
                expires: this.now() + TICKET_LIFETIME_MS
            });
            targets.push({ token, sessionId: session.id, title: this.host.title(session.id, place.projectId)!, cwd: prompt.cwd });
        }
        return { machineId: this.host.machineId, machine: this.host.machine, command, cwd: place.cwd, targets };
    }

    async prepare(machineId: string, token: string, client: ClientConnection): Promise<{ sessionId: string }> {
        this.checkMachine(machineId, client);
        const ticket = this.tickets.get(token);
        if (!ticket || ticket.clientId !== client.id) {
            refuse('This terminal preview is no longer available. Open it again.');
        }
        // Consume before awaiting: double clicks and concurrent confirmations cannot paste twice.
        this.tickets.delete(token);
        const check = (): void => {
            this.checkSource(ticket.source, ticket.place, client);
            if (
                ticket.expires <= this.now() ||
                !this.eligible(ticket.session, client, ticket.place) ||
                ticket.session.shellPrompt.snapshot()?.revision !== ticket.revision
            ) {
                refuse('The terminal changed after the preview. Nothing was pasted. Open the preview again.');
            }
        };
        check();
        if ((await this.host.sessions.holdsForeground(ticket.session.pid)) !== true) {
            refuse('The terminal is busy, or its shell cannot be verified. Nothing was pasted.');
        }
        check();
        const outcome = await ticket.session.shellPrompt.prepare({ revision: ticket.revision, cwd: ticket.place.cwd }, ticket.command, check);
        if (outcome === 'unconfirmed') {
            throw new CodedError(
                'terminal-prepare-unconfirmed',
                'Preparation was not confirmed. The command may have been inserted. Check the terminal before preparing again.'
            );
        }
        if (outcome === 'refused') {
            throw new CodedError('terminal-editor-refused', 'The shell editor refused the command. Nothing was inserted. Open the preview again.');
        }
        return { sessionId: ticket.session.id };
    }

    private eligible(session: Session, client: ClientConnection, place: SourcePlace): boolean {
        return (
            this.host.sessions.get(session.id) === session &&
            !session.exited &&
            session.plainShell &&
            session.agent === null &&
            session.launch === null &&
            session.heldCommand === null &&
            session.isAttached(client.id) &&
            this.host.title(session.id, place.projectId) !== null &&
            session.shellPrompt.snapshot()?.cwd === place.cwd
        );
    }

    private checkSource(source: TerminalPrepareSource, place: SourcePlace, client: ClientConnection): void {
        const current = this.host.source(source);
        if (client.closed || current?.cwd !== place.cwd || current?.projectId !== place.projectId) {
            refuse('The chat or its working folder changed. Open the preview again.');
        }
    }

    private checkMachine(machineId: string, client: ClientConnection): void {
        if (client.closed || machineId !== this.host.machineId) {
            refuse('This preview belongs to another machine or a disconnected window.');
        }
    }

    private now(): number {
        return (this.host.now ?? Date.now)();
    }
}

export async function shellSyntax(language: ShellLanguage, command: string): Promise<boolean> {
    if (shellCommandLine(command) === null) {
        return false;
    }
    try {
        const args = language === 'bash' ? ['--noprofile', '--norc', '-n'] : language === 'zsh' ? ['-d', '-f', '-n'] : ['-n'];
        const child = Bun.spawn([`/bin/${language}`, ...args], {
            stdin: new Blob([command + '\n']),
            stdout: 'ignore',
            stderr: 'pipe',
            env: {},
            timeout: 2000
        });
        const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        return code === 0 && errors.trim() === '';
    } catch {
        return false;
    }
}
