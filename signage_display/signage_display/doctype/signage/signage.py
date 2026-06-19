import re
import frappe
from frappe.model.document import Document

_YT_RE = re.compile(
    r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/shorts/)"
    r"([A-Za-z0-9_-]{11})"
)

def _extract_yt_id(url):
    m = _YT_RE.search(url or "")
    return m.group(1) if m else None


class Signage(Document):

    def validate(self):
        self._handle_youtube()
        self._auto_resize_image()
        self._handle_webpage()

    def _handle_webpage(self):
        if self.content_type != "Webpage":
            return
        url = (self.webpage_url or "").strip()
        if not url:
            frappe.throw("Webpage URL is required for content type 'Webpage'.")
        if not (url.startswith("http://") or url.startswith("https://")):
            frappe.throw("Webpage URL must start with http:// or https://")
        self.webpage_url = url

    def _handle_youtube(self):
        if self.content_type != "YouTube":
            self.youtube_embed_url = ""
            return
        vid_id = _extract_yt_id(self.youtube_url)
        if not vid_id:
            frappe.throw(
                "Invalid YouTube URL. Use a link like: "
                "https://www.youtube.com/watch?v=XXXXXXXXXXX"
            )
        self.youtube_embed_url = (
            f"https://www.youtube.com/embed/{vid_id}"
            f"?autoplay=1&mute=0&loop=1&playlist={vid_id}"
            f"&controls=0&modestbranding=1&rel=0&enablejsapi=1"
        )

    def _auto_resize_image(self):
        if self.content_type not in ("Image", None, "") or not self.display_image:
            return
        MAX_W, MAX_H = 1920, 1080
        try:
            from PIL import Image as PILImage
            import os
            file_doc = frappe.db.get_value(
                "File", {"file_url": self.display_image}, ["name"], as_dict=True
            )
            if not file_doc:
                return
            file_obj = frappe.get_doc("File", file_doc.name)
            abs_path = file_obj.get_full_path()
            if not os.path.exists(abs_path):
                return
            with PILImage.open(abs_path) as img:
                orig_w, orig_h = img.size
                if orig_w <= MAX_W and orig_h <= MAX_H:
                    return
                img = img.copy()
                img.thumbnail((MAX_W, MAX_H), PILImage.LANCZOS)
                fmt = img.format or "JPEG"
                save_kwargs = {"quality": 88, "optimize": True} if fmt in ("JPEG","JPG") else ({"optimize": True} if fmt == "PNG" else {})
                img.save(abs_path, format=fmt, **save_kwargs)
            frappe.msgprint(
                f"Image resized from {orig_w}x{orig_h} to {img.size[0]}x{img.size[1]}",
                indicator="green", alert=True,
            )
        except ImportError:
            frappe.log_error("Pillow not installed — image resize skipped", "Signage")
        except Exception as exc:
            frappe.log_error(f"Image resize error: {exc}", "Signage Image Resize")

    def on_update(self):
        pass

    def after_delete(self):
        pass


# ─────────────────────────────────────────────────────────────────────────────
#  SHARED HELPER
# ─────────────────────────────────────────────────────────────────────────────

def _format_signage(row, site_url, duration_override_sec=None):
    """
    Convert a Signage db row into the dict the player expects.
    display_duration is returned in SECONDS. display.js multiplies by 1000 → ms.
    """
    item = dict(row)

    # Use per-screen duration override if provided (also in seconds),
    # else keep the signage's own value in seconds (0 = use global setting in JS).
    if duration_override_sec is not None:
        item["display_duration"] = duration_override_sec
    else:
        item["display_duration"] = item.get("display_duration") or 0

    if item.get("display_image"):
        item["display_image"] = site_url + item["display_image"]
    if item.get("video_file"):
        item["video_file"] = site_url + item["video_file"]
    return item


# ─────────────────────────────────────────────────────────────────────────────
#  API  — all published signages  (legacy /display URL or show_all_signages=1)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_all_signages():
    """Returns all published signages. Called by display.js when no screen_id."""
    site_url = frappe.utils.get_url()
    rows = frappe.db.get_list(
        "Signage",
        filters={"published": 1},
        fields=[
            "title", "description", "show_title",
            "content_type", "display_duration",
            "display_image", "video_file", "youtube_embed_url", "webpage_url",
        ],
    )
    return [_format_signage(r, site_url) for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
#  API  — signages for a specific screen
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_signages_for_screen(screen_id):
    """
    Returns the correct signage list for a screen:
      - If show_all_signages = 1  →  all published signages (same as get_all_signages)
      - If show_all_signages = 0  →  only the signages in the Screen's child table,
                                     in the order they were added, active rows only
    Also records the heartbeat so ERPNext shows the screen as Live Now.
    """
    screen = frappe.db.get_value(
        "Screen",
        {"screen_id": screen_id, "is_active": 1},
        ["name", "screen_name", "show_all_signages"],
        as_dict=True,
    )
    if not screen:
        frappe.throw(
            f"Screen '{screen_id}' not found or inactive.",
            frappe.DoesNotExistError
        )

    _record_heartbeat(screen_id)

    site_url = frappe.utils.get_url()

    # ── Show all published signages ──────────────────────────────────────────
    if screen.show_all_signages:
        return get_all_signages()

    # ── Show only assigned signages ──────────────────────────────────────────
    assigned = frappe.get_all(
        "Screen Signage Item",
        filters={"parent": screen.name, "is_active": 1},
        fields=["signage", "duration_override"],
        order_by="idx asc",
    )

    if not assigned:
        # No signages assigned yet — return empty so player shows "No content"
        return []

    result = []
    for item in assigned:
        row = frappe.db.get_value(
            "Signage",
            {"name": item.signage, "published": 1},
            [
                "title", "description", "show_title",
                "content_type", "display_duration",
                "display_image", "video_file", "youtube_embed_url", "webpage_url",
            ],
            as_dict=True,
        )
        if not row:
            continue  # signage not published or deleted — skip

        # Per-row duration override (convert seconds → ms; 0 means use signage default)
        # Pass raw seconds — _format_signage stores as seconds, JS converts to ms
        override_sec = item.duration_override if item.duration_override else None
        result.append(_format_signage(row, site_url, override_sec))

    return result


# ─────────────────────────────────────────────────────────────────────────────
#  HEARTBEAT
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def screen_heartbeat(screen_id):
    """Called every 30s by the player to mark the screen as Live Now in ERPNext."""
    _record_heartbeat(screen_id)
    return {"status": "ok"}


def _record_heartbeat(screen_id):
    name = frappe.db.get_value("Screen", {"screen_id": screen_id}, "name")
    if not name:
        return
    frappe.db.set_value(
        "Screen", name,
        {"is_live": 1, "last_seen": frappe.utils.now_datetime()},
        update_modified=False,
    )
    frappe.db.commit()
