/*
 * The shape every failure on the wire has: a code a client can branch on and a message a person reads.
 * A domain gives it a union of its own codes, so a typo in a code is a compile error instead of a
 * string the other end never matches.
 */
export class CodedError<TCode extends string = string> extends Error {
    readonly code: TCode;
    /* What the actor can do instead. Only a refusal fills this; the rest carry an empty list. */
    readonly lines: string[];

    constructor(code: TCode, message: string, lines: string[] = []) {
        super(message);
        // The subclass names itself, so a stack reads `GitError:` and not `Error:`.
        this.name = new.target.name;
        this.code = code;
        this.lines = lines;
    }
}
