import { afterEach, describe, expect, test } from 'bun:test';
import type { DesktopBridge, Release, ReleaseNotesState, UpdateState } from '@/desktop/bridge';
import { ensureReleaseNotes, missingNotesNotice, notesView, openReleaseNotes, useReleaseNotes } from '@/state/release-notes';

const release = (version: string, body = '- Something changed.'): Release => ({
    version,
    publishedAt: '2026-09-14T07:52:45Z',
    body,
    url: `https://github.com/basmilius/ruimte/releases/tag/v${version}`,
    compareUrl: null
});

const LIST = [release('0.0.9'), release('0.0.8'), release('0.0.7'), release('0.0.3', '')];

const updates = (patch: Partial<UpdateState>): UpdateState => ({ status: 'current', currentVersion: '0.0.8', ...patch });

describe('notesView', () => {
    test('with no update, the installed version is the one the link is about', () => {
        const view = notesView(LIST.slice(1), '0.0.8', updates({}), null);
        expect(view.entries.map((entry) => [entry.release.version, entry.role, entry.badge])).toEqual([
            ['0.0.8', 'installed', 'Installed'],
            ['0.0.7', 'older', null],
            ['0.0.3', 'older', null]
        ]);
        expect(view.link).toEqual({ label: "What's new", version: '0.0.8' });
    });

    test('with an update available, the versions up to it carry where the update stands', () => {
        const available = notesView(LIST, '0.0.8', updates({ status: 'available', version: '0.0.9' }), null);
        expect(available.entries[0]).toMatchObject({ role: 'upcoming', badge: 'Available' });
        expect(available.link).toEqual({ label: "What's new in version 0.0.9", version: '0.0.9' });
        expect(notesView(LIST, '0.0.8', updates({ status: 'downloading', version: '0.0.9' }), null).entries[0]?.badge).toBe('Downloading');
        expect(notesView(LIST, '0.0.8', updates({ status: 'ready', version: '0.0.9' }), null).entries[0]?.badge).toBe('Ready to install');
    });

    test('a version above the one on offer is upcoming without a badge', () => {
        const view = notesView([release('0.1.0'), ...LIST], '0.0.8', updates({ status: 'available', version: '0.0.9' }), null);
        expect(view.entries[0]).toMatchObject({ role: 'upcoming', badge: null });
    });

    test('still links to an available version the list does not have', () => {
        const view = notesView(LIST.slice(1), '0.0.8', updates({ status: 'available', version: '0.0.9' }), null);
        expect(view.link).toEqual({ label: "What's new in version 0.0.9", version: '0.0.9' });
    });

    test('has no link when the installed version has no notes and there is no update', () => {
        expect(notesView(LIST, '0.0.3', updates({ currentVersion: '0.0.3' }), null).link).toBeNull();
        expect(notesView(LIST, '0.0.5', updates({ currentVersion: '0.0.5' }), null).link).toBeNull();
    });

    test('an empty list has no entries, and a link only for an update', () => {
        expect(notesView([], '0.0.8', updates({}), null)).toEqual({ entries: [], link: null });
        expect(notesView([], '0.0.8', updates({ status: 'available', version: '0.0.9' }), null).link?.version).toBe('0.0.9');
    });

    test('has no link where there is no updater', () => {
        expect(notesView(LIST, '0.0.8', updates({ status: 'unsupported' }), null).link).toBeNull();
    });

    test('marks every version above the one seen before, up to the installed one, as new', () => {
        const view = notesView([release('0.0.10'), ...LIST], '0.0.9', updates({ currentVersion: '0.0.9' }), '0.0.7');
        expect(view.entries.filter((entry) => entry.isNew).map((entry) => entry.release.version)).toEqual(['0.0.9', '0.0.8']);
    });
});

describe('missingNotesNotice', () => {
    test('says nothing while the refetch runs, and names the version after it', () => {
        const list = LIST.slice(1);
        expect(missingNotesNotice(list, '0.0.9', true)).toBeNull();
        expect(missingNotesNotice(list, '0.0.9', false)).toEqual({
            text: 'Notes for version 0.0.9 are not available yet',
            url: 'https://github.com/basmilius/ruimte/releases/tag/v0.0.9'
        });
    });

    test('says nothing for a listed version, even one without notes', () => {
        expect(missingNotesNotice(LIST, '0.0.3', false)).toBeNull();
        expect(missingNotesNotice(LIST, null, false)).toBeNull();
    });
});

describe('loading', () => {
    const scope = globalThis as unknown as { window?: { ruimteDesktop?: Partial<DesktopBridge> } };

    afterEach(() => {
        delete scope.window;
        useReleaseNotes.setState({ notes: null, loading: false, open: false, version: null });
    });

    test('reads the cached list once, and asks GitHub again once when the dialog opens', async () => {
        const asked: boolean[] = [];
        const answer: ReleaseNotesState = { releases: LIST.slice(1), fetchedAt: null, error: null };
        scope.window = {
            ruimteDesktop: {
                releaseNotes: async (refresh?: boolean) => {
                    asked.push(refresh === true);
                    return answer;
                }
            }
        };
        ensureReleaseNotes();
        ensureReleaseNotes();
        await Promise.resolve();
        openReleaseNotes('0.0.9');
        await new Promise((done) => setTimeout(done, 0));
        expect(asked).toEqual([false, true]);
        const state = useReleaseNotes.getState();
        expect(state.open).toBe(true);
        expect(missingNotesNotice(state.notes?.releases ?? [], state.version, state.loading)?.text).toBe('Notes for version 0.0.9 are not available yet');
    });

    test('does nothing without a shell', () => {
        ensureReleaseNotes();
        expect(useReleaseNotes.getState().notes).toBeNull();
    });
});
