import { withTimeout } from '../../async.ts';
import type { UsageLimitsProvider } from '@ruimte/contracts';
import { CodexTransport } from '@ruimte/agents/chat/codex-transport';
import { readClaudeUsage, readCodexLimits, type ProviderReading } from '@ruimte/agents/usage/limits/normalize';
import { errorText } from '../../error-text.ts';

/* A CLI that has not answered by now is not going to; the next pass tries again. */
const PROBE_TIMEOUT_MS = 20_000;
const CODEX_READ_TIMEOUT_MS = 3_000;

export type ProbeResult = ProviderReading | { unavailable: UsageLimitsProvider['unavailable'] };

const failure = (message: string): ProbeResult => ({ unavailable: { reason: 'failed', message } });

const timeoutOf = <T>(work: Promise<T>, ms: number, what: string): Promise<T> => withTimeout(work, ms, `${what} did not answer in time`);

/*
 * Asks Claude Code what is left of the plan, without a turn and without a token of our own. A
 * `claude -p` on the stream-json protocol answers `get_usage` before any prompt, but only once it
 * has been initialized: without that first control request the process waits and says nothing.
 */
export const probeClaude = async (command: readonly string[], env: Record<string, string>): Promise<ProbeResult> => {
    const child = Bun.spawn([...command, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore',
        env
    });
    const write = (frame: unknown): void => {
        child.stdin.write(`${JSON.stringify(frame)}\n`);
        child.stdin.flush();
    };
    const read = async (): Promise<ProbeResult> => {
        write({ type: 'control_request', request_id: 'ruimte-init', request: { subtype: 'initialize', hooks: {} } });
        let asked = false;
        let buffer = '';
        const decoder = new TextDecoder();
        for await (const chunk of child.stdout) {
            buffer += decoder.decode(chunk as Uint8Array, { stream: true });
            let at = buffer.indexOf('\n');
            for (; at !== -1; at = buffer.indexOf('\n')) {
                const line = buffer.slice(0, at);
                buffer = buffer.slice(at + 1);
                let frame: unknown;
                try {
                    frame = JSON.parse(line);
                } catch {
                    continue;
                }
                if (typeof frame !== 'object' || frame === null) {
                    continue;
                }
                const envelope = frame as { type?: unknown; request_id?: unknown; response?: { subtype?: unknown; response?: unknown } };
                if (envelope.type !== 'control_response') {
                    continue;
                }
                if (!asked) {
                    asked = true;
                    write({ type: 'control_request', request_id: 'ruimte-usage', request: { subtype: 'get_usage' } });
                    continue;
                }
                if (envelope.response?.subtype === 'error') {
                    return failure('Claude Code refused to report its usage');
                }
                return readClaudeUsage(envelope.response?.response ?? envelope.response);
            }
        }
        return failure('Claude Code closed without reporting its usage');
    };

    try {
        return await timeoutOf(read(), PROBE_TIMEOUT_MS, 'Claude Code');
    } catch (error) {
        return failure(errorText(error));
    } finally {
        child.kill();
    }
};

/* The same question to Codex: the app-server answers it over JSON-RPC right after the handshake. */
export const probeCodex = async (command: readonly string[], env: Record<string, string>): Promise<ProbeResult> => {
    let transport: CodexTransport | null = null;
    try {
        transport = new CodexTransport({
            command: [...command],
            cwd: process.cwd(),
            env,
            onFrame: () => undefined,
            onExit: () => undefined
        });
        const open = transport;
        await timeoutOf(
            open.request('initialize', { clientInfo: { name: 'ruimte', title: 'Ruimte', version: '0.1.0' }, capabilities: { experimentalApi: true } }),
            PROBE_TIMEOUT_MS,
            'Codex'
        );
        open.notify('initialized', {});
        const answer = await timeoutOf(open.request('account/rateLimits/read', undefined), CODEX_READ_TIMEOUT_MS, 'Codex');
        const snapshot = typeof answer === 'object' && answer !== null ? (answer as { rateLimits?: unknown }).rateLimits : null;
        const reading = readCodexLimits(snapshot);
        // An account on an API key has no plan windows; Codex answers, with nothing in it.
        return reading ?? { unavailable: { reason: 'no-subscription', message: null } };
    } catch (error) {
        return failure(errorText(error));
    } finally {
        transport?.end();
        transport?.kill();
    }
};
