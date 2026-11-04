import { errorText, setErrorStacks } from '@adecore/agents';
import { describeError } from '@adecore/utils/errors';

export { describeError, errorText };

const DEBUG_VARIABLE = 'RUIMTE_DEBUG';

export function debugFrom(env: Record<string, string | undefined>): boolean {
    return env[DEBUG_VARIABLE] === '1';
}

// The daemon's own lines and what the chats say about an error follow the same switch.
setErrorStacks(debugFrom(process.env));
