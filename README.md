# Error Messages and Emotional Impact: live class demo

A classroom demo for Chapter 6 (Emotional Interaction) of *Interaction Design* by Rogers, Sharp and Preece (6th ed).
Students join on their phones and do four short tasks that trigger errors: two with bad error design, then two with good error design.
After each task they rate how the error made them feel. The presenter projects `/results`, which compares bad and good design live.

- `public/` has the front end: plain HTML, CSS and JS with no build step (`index.html` for students, `results.html` for the projector).
- `src/worker.js` is the Cloudflare Worker API; `src/validate.js` does server-side validation.
- `migrations/` has the D1 schema.

Only the feelings answers and auto-recorded metrics are stored. Nothing typed into the fake sign-up or payment forms leaves the phone.

## API

| Route | What it does |
|---|---|
| `POST /api/join` | Registers an anonymous participant ID and an optional nickname |
| `POST /api/response` | Saves one feelings response. Every field is validated, and each participant has one row per round, so a resubmission replaces the old row |
| `GET /api/results` | Returns aggregated stats only. Nicknames are included only when the `x-admin-key` header is correct |
| `POST /api/reset` | Deletes all data. Needs the `x-admin-key` header to match the `ADMIN_KEY` secret |

Rate limit: 30 requests per minute per participant ID, using the Workers rate limiting binding.

## Deploy to Cloudflare

You need Node 18 or newer and a free Cloudflare account. Run these from the project folder.

```sh
# 1. Install Wrangler (the project pins it as a dev dependency)
npm install

# 2. Log in to Cloudflare (this opens a browser)
npx wrangler login

# 3. Create the D1 database
npx wrangler d1 create hci-demo
#    Copy the "database_id" it prints into wrangler.jsonc, replacing the placeholder value.

# 4. Create the tables in the remote database
npx wrangler d1 migrations apply hci-demo --remote

# 5. Deploy the Worker and static files
npx wrangler deploy
#    This prints your URL, for example https://hci-demo.<your-subdomain>.workers.dev

# 6. Set the admin key used by the Reset button and the nickname toggle
npx wrangler secret put ADMIN_KEY
#    Type a long random value when prompted. The secret takes effect straight away; no redeploy needed.
```

Students open the root URL. You project `https://hci-demo.<your-subdomain>.workers.dev/results`.
To show a shorter link (for example a bit.ly) on the results page, open `/results?join=https://bit.ly/yourlink`.

## Run locally and test on your phone

```sh
npx wrangler d1 migrations apply hci-demo --local   # first time only
npm run dev                                          # wrangler dev on 0.0.0.0:8787
```

Wrangler prints your LAN address, for example `http://192.168.2.2:8787`. Open it on a phone on the same Wi-Fi.
Open `http://<LAN address>:8787/results` on the laptop, so the QR code points at the LAN address rather than localhost.
The local admin key is set in `.dev.vars` (`ADMIN_KEY=dev-key`). That file is git-ignored.

If Windows Firewall asks about Node or workerd, allow it on private networks. Otherwise phones can't connect.

## Running the demo in class

1. Before class, open `/results` and press **Reset** to clear any test data.
2. Students scan the QR code, then work through the four rounds. Refreshing resumes where they were.
3. Bad rounds always fail. A "Skip to next step" link appears after 3 attempts or 90 seconds, so nobody gets stuck.
4. After the class finishes, talk through the gauges, charts and word wall.

Tests: `npm test` runs the server-side validation checks.
