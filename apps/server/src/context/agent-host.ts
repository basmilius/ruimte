import type { ActionOutput } from '@ruimte/actions';
import type { ContextSource } from '@ruimte/contracts';
import type { Reference } from '../projects/references.ts';

/* The usage a read of a chat starts with, in the fields `context.read` answers. */
export type ChatReadUsage = NonNullable<ActionOutput<'context.read'>['usage']>;

/* A source as text, and for a chat the usage its first line says in words. */
export interface ContextReading {
    text: string;
    usage?: ChatReadUsage;
    /* The png a read in form image wrote. */
    image?: string;
}

export interface ContextHost {
    list(targetId: string): Pick<ContextSource, 'id' | 'kind' | 'title'>[];
    /* One linked source as text; a source it cannot answer throws a `CodedError` that says why. */
    answer(targetId: string, sourceId: string, tail: number | null, subagent: string | null): Promise<ContextReading>;
    /* A source the caller reads without a line, such as a node of the canvas a chat view names. */
    answerSource(targetId: string, source: ContextSource, tail: number | null, subagent: string | null, projectId?: string): Promise<ContextReading>;
    /* What a person pointed this agent at with `#` or `@` in its messages, read again at every call. */
    referenced?(targetId: string): Reference[];
    /* The source behind an id the caller may read, by a line, a reference or as its own child; null for any other. */
    sourceFor?(targetId: string, sourceId: string): ContextSource | null;
}
