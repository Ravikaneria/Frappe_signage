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

    def before_insert(self):
        if not self.content_name:
            if self.media_image:
                base = self.media_image.split("/")[-1].rsplit(".", 1)[0]
            elif self.video_file:
                base = self.video_file.split("/")[-1].rsplit(".", 1)[0]
            elif self.pdf_file:
                base = self.pdf_file.split("/")[-1].rsplit(".", 1)[0]
            else:
                base = self.name or frappe.generate_hash(length=8)
            self.content_name = re.sub(r"[^a-zA-Z0-9 _-]", "", base)[:60].strip() or self.name

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
            frappe.throw("Invalid YouTube URL.")
        self.youtube_embed_url = (
            f"https://www.youtube.com/embed/{vid_id}"
            f"?autoplay=1&mute=0&loop=1&playlist={vid_id}"
            f"&controls=0&modestbranding=1&rel=0&enablejsapi=1"
        )

    def _handle_url(self):
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
            file_doc = frappe.db.get_value("File", {"file_url": self.media_image}, ["name"], as_dict=True)
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
                save_kw = {"quality": 88, "optimize": True} if fmt in ("JPEG","JPG") else {}
                img.save(abs_path, format=fmt, **save_kw)
        except ImportError:
            pass
        except Exception as exc:
            frappe.log_error(str(exc), "Content Image Resize")

    def _handle_pdf(self):
        if self.content_type != "PDF":
            return
        if not self.pdf_file:
            frappe.throw("PDF File is required.")
        if not self.has_value_changed("pdf_file") and self.get("pdf_pages_json"):
            return
        try:
            import fitz
            import os
            file_doc = frappe.db.get_value("File", {"file_url": self.pdf_file}, ["name"], as_dict=True)
            if not file_doc:
                frappe.throw("Could not locate uploaded PDF file.")
            abs_path = frappe.get_doc("File", file_doc.name).get_full_path()
            doc = fitz.open(abs_path)
            if doc.page_count == 0:
                frappe.throw("PDF has no pages.")
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
        except ImportError:
            frappe.throw("PyMuPDF not installed.")
        except Exception as exc:
            frappe.log_error(str(exc), "Content PDF")
            frappe.throw(f"PDF processing failed: {exc}")


CONTENT_FIELDS = [
    "name", "content_name", "content_type",
    "media_image", "video_file",
    "youtube_embed_url",
    "webpage_url", "redirect_url",
    "pdf_pages_json",
    "clock_format", "clock_show_date", "clock_timezone_label",
]


def format_content(row, site_url, duration_sec=None):
    item = dict(row)
    item["duration_sec"] = duration_sec or 0
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


@frappe.whitelist()
def create_content_from_upload(file_url, content_type, content_name=None):
    doc = frappe.new_doc("Content")
    doc.content_type = content_type
    doc.content_name = content_name or ""
    if content_type == "Image":
        doc.media_image = file_url
    elif content_type == "Video":
        doc.video_file = file_url
    elif content_type == "PDF":
        doc.pdf_file = file_url
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name, "content_name": doc.content_name}
