import random
import string
import datetime
import frappe
from frappe.model.document import Document

_WEEKDAY_FIELDS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

DEFAULT_SCHEDULE_ROW = {
    "playlist": None,   # filled after default playlist created
    "start_time": datetime.time(0, 0, 0),
    "end_time": datetime.time(23, 59, 59),
    "monday": 1, "tuesday": 1, "wednesday": 1, "thursday": 1,
    "friday": 1, "saturday": 1, "sunday": 1,
    "is_active": 1,
}


class Screen(Document):

    def before_insert(self):
        if not self.screen_id:
            self.screen_id = self._generate_screen_id()

    def after_insert(self):
        self._refresh_display_url()
        self._ensure_default_schedule_row()

    def on_update(self):
        self._refresh_display_url()

    # ── Screen ID: 5 alphanumeric characters (uppercase, no ambiguous chars) ──
    def _generate_screen_id(self):
        chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I to avoid confusion
        for _ in range(100):
            code = "".join(random.choices(chars, k=5))
            if not frappe.db.exists("Screen", {"screen_id": code}):
                return code
        frappe.throw("Could not generate a unique Screen ID. Please try again.")

    def _refresh_display_url(self):
        site_url = frappe.utils.get_url()
        url = f"{site_url}/display/{self.screen_id}"
        if self.display_url != url:
            frappe.db.set_value("Screen", self.name, "display_url", url, update_modified=False)

    def _ensure_default_schedule_row(self):
        """
        On first creation, add a default 00:00–23:59 all-days row pointing at
        the Default Playlist. This means if no other schedule matches, the
        default playlist always plays (fallback to 24/7 coverage).
        """
        if self.default_playlist:
            doc = frappe.get_doc("Screen", self.name)
            if not doc.schedule:
                row = doc.append("schedule", {})
                row.playlist     = self.default_playlist
                row.start_time   = datetime.time(0, 0, 0)
                row.end_time     = datetime.time(23, 59, 59)
                row.monday       = 1
                row.tuesday      = 1
                row.wednesday    = 1
                row.thursday     = 1
                row.friday       = 1
                row.saturday     = 1
                row.sunday       = 1
                row.is_active    = 1
                doc.save(ignore_permissions=True)


# ─────────────────────────────────────────────────────────────────────────────
#  SCHEDULING ENGINE — which playlist is active right now?
# ─────────────────────────────────────────────────────────────────────────────

def get_active_playlist(screen_name, now=None):
    """
    Given a Screen name, return the playlist_name that should be playing
    right now, or None if nothing matches (caller should use default playlist).

    Matching rules per schedule row (highest-priority = lowest idx wins):
      1. is_active must be 1
      2. Current weekday must be checked in the row
      3. Current time must be within [start_time, end_time]
         Overnight windows (e.g. 22:00–02:00) are handled correctly.
    """
    if now is None:
        now = frappe.utils.now_datetime()

    current_time = now.time()
    weekday_field = _WEEKDAY_FIELDS[now.weekday()]  # Monday=0 … Sunday=6

    rows = frappe.get_all(
        "Screen Schedule",
        filters={"parent": screen_name, "is_active": 1},
        fields=["playlist", "start_time", "end_time"] + _WEEKDAY_FIELDS,
        order_by="idx asc",
    )

    for row in rows:
        if not row.get(weekday_field):
            continue
        if not _time_in_window(current_time, row.start_time, row.end_time):
            continue
        return row.playlist

    return None


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
    # Overnight window e.g. 22:00–02:00
    return t >= start or t <= end


# ─────────────────────────────────────────────────────────────────────────────
#  PLAYER API
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_content_for_screen(screen_id):
    """
    Main API called by the player every 30 s.
    Returns the ordered content list for the currently-active playlist on
    this screen, or an error message if nothing is configured.
    """
    screen = frappe.db.get_value(
        "Screen",
        {"screen_id": screen_id, "is_active": 1},
        ["name", "screen_name", "default_playlist"],
        as_dict=True,
    )
    if not screen:
        return {"error": f"Screen '{screen_id}' not found or inactive.", "items": []}

    _record_heartbeat(screen.name)

    site_url = frappe.utils.get_url()

    # Determine which playlist is active right now
    active_playlist = get_active_playlist(screen.name) or screen.default_playlist

    if not active_playlist:
        return {"error": "no_playlist", "items": []}

    from signage_display.signage_display.doctype.playlist.playlist import get_playlist_content
    items = get_playlist_content(active_playlist, site_url)

    return {
        "screen_name": screen.screen_name,
        "active_playlist": active_playlist,
        "items": items,
    }


@frappe.whitelist(allow_guest=True)
def screen_heartbeat(screen_id):
    """Called every 30 s by the player to mark the screen as Live Now."""
    name = frappe.db.get_value("Screen", {"screen_id": screen_id}, "name")
    if name:
        _record_heartbeat(name)
    return {"status": "ok"}


def _record_heartbeat(screen_name):
    frappe.db.set_value(
        "Screen", screen_name,
        {"is_live": 1, "last_seen": frappe.utils.now_datetime()},
        update_modified=False,
    )
    frappe.db.commit()


def mark_screens_offline():
    """Scheduler: runs every minute. Marks screens offline after 90 s no heartbeat."""
    cutoff = frappe.utils.add_to_date(frappe.utils.now_datetime(), seconds=-90)
    frappe.db.sql(
        "UPDATE `tabScreen` SET is_live=0 WHERE is_live=1 AND (last_seen IS NULL OR last_seen < %s)",
        (cutoff,),
    )
    frappe.db.commit()


@frappe.whitelist()
def generate_screens(count=10, default_playlist=None):
    """Bulk-create Screen records. Called from the Screen List button."""
    count = min(int(count), 50)
    created = []
    for _ in range(count):
        doc = frappe.new_doc("Screen")
        doc.screen_name = f"Screen {doc.screen_id if hasattr(doc, 'screen_id') else ''}"
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
