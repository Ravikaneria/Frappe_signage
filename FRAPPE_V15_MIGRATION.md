# Frappe v15 Migration Guide — `signage_display`

This document explains every change made to make the app compatible with
**Frappe v15** (and ERPNext v15 / HRMS v15).

---

## Files Changed

| File | What changed |
|---|---|
| `setup.py` | **Deleted** — replaced by `pyproject.toml` |
| `pyproject.toml` | **New** — v15 packaging standard |
| `signage_display/hooks.py` | `app_version` declared directly, not imported |
| `signage_display/www/display.html` | Base template path fixed; `frappe.*` JS removed |
| `signage_display/www/display.py` | Added `no_cache`, `csrf_token` to context |
| `signage_display/www/display.js` | `frappe.call` → `fetch()`; `frappe.realtime` → `setInterval` polling |
| `signage_display/www/display.css` | Scoped to `.sd-*` to avoid v15 web page style conflicts |
| `signage_display/signage_display/doctype/signage/signage.py` | Removed `publish_realtime` (not needed with polling) |
| `signage_display/signage_display/doctype/signage/signage.json` | Added v15 required DocType fields |
| `signage_display/signage_display/doctype/signage_settings/signage_settings.json` | Same |
| `signage_display/patches.txt` | **New** — required by v15 app structure |

---

## Fix 1 — `setup.py` → `pyproject.toml`

**Why:** Frappe v15 dropped `setup.py`-based packaging.
`bench get-app` and `bench install-app` now require `pyproject.toml`.

```diff
- setup.py  (deleted)
+ pyproject.toml  (new)
```

---

## Fix 2 — `hooks.py` — `app_version` declaration

**Why:** Frappe v15 reads `app_version` directly from `hooks.py` as a string,
not as an imported symbol from `__init__.py`.

```diff
- from . import __version__ as app_version
+ app_version = "0.0.1"
```

---

## Fix 3 — `display.html` — Wrong base template

**Why:** `templates/includes/base.html` was removed in Frappe v15.
The correct base is `templates/web.html`.

```diff
- {% extends "templates/includes/base.html" %}
+ {% extends "templates/web.html" %}
```

---

## Fix 4 — `display.html` — `frappe.csrf_token` injection

**Why:** The `frappe` JavaScript object (provided by Frappe's Desk bundle)
is **not loaded** on public `/www` pages in v15.
Writing `frappe.csrf_token = "..."` throws `ReferenceError: frappe is not defined`.

**Solution:** Pass the token as a plain JavaScript variable via `window._sd`:

```html
<!-- OLD (broken in v15) -->
<script>frappe.csrf_token = "{{ frappe.session.csrf_token }}"</script>

<!-- NEW -->
<script>
  window._sd = {
    csrfToken: "{{ csrf_token }}",   {# set in display.py context #}
    displayDuration: {{ signage_settings.display_duration }},
    ...
  };
</script>
```

---

## Fix 5 — `display.js` — `frappe.call()` → `fetch()`

**Why:** `frappe.call()` is a Desk-only utility. It is not available on
public web pages in v15.

```diff
- const res = await frappe.call('signage_display...get_signage_settings');
- settings = res.message;

+ const res = await fetch('/api/method/...get_all_signages', {
+   headers: { 'X-Frappe-CSRF-Token': window._sd.csrfToken }
+ });
+ const data = await res.json();
```

Settings are now injected directly into `window._sd` from the Jinja template
(server-side), so no extra API round-trip is needed for settings.

---

## Fix 6 — `display.js` — `frappe.realtime` → `setInterval` polling

**Why:** `frappe.realtime` (Socket.IO) is initialised only inside the Desk.
Guest users on `/www` pages do not get a socket connection in v15.

**Solution:** Poll the `get_all_signages` API every 30 seconds.
The display re-renders only if the data has actually changed (JSON comparison).

```diff
- function registerSocketListener() {
-   frappe.realtime.on("signage_update", (data) => {
-     signages = data.signages;
-     updateSignageDisplay();
-   });
- }

+ // Polls every 30 seconds; re-renders only on data change
+ setInterval(refreshSignages, 30_000);
```

To change the poll frequency, edit `POLL_INTERVAL_MS` at the top of `display.js`.

---

## Fix 7 — `display.js` — `autoPlay` → `autoplay` (Swiper typo)

Swiper.js uses lowercase `autoplay`. The original code used `autoPlay`
(wrong capitalisation), which caused the slideshow to never auto-advance.

```diff
- autoPlay: { delay: settings.display_duration, ... }
+ autoplay: { delay: SD.displayDuration, ... }
```

---

## Fix 8 — DocType JSON — v15 required fields

Frappe v15 has stricter DocType schema validation.
Both `signage.json` and `signage_settings.json` now include:

```json
"track_changes": 0,
"in_create": 0,
"search_index": 0   (on every field)
```

---

## Installation on Frappe v15

```bash
bench get-app signage_display https://github.com/<your-fork>/frappe-signage-display-app
bench --site your.site install-app signage_display
bench --site your.site migrate
bench build --app signage_display
```

Visit `https://your.site/display` to see the signage board.

---

## Trade-offs vs original design

| Feature | Original | v15 Fix |
|---|---|---|
| Settings loaded | API call on page load | Server-side Jinja (faster, no extra request) |
| Live updates | Socket.IO push (instant) | Polling every 30 s (slight delay) |
| Auth required | Guest (same) | Guest (same) |

If you need instant updates without polling, you can implement a
[Frappe Web Socket](https://frappeframework.com/docs/v15/user/en/api/realtime)
connection manually using the raw `socket.io-client` library and the
Frappe socket endpoint `/` — but polling is simpler and reliable for
a signage use-case where a 30-second lag is acceptable.
