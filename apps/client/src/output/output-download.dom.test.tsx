import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { BYTES_CHUNK_MAX, BYTES_READ_MAX_BYTES, type ArtifactGetResult, type ArtifactVersion } from '@ruimte/contracts';
import { act } from 'react';
import type { SaveFileStreamBridge } from '@/desktop/bridge';
import { useFiles } from '@/state/files';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const SIZE = BYTES_READ_MAX_BYTES + 1000;
const PIECES = Math.ceil(SIZE / BYTES_CHUNK_MAX);

const VERSION: ArtifactVersion = {
    versionId: 'v1',
    number: 1,
    createdAt: 0,
    files: [{ name: 'out/app.zip', mime: 'application/zip', size: SIZE, sha256: 'v1' }],
    bytes: SIZE,
    provenance: { maker: 'agent', machineId: 'mac', chatId: 'chat-gone' },
    copiedTo: []
};

const BUILD: ArtifactGetResult = {
    artifact: { artifactId: 'build', projectId: 'project-atlas', projectName: 'Atlas', title: 'Nightly build', kind: 'build', createdAt: 0 },
    versions: [VERSION],
    chatPresent: false
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

interface FakeStream {
    bridge: SaveFileStreamBridge;
    /* The first byte of every piece written, which is the number of the piece it came from. */
    written: number[];
    bytes: number;
    ended: boolean;
    aborted: boolean;
    holdAfter: number | null;
    release(): void;
}

function fakeStream(): FakeStream {
    let released: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        released = resolve;
    });
    const stream: FakeStream = {
        written: [],
        bytes: 0,
        ended: false,
        aborted: false,
        holdAfter: null,
        release: () => released(),
        bridge: {
            begin: async () => 'save-1',
            write: async (_id, bytes) => {
                if (stream.holdAfter !== null && stream.written.length === stream.holdAfter) {
                    await held;
                }
                stream.written.push(bytes[0]!);
                stream.bytes += bytes.length;
            },
            end: async () => {
                stream.ended = true;
                return '/Users/someone/Downloads/app.zip';
            },
            abort: async () => {
                stream.aborted = true;
            }
        }
    };
    return stream;
}

/* Each piece is filled with its own number, so the order they reach the disk in can be read back. */
function answerPieces(versionAt: (offset: number) => string = () => 'v'): void {
    machine.answer('bytes.read', ({ offset, length }) => {
        const count = Math.min(length ?? BYTES_CHUNK_MAX, SIZE - offset);
        const piece = new Uint8Array(count).fill((offset / BYTES_CHUNK_MAX) % 256);
        return { mime: 'application/zip', size: SIZE, version: versionAt(offset), offset, data: Buffer.from(piece).toString('base64') };
    });
}

function downloadButton(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('button[aria-label="Download"]');
}

function toastButton(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === label) ?? null;
}

function toastTitles(): string[] {
    return useToasts.getState().toasts.map((toast) => toast.title);
}

async function openBuild(): Promise<void> {
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'output' }));
    await until(() => page.host.textContent?.includes('Nightly build') === true);
    await clickOn(
        ([...page.host.querySelectorAll('section button')] as HTMLElement[]).find((button) => button.textContent?.startsWith('Nightly build')) ?? null
    );
    await until(() => page.host.textContent?.includes('out/app.zip') === true);
}

async function start(stream: FakeStream | null): Promise<void> {
    if (stream !== null) {
        installDesktop({
            saveFileStream: stream.bridge
        });
    }
    page = mount();
    await page.renderApp();
    await openBuild();
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('artifact.list', () => ({
        artifacts: [{ ...BUILD.artifact, latest: VERSION, versionCount: 1, totalBytes: SIZE }]
    }));
    machine.answer('artifact.get', () => BUILD);
    answerPieces();
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'files' }));
    await page.unmount();
    removeDesktop();
    workspace.close();
    useFiles.setState({ tabs: [] });
    useToasts.setState({ toasts: [] });
});

describe('downloading an Output file larger than one read', () => {
    test('writes every piece to disk in order and says where it went', async () => {
        const stream = fakeStream();
        await start(stream);
        await clickOn(downloadButton());
        await until(() => stream.ended);

        expect(stream.bytes).toBe(SIZE);
        expect(stream.written).toEqual(Array.from({ length: PIECES }, (_, index) => index % 256));
        expect(stream.aborted).toBe(false);
        await until(() => toastTitles().includes('Downloaded app.zip'));
    });

    test('Cancel on its toast stops the reads and leaves no file', async () => {
        const stream = fakeStream();
        stream.holdAfter = 2;
        await start(stream);
        await clickOn(downloadButton());
        await until(() => toastTitles().includes('Downloading app.zip') && stream.written.length === 2);

        await clickOn(toastButton('Cancel'));
        stream.release();
        await until(() => stream.aborted);

        expect(stream.ended).toBe(false);
        expect(stream.written.length).toBeLessThan(PIECES);
        await until(() => toastTitles().length === 0);
        expect(machine.requests('bytes.read').length).toBeLessThan(PIECES);
    });

    test('a file that changes halfway fails and leaves no file', async () => {
        const stream = fakeStream();
        answerPieces((offset) => (offset < 4 * BYTES_CHUNK_MAX ? 'v' : 'v2'));
        await start(stream);
        await clickOn(downloadButton());
        await until(() => stream.aborted);

        expect(stream.ended).toBe(false);
        await until(() => toastTitles().includes('Could not download the file'));
    });

    test('without a shell that writes in pieces, Download stays off past the read bound', async () => {
        await start(null);
        const button = page.host.querySelector<HTMLElement>('button[aria-label^="Too large to download"]');
        expect(button).not.toBeNull();
        expect(button!.getAttribute('aria-disabled')).toBe('true');
        expect(downloadButton()).toBeNull();
    });
});
