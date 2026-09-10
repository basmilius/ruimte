export interface CliDetection {
    installed: boolean;
    version: string | null;
}

/* Asks a CLI for its version; a missing binary is a plain "not installed", never an error. */
export const detectCli = async (command: string, env: Record<string, string | undefined> = process.env): Promise<CliDetection> => {
    try {
        const proc = Bun.spawn([command, '--version'], { stdout: 'pipe', stderr: 'ignore', env: env as Record<string, string> });
        const output = await new Response(proc.stdout).text();
        const code = await proc.exited;
        if (code !== 0) {
            return { installed: false, version: null };
        }
        const version = /\d+\.\d+\.\d+/.exec(output)?.[0] ?? output.trim() ?? null;
        return { installed: true, version };
    } catch {
        return { installed: false, version: null };
    }
};
