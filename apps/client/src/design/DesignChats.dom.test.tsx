import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { DesignComposerHeader } from '@/design/DesignChats';
import { useDocument } from '@/state/document';
import { mount, type Mounted } from '../../testing/dom';

const DESIGN: ProjectView = {
    kind: 'design',
    id: 'pricing',
    name: 'Pricing',
    path: 'pricing',
    node: { provider: 'claude' },
    chats: [{ id: 'pricing-2', name: 'Dense', node: { provider: 'claude' } }]
};

let mounted: Mounted;

beforeEach(() => {
    useDocument.getState().load({ version: 3, rev: 1, name: 'p', color: '#000', views: [DESIGN] }, { activeViewId: null, views: {} });
    mounted = mount();
});

afterEach(async () => {
    await mounted.unmount();
});

function switcher(): HTMLButtonElement | null {
    return mounted.host.querySelector<HTMLButtonElement>('[aria-label="Chat: Dense"]');
}

function newChat(): HTMLButtonElement | null {
    return mounted.host.querySelector<HTMLButtonElement>('[aria-label="New chat"]');
}

describe('the chats over the composer of a design', () => {
    test('offer a new chat and stay in the tab order while the composer has the focus', async () => {
        await mounted.render(<DesignComposerHeader scopeId="scope" chatId="pricing-2" disabled={false} focused={true} />);

        expect(switcher()?.tabIndex).toBe(0);
        expect(newChat()?.tabIndex).toBe(0);
    });

    test('stay out of the tab order while the composer has no focus', async () => {
        await mounted.render(<DesignComposerHeader scopeId="scope" chatId="pricing-2" disabled={false} focused={false} />);

        expect(switcher()?.tabIndex).toBe(-1);
        expect(newChat()?.tabIndex).toBe(-1);
    });

    test('only switch between the chats of a composer nobody may write in', async () => {
        await mounted.render(<DesignComposerHeader scopeId="scope" chatId="pricing-2" disabled={true} focused={true} />);

        expect(switcher()).not.toBeNull();
        expect(newChat()).toBeNull();
    });
});
