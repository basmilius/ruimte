import type { ExtensionNotificationChannel } from '@ruimte/contracts';
import { z } from 'zod';
import { JsonFileStore } from '../json-file-store.ts';

const FileSchema = z.object({ on: z.array(z.string()) });

/* What a channel is handed: what a push to a phone would say, and why it went out. */
export interface ChannelNotification {
    title: string;
    body: string;
    project: { id: string };
    node: { id: string };
    reason: 'needsYou' | 'done' | 'limit';
}

/* What the channels ask of the extensions: which channels there are, and to hand one a notification, which never rejects. */
export interface NotificationChannelHost {
    list(): Promise<{ extension: string; id: string; title: string }[]>;
    deliver(extension: string, channel: string, notification: ChannelNotification): Promise<boolean>;
}

function keyOf(extension: string, channel: string): string {
    return `${extension}:${channel}`;
}

/*
 * The notification channels of extensions, and which of them a person turned on. Off until then, and the switch lives
 * under `$RUIMTE_HOME`, since it says where word of a person's agents goes. When a notification goes out is the push
 * service's to decide; this only hands it to each channel that is on, each on its own, so a slow one holds up no other.
 */
export class NotificationChannels {
    private readonly store: JsonFileStore<z.infer<typeof FileSchema>>;
    private readonly on: Set<string>;
    private readonly host: NotificationChannelHost;
    // Every delivery under way, so a stop and a test can wait for them.
    private readonly pending = new Set<Promise<unknown>>();

    constructor(host: NotificationChannelHost, path?: string) {
        this.host = host;
        this.store = new JsonFileStore(path, FileSchema, 'every notification channel starts off');
        this.on = new Set(this.store.read()?.on ?? []);
    }

    async list(): Promise<ExtensionNotificationChannel[]> {
        return (await this.host.list()).map((channel) => ({ ...channel, on: this.on.has(keyOf(channel.extension, channel.id)) }));
    }

    /* A person's switch. One for a channel no extension supplies now is kept too, so the extension coming back finds it as it was left. */
    set(extension: string, channel: string, on: boolean): void {
        const key = keyOf(extension, channel);

        if (on === this.on.has(key)) {
            return;
        }

        if (on) {
            this.on.add(key);
        } else {
            this.on.delete(key);
        }

        this.store.write({ on: [...this.on].sort() });
    }

    /* Hands the notification to every channel that is on. Returns at once: a channel's own time is its own. */
    notify(notification: ChannelNotification): void {
        if (this.on.size === 0) {
            return;
        }

        const delivering = this.host
            .list()
            .then((channels) =>
                Promise.all(
                    channels
                        .filter((channel) => this.on.has(keyOf(channel.extension, channel.id)))
                        .map((channel) => this.host.deliver(channel.extension, channel.id, notification))
                )
            );
        // The host's `deliver` never rejects, so only a list that could not be read ends here, and then nothing is delivered.
        const settled = delivering.catch(() => []);

        this.pending.add(settled);
        void settled.then(() => this.pending.delete(settled));
    }

    async settled(): Promise<void> {
        while (this.pending.size > 0) {
            await Promise.all(this.pending);
        }
    }
}
