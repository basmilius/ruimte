// What the sandbox should show: an opaque origin, no storage, and no way out but the parent.
document.getElementById('origin').textContent = `origin: ${self.origin}`;

try {
    document.getElementById('storage').textContent = `storage: ${localStorage.length} keys (not sandboxed!)`;
} catch {
    document.getElementById('storage').textContent = 'storage: refused';
}

fetch('https://example.com').then(
    () => (document.getElementById('fetch').textContent = 'fetch: went out (not sandboxed!)'),
    () => (document.getElementById('fetch').textContent = 'fetch: refused')
);

let nextCall = 1;

window.addEventListener('message', (event) => {
    if (event.data?.ruimte !== undefined) {
        document.getElementById('answer').textContent = event.data.error ?? event.data.result;
    }
});
document.getElementById('ask').addEventListener('click', () => {
    parent.postMessage({ ruimte: nextCall++, method: 'now', args: [] }, '*');
});
