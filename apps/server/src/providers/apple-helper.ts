import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppleFoundationEventSchema, type AppleFoundationEvent } from '@ruimte/contracts';

/* The Foundation Models helper this daemon starts: the override, the one packaged beside the daemon, or a checkout's build. */
export function helperCommand(): string {
    if (process.env.RUIMTE_APPLE_FOUNDATION_HELPER) {
        return process.env.RUIMTE_APPLE_FOUNDATION_HELPER;
    }
    const packaged = join(dirname(process.execPath), 'native', 'ruimte-foundation-models');
    if (existsSync(packaged)) {
        return packaged;
    }
    const built = fileURLToPath(new URL('../../../foundation-models/dist/ruimte-foundation-models', import.meta.url));
    return existsSync(built) ? built : fileURLToPath(new URL('../../../foundation-models/.build/debug/ruimte-foundation-models', import.meta.url));
}

/* Whether this machine can run the helper at all. */
export function appleSiliconMac(): boolean {
    return process.platform === 'darwin' && process.arch === 'arm64';
}

/* What `--probe` said and how the helper exited; throws when it did not start or said nothing readable within ten seconds. */
export async function probeAppleHelper(command: string, env: Record<string, string | undefined>): Promise<{ result: AppleFoundationEvent; exited: number }> {
    const child = Bun.spawn([command, '--probe'], { env, stdout: 'pipe', stderr: 'ignore' });
    const timer = setTimeout(() => child.kill(), 10_000);
    try {
        const result = AppleFoundationEventSchema.parse(JSON.parse(await new Response(child.stdout).text()));
        return { result, exited: await child.exited };
    } finally {
        clearTimeout(timer);
    }
}
