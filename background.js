// Background worker: re-checks watched routes on a timer and opens the
// booking page when a price notification is clicked.
import { CHECK_ALARM, CHECK_EVERY_MINUTES, checkWatches, getWatches } from './src/watches.js';

async function ensureAlarm() {
  const existing = await chrome.alarms.get(CHECK_ALARM);
  if (!existing) {
    chrome.alarms.create(CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MINUTES });
  }
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) checkWatches();
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const [kind, watchId] = notificationId.split(':');
  if (kind !== 'watch') return;
  const watch = (await getWatches()).find((w) => w.id === watchId);
  if (watch?.bookingUrl?.startsWith('https://')) chrome.tabs.create({ url: watch.bookingUrl });
  chrome.notifications.clear(notificationId);
});
