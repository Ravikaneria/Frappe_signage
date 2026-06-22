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


class Content(Document):

    def validate(self):
        self._handle_youtube()
        self._auto_resize_image()
        self._handle_pdf()
        self._handle_url()

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

    def _handle_url(self):
        """Validate URL / Webpage URL fields."""
        for field, ctype in [("webpage_url", "Webpage"), ("redirect_url", "URL Redirect")]:
            if self.content_type == ctype:
                url = (getattr(self, field, "") or "").strip()
                if not url:
                    frappe.throw(f"URL is required for content type '{ctype}'.")
                if not (url.startswith("http://") or url.startswith("https://")):
                    frappe.throw("URL must start with http:// or https://")
                setattr(self, field, url)

    def _auto_resize_image(self):
        if self.content_type != "Image" or not self.media_image:
            return
        MAX_W, MAX_H = 1920, 1080
        try:
            from PIL import Image as PILImage
            import os
            file_doc = frappe.db.get_value(
                "File", {"file_url": self.media_image}, ["name"], as_dict=True
            )
            if not file_doc:
                return
            abs_path = frappe.get_doc("File", file_doc.name).get_full_path()
            if not os.path.exists(abs_path):
                return
            with PILImage.open(abs_path) as img:
                orig_w, orig_h = img.size
                if orig_w <= MAX_W and orig_h <= MAX_H:
                    return
                img = img.copy()
                img.thumbnail((MAX_W, MAX_H), PILImage.LANCZOS)
                fmt = img.format or "JPEG"
                save_kw = {"quality": 88, "optimize": True} if fmt in ("JPEG", "JPG") else {}
                img.save(abs_path, format=fmt, **save_kw)
            frappe.msgprint(
                f"Image resized from {orig_w}×{orig_h} → {img.size[0]}×{img.size[1]}",
                indicator="green", alert=True,
            )
        except ImportError:
            frappe.log_error("Pillow not installed", "Content Image Resize")
        except Exception as exc:
            frappe.log_error(str(exc), "Content Image Resize")

    def _handle_pdf(self):
        if self.content_type != "PDF":
            return
        if not self.pdf_file:
            frappe.throw("PDF File is required for content type 'PDF'.")
        if not self.has_value_changed("pdf_file") and self.get("pdf_pages_json"):
            return
        try:
            import fitz
            import os
            file_doc = frappe.db.get_value(
                "File", {"file_url": self.pdf_file}, ["name"], as_dict=True
            )
            if not file_doc:
                frappe.throw("Could not locate uploaded PDF file.")
            abs_path = frappe.get_doc("File", file_doc.name).get_full_path()
            if not os.path.exists(abs_path):
                frappe.throw("PDF file not found on disk.")
            doc = fitz.open(abs_path)
            if doc.page_count == 0:
                frappe.throw("The uploaded PDF has no pages.")
            if doc.page_count > 50:
                frappe.throw("PDF has too many pages (max 50).")
            site_path = frappe.get_site_path("public", "files", "signage_pdf_pages")
            os.makedirs(site_path, exist_ok=True)
            page_urls = []
            zoom = fitz.Matrix(2, 2)
            for i, page in enumerate(doc):
                pix = page.get_pixmap(matrix=zoom)
                fname = f"{self.name or frappe.generate_hash(length=8)}_page_{i+1}.png"
                pix.save(os.path.join(site_path, fname))
                page_urls.append(f"/files/signage_pdf_pages/{fname}")
            doc.close()
            self.pdf_pages_json = json.dumps(page_urls)
            frappe.msgprint(
                f"PDF converted: {len(page_urls)} page(s) ready.",
                indicator="green", alert=True,
            )
        except ImportError:
            frappe.throw(
                "PyMuPDF (fitz) is not installed. "
                "Run: pip install PyMuPDF --break-system-packages"
            )
        except Exception as exc:
            frappe.log_error(str(exc), "Content PDF Processing")
            frappe.throw(f"Failed to process PDF: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
#  SHARED FIELD LIST  (used by API and display.py)
# ─────────────────────────────────────────────────────────────────────────────
CONTENT_FIELDS = [
    "content_name", "content_type",
    "media_image", "video_file",
    "youtube_embed_url",
    "webpage_url", "redirect_url",
    "pdf_pages_json",
    "clock_format", "clock_show_date", "clock_timezone_label",
]


def format_content(row, site_url, duration_sec=None):
    """
    Convert a Content db row into the dict the player expects.
    duration_sec comes from the Playlist Item — not stored on Content itself.
    """
    item = dict(row)
    item["duration_sec"] = duration_sec or 0   # 0 → JS uses global default

    if item.get("media_image"):
        item["media_image"] = site_url + item["media_image"]
    if item.get("video_file"):
        item["video_file"] = site_url + item["video_file"]

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
