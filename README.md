# FlightBerry - Cheapest Flight Finder

A Chrome / Brave extension that searches live flight prices, shows the cheapest option first, and notifies you when a route you are watching gets cheaper.

No account, API key or build step is needed.

## Install

1. Open `chrome://extensions` (or `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.
4. Pin Flightyy from the puzzle-piece menu so it sits in the toolbar.

## Use

- **Search**: enter From, To and a date, then press **Find cheapest flights**. A search takes about 5 to 15 seconds. Results are sorted cheapest first; you can switch to fastest.
- **Places**: pick from the suggestions where you can. "Goa" covers both Goa airports and "London" covers all London airports. A place that is not in the list is sent as typed, and the results header shows the city and country it matched, so check it.
- **Return trips**: fill in the Return date. Leave it empty for one way.
- **Flexible dates**: searches 3 days either side of your date and shows the cheapest days.
- **Watch this price**: saves the search. Optionally set a target price. Watched routes are re-checked about every 3 hours while the browser is open, and you get a notification when the price drops or reaches your target. Click the notification to open the booking page.
- **Double-check**: every result set links to the same search on Google Flights and Skyscanner.

## Good to know

- Prices come from Kiwi.com's public flight search, which covers most airlines including low-cost carriers. Prices are totals for all travellers. The final price is confirmed on the booking page.
- Background checks only run while the browser is open.
- Your searches and watches are stored only in the browser on this computer.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension definition |
| `popup.html`, `popup.css`, `popup.js` | Search and watch-list interface |
| `background.js` | Timed price checks and notification clicks |
| `src/api.js` | Live flight search |
| `src/airports.js` | Place suggestions and name-to-code matching |
| `src/watches.js` | Saved watches and price-drop detection |
