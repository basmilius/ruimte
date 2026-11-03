import { defineCommand, definePanel } from '@ruimte/extension/client';

definePanel({ id: 'throws', title: 'POC throws', icon: 'bomb', component: () => import('./Throws') });
definePanel({ id: 'permission', title: 'POC no permission', icon: 'bomb', component: () => import('./NoPermission') });
definePanel({ id: 'server', title: 'POC dead server', icon: 'bomb', component: () => import('./DeadServer') });
definePanel({ id: 'missing', title: 'POC missing chunk', icon: 'bomb', component: () => Promise.reject(new Error('This chunk is gone')) });
defineCommand({
    id: 'throw',
    title: 'POC: a command that throws',
    run: () => {
        throw new Error('On purpose');
    }
});

try {
    // @ts-expect-error A component has to be a lazy import.
    definePanel({ id: 'eager', title: 'POC eager', icon: 'bomb', component: function Eager() {} });
} catch (e) {
    console.info('Refused as it should be:', e);
}
