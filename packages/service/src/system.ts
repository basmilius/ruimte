import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandRunner, ServiceFiles } from './manager';

/* The real launchctl, systemctl and loginctl under a service manager, bounded so a hung one cannot hold up a quit. */
export const runCommand: CommandRunner = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr || result.error?.message || '' };
};

/* The real file system under a service manager. */
export const diskFiles: ServiceFiles = {
    read(path) {
        try {
            return readFileSync(path, 'utf8');
        } catch {
            return null;
        }
    },
    write(path, text) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
    },
    remove(path) {
        rmSync(path, { force: true });
    }
};
