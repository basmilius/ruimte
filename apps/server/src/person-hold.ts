/* How a person holds what an agent operates: they paused it, or took it over by hand. The strip and the computer use helper say it as a mode. */
export type PersonHold = 'paused' | 'takenOver';

/* The same two, as the code an agent branches on when a call is refused while the person holds. */
export type PersonHoldCode = 'paused' | 'taken-over';

export const PERSON_HOLD_CODES: Readonly<Record<PersonHold, PersonHoldCode>> = { paused: 'paused', takenOver: 'taken-over' };

export function personHoldOfCode(code: string | null | undefined): PersonHold | null {
    return code === 'paused' ? 'paused' : code === 'taken-over' ? 'takenOver' : null;
}
