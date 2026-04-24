# manwar.org - Uptime Monitor

A lightweight Hugo static site hosted on GitHub Pages that tracks the uptime of [manwar.org](https://manwar.org) using browser cookies as the data store.

## How it works

- On load, the page probes `https://manwar.org` via a `no-cors` HEAD fetch
- Because this runs cross-origin from GitHub Pages, the browser can't read the HTTP status code — but a **successful opaque response = UP** and a **network error / timeout = DOWN**
- Each result is stored as a JSON record inside a cookie (`upt_checks`) with a 90-day TTL
- Statistics (total checks, outages, average latency) are tracked in a second cookie (`upt_meta`)
- The page re-checks every 60 seconds and displays a live countdown

## Data stored (cookies)

| Cookie | Contents |
|--------|----------|
| `upt_checks` | JSON array of `{ t, up, ms }` records, newest first, max 90 entries |
| `upt_meta` | JSON object `{ firstSeen, totalUp, totalDown }` |

Cookies have a 90-day rolling expiry and are stored per-browser. Clearing cookies or switching browsers resets history.

## Configuration

Edit `hugo.toml`:

```toml
[params]
  targetURL     = "https://manwar.org"   # site to monitor
  siteName      = "manwar.org"           # display name
  checkInterval = 60                     # seconds between checks
  cookieDays    = 90                     # cookie retention
```

## Local development

```bash
hugo server -D
```

## Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `uptime-monitor`)
2. Push this project to the `main` branch
3. In repo **Settings -> Pages**, set source to **GitHub Actions**
4. Update `baseURL` in `hugo.toml` to match your Pages URL:
   ```
   https://<your-username>.github.io/uptime-monitor/
   ```
5. Push - the workflow in `.github/workflows/deploy.yml` handles the rest

## Future: replacing cookies

The tracker is designed for easy storage backend swaps. The entire persistence layer lives in `static/js/uptime.js` inside the `Store` object. To migrate to, e.g., `localStorage`, IndexedDB, Supabase, or a serverless API, replace only the `Store.loadChecks`, `Store.saveChecks`, `Store.loadMeta`, `Store.saveMeta`, `Store.addCheck`, and `Store.clear` methods — the rest of the code stays the same.
