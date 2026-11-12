import settings from '../settings.js';

export function addBrowserViewer(bot, count_id) {
    if (!settings.render_bot_view)
        return;
    import('prismarine-viewer').then(({ default: prismarineViewer }) => {
        prismarineViewer.mineflayer(bot, { port: 3000 + count_id, firstPerson: true });
    }).catch((error) => {
        console.error('Could not start browser viewer:', error.message);
    });
}
