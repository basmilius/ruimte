import { createElement } from 'react';
import type { ShellCodeBlockContext } from '@adecore/agents-react/host';
import { preparableShell } from '@/chat/preparable-shell';
import { PrepareCodeBlockAction } from './PrepareCodeBlockAction';

export type { ShellCodeBlockContext } from '@adecore/agents-react/host';

export function prepareCodeBlockAction(context: ShellCodeBlockContext) {
    return preparableShell(context) === null ? null : createElement(PrepareCodeBlockAction, { context });
}
