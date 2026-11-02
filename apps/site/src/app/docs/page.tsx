import Link from 'next/link';
import { SECTIONS } from '@/lib/docs/navigation';

export default function Home() {
    return (
        <main className="mx-auto max-w-4xl px-5 py-16">
            <h1 className="text-4xl font-semibold tracking-tight text-text">Ruimte documentation</h1>
            <p className="mt-4 max-w-2xl text-lg text-text-muted">
                Ruimte puts terminals, coding agents and browsers on one canvas, and keeps them running on your machine. These pages explain how it works and
                how to build on it.
            </p>
            <div className="mt-12 grid gap-4 sm:grid-cols-2">
                {SECTIONS.map((section) => (
                    <Link
                        key={section.href}
                        href={section.href}
                        className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-surface-raised"
                    >
                        <h2 className="font-medium text-text">{section.title}</h2>
                        <p className="mt-2 text-sm text-text-muted">{section.description}</p>
                    </Link>
                ))}
            </div>
        </main>
    );
}
