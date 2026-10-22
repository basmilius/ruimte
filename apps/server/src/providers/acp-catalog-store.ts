import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentKind } from '@ruimte/contracts';
import type { AcpCatalogStore } from '@adecore/agents/providers';
import { isNotFound } from '@adecore/agents';

/* Where the models and commands an ACP agent reported are kept, in the machine's own state and never handed to a client. */
export function acpCatalogPath(home: string, kind: AgentKind): string {
    return join(home, 'models', 'agents', `${kind}.json`);
}

/*
 * A provider builds its state when it is made and saves from inside a chat's event, so both sides are synchronous. A file
 * that does not read as JSON counts as none: what it held is learned again from the agent's next session.
 */
export function acpCatalogStore(home: string, kind: AgentKind): AcpCatalogStore {
    const path = acpCatalogPath(home, kind);
    return {
        load(): unknown {
            let text: string;
            try {
                text = readFileSync(path, 'utf8');
            } catch (e) {
                if (isNotFound(e)) {
                    return null;
                }
                throw e;
            }
            try {
                return JSON.parse(text);
            } catch {
                return null;
            }
        },
        save(value: unknown): void {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
            const temporary = `${path}.${process.pid}.tmp`;
            writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
            renameSync(temporary, path);
        }
    };
}
