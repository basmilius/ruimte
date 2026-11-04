import type { ShellCodeBlockContext } from '@adecore/agents-react';
import { createElement } from 'react';
import { preparableShell } from '@/chat/preparable-shell';
import { PrepareCodeBlockAction } from './PrepareCodeBlockAction';

export type { ShellCodeBlockContext } from '@adecore/agents-react';

export function prepareCodeBlockAction(context: ShellCodeBlockContext) {
    return preparableShell(context) === null ? null : createElement(PrepareCodeBlockAction, { context });
}
