import { create } from 'zustand';

export interface DialogRequest {
    title: string;
    body?: string;
    danger?: boolean;
    field?: { placeholder?: string; initial?: string };
    choices?: readonly string[];
    answer(value: string | null): void;
}

export const useHostDialog = create<{ request: DialogRequest | null }>(() => ({ request: null }));

/* One question at a time: a second waits for the first, as a person can only answer one. */
let queue: Promise<unknown> = Promise.resolve();

export function askHost(request: Omit<DialogRequest, 'answer'>): Promise<string | null> {
    const asked = queue.then(
        () =>
            new Promise<string | null>((resolve) => {
                useHostDialog.setState({
                    request: {
                        ...request,
                        answer: (value) => {
                            useHostDialog.setState({ request: null });
                            resolve(value);
                        }
                    }
                });
            })
    );

    queue = asked;

    return asked;
}
