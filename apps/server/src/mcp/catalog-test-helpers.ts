import { AGENT_TOOLKITS } from '../agent-features/list.ts';
import { buildCatalog, type Tool } from './catalog.ts';

let built: readonly Tool[] | null = null;

/* The catalog of every feature the daemon has, built once per test run. */
export function catalog(): readonly Tool[] {
    built ??= buildCatalog(AGENT_TOOLKITS);

    return built;
}
