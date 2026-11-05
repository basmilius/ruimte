import { ActionRefusal } from '@ruimte/actions';
import { TransportError, type Transport } from '@/transport-api/transport';

export type Requester = Pick<Transport, 'request'>;

/* The daemon's refusal keeps its code, so a caller can still tell a diverged branch from a failure. */
export function asRefusal(error: unknown): unknown {
    return error instanceof TransportError ? new ActionRefusal(error.code, error.message) : error;
}

/* What a machine answers, or its refusal as the action's own. */
export async function refusing<Result>(answer: Promise<Result>): Promise<Result> {
    try {
        return await answer;
    } catch (error: unknown) {
        throw asRefusal(error);
    }
}
