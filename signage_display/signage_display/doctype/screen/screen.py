import random
import datetime
import frappe
from frappe.model.document import Document

_WEEKDAY_FIELDS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


class Screen(Document):

    def before_insert(self):
        if not self.screen_id:
            self.screen_id = self._generate_screen_id()

    def after_insert(self):
        self._refresh_display_url()
        self._ensure_default_schedule_row()

    def on_update(self):
        self._refresh_display_url()

    def _generate_screen_id(self):
        chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        for _ in range(100):
            code = "".join(random.choices(chars, k=5))
            if not frappe.db.exists("Screen", {"screen_id": code}):
                return code
        frappe.throw("Could not generate a unique Screen ID.")

    def _refresh_display_url(self):
        site_url = frappe.utils.get_url()
        url = f"{site_url}/display/{self.screen_id}"
        if self.display_url != url:
            frappe.db.set_value("Screen", self.name, "display_url", url, update_modified=False)

    def _ensure_default_schedule_row(self):
        if self.default_playlist:
            doc = frappe.get_doc("Screen", self.name)
            if not doc.schedule:
                row = doc.append("schedule", {})
                row.playlist   = self.default_playlist
                row.start_time = datetime.time(0, 0, 0)
                row.end_time   = datetime.time(23, 59, 59)
                for day in _WEEKDAY_FIELDS:
                    setattr(row, day, 1)
                row.is_active  = 1
                doc.save(ignore_permissions=True)


def get_active_playlists(screen_name, now=None):
    if now is None:
        now = frappe.utils.now_datetime()

    current_time = now.time()
    weekday_field = _WEEKDAY_FIELDS[now.weekday()]

    rows = frappe.get_all(
        "Screen Schedule",
        filters={"parent": screen_name, "is_active": 1},
        fields=["playlist", "start_time", "end_time"] + _WEEKDAY_FIELDS,
        order_by="idx asc",
    )

    active_playlists = []
    seen = set()

    for row in rows:
        if not row.get(weekday_field):
            continue
        if not _time_in_window(current_time, row.start_time, row.end_time):
            continue
        if row.playlist and row.playlist not in seen:
            active_playlists.append(row.playlist)
            seen.add(row.playlist)

    return active_playlists


def _to_time(val):
    if isinstance(val, datetime.timedelta):
        s = int(val.total_seconds())
        return datetime.time(s // 3600 % 24, s % 3600 // 60, s % 60)
    if isinstance(val, datetime.time):
        return val
    parts = str(val).split(":")
    return datetime.time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)


def _time_in_window(t, start, end):
    start = _to_time(start)
    end   = _to_time(end)
    if start <= end:
        return start <= t <= end
    return t >= start or t <= end


@frappe.whitelist(allow_guest=True)
def get_content_for_screen(screen_id):
    """
    Single combined API — returns content AND records the heartbeat.
    This is the ONLY call the player makes (no separate heartbeat request),
    which is the main compute-usage fix: was 2 requests/poll, now 1.
    """
    screen = frappe.db.get_value(
        "Screen",
        {"screen_id": screen_id, "is_active": 1},
        ["name", "screen_name", "default_playlist"],
        as_dict=True,
    )
    if not screen:
        return {"error": f"Screen '{screen_id}' not found or inactive.", "items": []}

    # Heartbeat recorded here — same call the player already makes every poll
    frappe.db.set_value(
        "Screen", screen.name,
        {"is_live": 1, "last_seen": frappe.utils.now_datetime()},
        update_modified=False,
    )
    frappe.db.commit()

    site_url = frappe.utils.get_url()

    from signage_display.signage_display.doctype.playlist.playlist import get_playlist_content

    active_playlists = get_active_playlists(screen.name)

    if not active_playlists:
        if not screen.default_playlist:
            return {"error": "no_playlist", "items": []}
        active_playlists = [screen.default_playlist]

    merged_items = []
    for playlist_name in active_playlists:
        items = get_playlist_content(playlist_name, site_url)
        merged_items.extend(items)

    return {
        "screen_name": screen.screen_name,
        "active_playlists": active_playlists,
        "items": merged_items,
    }




@frappe.whitelist()
def pair_screen_by_id(screen_id):
    """
    Called by /pair page when admin scans a QR code or types a Screen ID.

    Two outcomes:
      1. Screen ID already exists in Frappe → confirm it and return its details.
      2. Screen ID is new (TV generated it itself, not yet in Frappe) → create
         a new Screen record using that exact ID and return it.

    The TV generates its own Screen ID on first boot and encodes it in the QR.
    This function is the bridge: it makes Frappe aware of that screen.
    """
    screen_id = (screen_id or "").strip().upper()
    if not screen_id or len(screen_id) != 5:
        frappe.throw("Invalid Screen ID — must be exactly 5 characters.")

    site_url  = frappe.utils.get_url()
    existing  = frappe.db.get_value(
        "Screen",
        {"screen_id": screen_id},
        ["name", "screen_name", "display_url", "is_active"],
        as_dict=True,
    )

    if existing:
        # Screen already registered — just return its info
        return {
            "created":      False,
            "screen_id":    screen_id,
            "screen_name":  existing.screen_name,
            "display_url":  existing.display_url or f"{site_url}/display/{screen_id}",
            "is_active":    existing.is_active,
        }

    # New screen — create it with the TV-supplied ID
    doc = frappe.new_doc("Screen")
    doc.screen_id   = screen_id           # override auto-generation
    doc.screen_name = f"Screen {screen_id}"
    doc.is_active   = 1
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "created":      True,
        "screen_id":    screen_id,
        "screen_name":  doc.screen_name,
        "display_url":  doc.display_url or f"{site_url}/display/{screen_id}",
        "is_active":    1,
    }


@frappe.whitelist(allow_guest=True)
def check_screen_paired(screen_id):
    """
    Called by the Android TV pairing screen every 5 seconds via polling.
    Returns {"paired": true/false} so the TV knows when an admin has
    scanned its QR code and registered it in Frappe.
    Guest access is required — the TV is not logged in at this point.
    """
    screen_id = (screen_id or "").strip().upper()
    exists = frappe.db.exists("Screen", {"screen_id": screen_id, "is_active": 1})
    return {"paired": bool(exists), "screen_id": screen_id}


def mark_screens_offline():
    """
    Scheduler: runs periodically. Marks screens offline after no heartbeat.
    Cutoff increased to 150s (was 90s) since the player now polls every
    60s instead of 30s — this avoids false "offline" flapping.
    """
    cutoff = frappe.utils.add_to_date(frappe.utils.now_datetime(), seconds=-150)
    frappe.db.sql(
        "UPDATE `tabScreen` SET is_live=0 WHERE is_live=1 "
        "AND (last_seen IS NULL OR last_seen < %s)",
        (cutoff,),
    )
    frappe.db.commit()


@frappe.whitelist()
def generate_screens(count=10, default_playlist=None):
    count = min(int(count), 50)
    created = []
    for _ in range(count):
        doc = frappe.new_doc("Screen")
        doc.screen_name = "New Screen"
        doc.is_active = 1
        if default_playlist:
            doc.default_playlist = default_playlist
        doc.insert(ignore_permissions=True)
        doc.screen_name = f"Screen {doc.screen_id}"
        doc.save(ignore_permissions=True)
        created.append({
            "screen_id": doc.screen_id,
            "screen_name": doc.screen_name,
            "display_url": doc.display_url,
        })
    frappe.db.commit()
    return {"created": len(created), "screens": created}
