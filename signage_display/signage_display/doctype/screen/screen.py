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


# ─────────────────────────────────────────────────────────────────────────────
#  SCHEDULING ENGINE
# ─────────────────────────────────────────────────────────────────────────────

def get_active_playlists(screen_name, now=None):
    """
    Returns a LIST of all playlists whose schedule slots are active right now.

    When multiple slots overlap in time (e.g. a "General" playlist running
    08:00–18:00 and a "Lunch Menu" playlist running 12:00–13:00 both active
    at 12:30), ALL matching playlists are returned and their content is merged
    into one combined playlist for the display.

    Returns [] if no slots match (caller uses default playlist).
    """
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
        # Avoid duplicate playlists (same playlist in multiple matching slots)
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
    # Overnight window e.g. 22:00–02:00
    return t >= start or t <= end


# ─────────────────────────────────────────────────────────────────────────────
#  PLAYER API
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_content_for_screen(screen_id):
    """
    Returns merged content from all currently-active schedule slots.

    Example: if slot A (General, 08:00-18:00) and slot B (Lunch, 12:00-13:00)
    both match at 12:30, the response combines content from BOTH playlists:
    [General item 1, General item 2, Lunch item 1, Lunch item 2, ...]
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

    from signage_display.signage_display.doctype.playlist.playlist import get_playlist_content

    # Get all currently-active playlists (may be multiple if slots overlap)
    active_playlists = get_active_playlists(screen.name)

    if not active_playlists:
        # No schedule slot matches — use default playlist
        if not screen.default_playlist:
            return {"error": "no_playlist", "items": []}
        active_playlists = [screen.default_playlist]

    # Merge content from ALL active playlists in order
    # No deduplication — each playlist plays fully even if they share content
    # Example: General playlist (08:00-18:00) + Lunch playlist (12:00-13:00)
    # at 12:30 shows: [General items...] + [Lunch items...]
    merged_items = []

    for playlist_name in active_playlists:
        items = get_playlist_content(playlist_name, site_url)
        merged_items.extend(items)

    return {
        "screen_name": screen.screen_name,
        "active_playlists": active_playlists,
        "items": merged_items,
    }


@frappe.whitelist(allow_guest=True)
def screen_heartbeat(screen_id):
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
    cutoff = frappe.utils.add_to_date(frappe.utils.now_datetime(), seconds=-90)
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
