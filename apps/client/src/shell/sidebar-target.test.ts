import { describe, expect, test } from 'bun:test';
import { sidebarNavigator, type SidebarTarget } from './sidebar-target';

const target = (projectId: string, viewId: string): SidebarTarget => ({ endpointId: 'machine', projectId, viewId });

describe('sidebar navigation', () => {
    test('only the last requested destination can reveal a view', async () => {
        const pending: ((result: string) => void)[] = [];
        const shown: SidebarTarget[] = [];
        const navigate = sidebarNavigator({
            open: () => new Promise((resolve) => pending.push(resolve)),
            current: () => ({ endpointId: 'machine', projectId: 'project' }),
            reveal: (value) => shown.push(value)
        });
        const first = navigate(target('project', 'first'));
        const second = navigate(target('project', 'second'));
        pending[1]!('done');
        await second;
        pending[0]!('done');
        await first;
        expect(shown).toEqual([target('project', 'second')]);
    });

    test('failed, cancelled or replaced switches do not reveal anything', async () => {
        for (const result of ['failed', 'cancelled', 'replaced']) {
            let revealed = false;
            await sidebarNavigator({
                open: async () => result,
                current: () => ({ endpointId: 'machine', projectId: 'project' }),
                reveal: () => {
                    revealed = true;
                }
            })(target('project', 'view'));
            expect(revealed).toBe(false);
        }
    });

    test('another project or machine taking over prevents stale view selection', async () => {
        for (const current of [
            { endpointId: 'other', projectId: 'project' },
            { endpointId: 'machine', projectId: 'other' }
        ]) {
            let revealed = false;
            await sidebarNavigator({
                open: async () => 'done',
                current: () => current,
                reveal: () => {
                    revealed = true;
                }
            })(target('project', 'view'));
            expect(revealed).toBe(false);
        }
    });
});
