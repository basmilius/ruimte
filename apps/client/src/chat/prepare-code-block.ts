import type { ShellCodeBlockContext } from '@adecore/agents-react/host';
export type { ShellCodeBlockContext } from '@adecore/agents-react/host';
import { createElement } from 'react';
import { shellCommandLine, ShellLanguageSchema } from '@ruimte/contracts';
import { PrepareCodeBlockAction } from './PrepareCodeBlockAction';

export function prepareCodeBlockAction(context: ShellCodeBlockContext) {
    return context.complete && ShellLanguageSchema.safeParse(context.language).success && shellCommandLine(context.code) !== null
        ? createElement(PrepareCodeBlockAction, { context })
        : null;
}
