import Link from 'next/link';

export default function NotFound() {
    return (
        <main className="mx-auto max-w-4xl px-5 py-24">
            <h1 className="text-3xl font-semibold text-text">This page does not exist</h1>
            <p className="mt-4 text-text-muted">
                It may have moved.{' '}
                <Link href="/" className="text-accent-text hover:underline">
                    Start from the overview
                </Link>
                .
            </p>
        </main>
    );
}
