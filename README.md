# FlightBerry - Cheapest Flight Finder

A Chrome / Brave extension that searches live flight prices, shows the cheapest option first, and notifies you when a route you are watching gets cheaper.

No account or build step is needed. An optional free key adds prices by seller (MakeMyTrip, Cleartrip, ixigo and others).

## Install

1. Open `chrome://extensions` (or `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.
4. Pin Flightyy from the puzzle-piece menu so it sits in the toolbar.

## Use

- **Search**: enter From, To and a date, then press **Find cheapest flights**. A search takes about 5 to 15 seconds. Results are sorted cheapest first; you can switch to fastest.
- **Where each price comes from**: every price is labelled with its source (Kiwi.com or Google Flights), and the summary names the cheapest seller.
- **Prices by seller**: add a free key in the **Settings** tab (see below) and each Google Flights fare gets a **Compare sellers** button listing what MakeMyTrip, Cleartrip, ixigo, the airline and other sellers charge, with the lowest marked and a Book button for each.
- **Places**: pick from the suggestions where you can. "Goa" covers both Goa airports and "London" covers all London airports. A place that is not in the list is sent as typed, and the results header shows the city and country it matched, so check it.
- **Return trips**: fill in the Return date. Leave it empty for one way.
- **Flexible dates**: searches 3 days either side of your date and shows the cheapest days.
- **Watch this price**: saves the search. Optionally set a target price. Watched routes are re-checked about every 3 hours while the browser is open, and you get a notification when the price drops or reaches your target. Click the notification to open the booking page.
- **Open on other sites**: every result set links to the same search on MakeMyTrip, ixigo, Cleartrip, Google Flights and Skyscanner.

## Seller prices (optional, free)

MakeMyTrip, ixigo and Cleartrip have no public price feed, so seller prices come from Google Flights, read through SerpApi.

1. Create a free account at [serpapi.com](https://serpapi.com/users/sign_up) and copy your API key.
2. Open the extension, go to **Settings**, paste the key and press **Save**.

The free plan allows 250 searches a month. Each flight search uses 2 (3 for a return trip), and each extra **Compare sellers** click uses 1 (2 for a return trip). Which sellers appear depends on what Google lists for that flight.

## Good to know

- Prices are fetched live at the moment you search and are totals for all travellers. The final price is confirmed on the seller's booking page.
- Without a key, prices come from Kiwi.com's public flight search, which covers most airlines including low-cost carriers.
- Price watches use Kiwi.com prices, so they do not use up your Google Flights searches.
- Background checks only run while the browser is open.
- Your searches, watches and API key are stored only in the browser on this computer.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension definition |
| `popup.html`, `popup.css`, `popup.js` | Search and watch-list interface |
| `background.js` | Timed price checks and notification clicks |
| `src/api.js` | Live flight search |
| `src/airports.js` | Place suggestions and name-to-code matching |
| `src/google.js` | Google Flights fares and prices by seller |
| `src/watches.js` | Saved watches and price-drop detection |
