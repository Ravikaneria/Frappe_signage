import re
import json
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
        self._handle_pdf()

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
                save_kwargs = {"quality": 88, "optimize": True} if fmt in ("JPEG", "JPG") else ({"optimize": True} if fmt == "PNG" else {})
                img.save(abs_path, format=fmt, **save_kwargs)
            frappe.msgprint(
                f"Image resized from {orig_w}x{orig_h} to {img.size[0]}x{img.size[1]}",
                indicator="green", alert=True,
            )
        except ImportError:
            frappe.log_error("Pillow not installed — image resize skipped", "Signage")
        except Exception as exc:
            frappe.log_error(f"Image resize error: {exc}", "Signage Image Resize")

    def _handle_pdf(self):
        """
        On save, if content_type is PDF and pdf_file changed, convert each PDF
        page into a PNG image and store the list of image URLs as JSON in a
        hidden field (pdf_pages_json) for the player to cycle through.
        Requires PyMuPDF (fitz) — falls back gracefully with a warning if missing.
        """
        if self.content_type != "PDF":
            return
        if not self.pdf_file:
            frappe.throw("PDF File is required for content type 'PDF'.")

        # Only re-render if the PDF file actually changed (avoid re-processing on every save)
        if not self.has_value_changed("pdf_file") and self.get("pdf_pages_json"):
            return

        try:
            import fitz  # PyMuPDF
            import os

            file_doc = frappe.db.get_value(
                "File", {"file_url": self.pdf_file}, ["name"], as_dict=True
            )
            if not file_doc:
                frappe.throw("Could not locate uploaded PDF file.")

            file_obj = frappe.get_doc("File", file_doc.name)
            pdf_path = file_obj.get_full_path()
            if not os.path.exists(pdf_path):
                frappe.throw("PDF file not found on disk.")

            doc = fitz.open(pdf_path)
            if doc.page_count == 0:
                frappe.throw("The uploaded PDF has no pages.")
            if doc.page_count > 50:
                frappe.throw("PDF has too many pages (max 50 supported for signage).")

            site_path = frappe.get_site_path("public", "files", "signage_pdf_pages")
            os.makedirs(site_path, exist_ok=True)

            page_urls = []
            zoom_matrix = fitz.Matrix(2, 2)  # ~144 DPI, sharp enough for TV

            for i, page in enumerate(doc):
                pix = page.get_pixmap(matrix=zoom_matrix)
                filename = f"{self.name or frappe.generate_hash(length=8)}_page_{i+1}.png"
                out_path = os.path.join(site_path, filename)
                pix.save(out_path)
                page_urls.append(f"/files/signage_pdf_pages/{filename}")

            doc.close()
            self.pdf_pages_json = json.dumps(page_urls)

            frappe.msgprint(
                f"PDF converted: {len(page_urls)} page(s) ready for display.",
                indicator="green", alert=True,
            )

        except ImportError:
            frappe.throw(
                "PyMuPDF (fitz) is not installed on the server. "
                "Ask your administrator to run: pip install PyMuPDF --break-system-packages"
            )
        except Exception as exc:
            frappe.log_error(f"PDF processing error: {exc}", "Signage PDF Processing")
            frappe.throw(f"Failed to process PDF: {exc}")

    def on_update(self):
        pass

    def after_delete(self):
        pass


# ─────────────────────────────────────────────────────────────────────────────
#  SHARED HELPER
# ─────────────────────────────────────────────────────────────────────────────

_SIGNAGE_FIELDS = [
    "title", "description", "show_title",
    "content_type", "display_duration",
    "display_image", "video_file", "youtube_embed_url", "webpage_url",
    "pdf_pages_json", "pdf_page_duration",
    "clock_format", "clock_show_date", "clock_timezone_label",
]


def _format_signage(row, site_url, duration_override_sec=None):
    """
    Convert a Signage db row into the dict the player expects.
    display_duration is returned in SECONDS. display.js multiplies by 1000 → ms.
    """
    item = dict(row)

    if duration_override_sec is not None:
        item["display_duration"] = duration_override_sec
    else:
        item["display_duration"] = item.get("display_duration") or 0

    if item.get("display_image"):
        item["display_image"] = site_url + item["display_image"]
    if item.get("video_file"):
        item["video_file"] = site_url + item["video_file"]

    # PDF pages: stored as JSON string of relative paths -> expand to absolute URLs
    if item.get("pdf_pages_json"):
        try:
            pages = json.loads(item["pdf_pages_json"])
            item["pdf_pages"] = [site_url + p for p in pages]
        except Exception:
            item["pdf_pages"] = []
    else:
        item["pdf_pages"] = []
    item.pop("pdf_pages_json", None)

    return item


def _fetch_signage_row(signage_name):
    return frappe.db.get_value(
        "Signage",
        {"name": signage_name, "published": 1},
        _SIGNAGE_FIELDS,
        as_dict=True,
    )


def _build_result_from_items(items, site_url):
    """items: list of dicts/rows with .signage and .duration_override"""
    result = []
    for item in items:
        row = _fetch_signage_row(item["signage"] if isinstance(item, dict) else item.signage)
        if not row:
            continue
        duration_override = item["duration_override"] if isinstance(item, dict) else item.duration_override
        override_sec = duration_override if duration_override else None
        result.append(_format_signage(row, site_url, override_sec))
    return result


# ─────────────────────────────────────────────────────────────────────────────
#  API  — all published signages  (legacy /display URL or Show All Published)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_all_signages():
    """Returns all published signages. Called by display.js when no screen_id."""
    site_url = frappe.utils.get_url()
    rows = frappe.db.get_list(
        "Signage",
        filters={"published": 1},
        fields=_SIGNAGE_FIELDS,
    )
    return [_format_signage(r, site_url) for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
#  API  — signages for a specific screen
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def get_signages_for_screen(screen_id):
    """
    Returns the correct signage list for a screen based on its Content Mode:
      - Show All Published  → every published Signage
      - Manual Signage List → only the signages in the Screen's own child table
      - Use Schedule        → evaluates the active Signage Schedule (screen's own,
                               or inherited from its Screen Group) and returns the
                               signages of whichever Schedule Rule matches right now
    Also records the heartbeat so ERPNext shows the screen as Live Now.
    """
    screen = frappe.db.get_value(
        "Screen",
        {"screen_id": screen_id, "is_active": 1},
        ["name", "screen_name", "content_mode", "show_all_signages",
         "signage_schedule", "screen_group"],
        as_dict=True,
    )
    if not screen:
        frappe.throw(
            f"Screen '{screen_id}' not found or inactive.",
            frappe.DoesNotExistError
        )

    _record_heartbeat(screen_id)
    site_url = frappe.utils.get_url()

    mode = screen.content_mode or ("Show All Published" if screen.show_all_signages else "Manual Signage List")

    # ── Show all published signages ──────────────────────────────────────────
    if mode == "Show All Published":
        return get_all_signages()

    # ── Manual signage list ──────────────────────────────────────────────────
    if mode == "Manual Signage List":
        assigned = frappe.get_all(
            "Screen Signage Item",
            filters={"parent": screen.name, "is_active": 1},
            fields=["signage", "duration_override"],
            order_by="idx asc",
        )
        if not assigned:
            return []
        return _build_result_from_items(assigned, site_url)

    # ── Use Schedule ──────────────────────────────────────────────────────────
    if mode == "Use Schedule":
        schedule_name = screen.signage_schedule

        # Inherit from group if screen has no schedule of its own
        if not schedule_name and screen.screen_group:
            schedule_name = frappe.db.get_value(
                "Screen Group", screen.screen_group, "default_schedule"
            )

        if not schedule_name:
            return []  # No schedule configured anywhere — nothing to show

        from signage_display.signage_display.doctype.signage_schedule.signage_schedule import get_active_rule

        rule = get_active_rule(schedule_name)

        if rule and rule.get("signages"):
            return _build_result_from_items(rule["signages"], site_url)

        # No rule matched (or matched rule has no signages) — check fallback
        schedule_doc = frappe.db.get_value(
            "Signage Schedule", schedule_name, "fallback_show_all_published"
        )
        if schedule_doc:
            return get_all_signages()
        return []

    # Unknown mode — safe fallback
    return get_all_signages()


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
