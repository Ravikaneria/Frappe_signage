import frappe
from frappe.model.document import Document


class Playlist(Document):
    pass


def get_playlist_content(playlist_name, site_url):
    """
    Returns the ordered, active content items for a given Playlist.
    Called by the player API.
    """
    from signage_display.signage_display.doctype.content.content import (
        CONTENT_FIELDS, format_content
    )

    playlist = frappe.db.get_value(
        "Playlist",
        {"playlist_name": playlist_name, "is_published": 1},
        ["name"],
        as_dict=True,
    )
    if not playlist:
        return []

    items = frappe.get_all(
        "Playlist Item",
        filters={"parent": playlist_name, "is_active": 1},
        fields=["content", "duration_sec"],
        order_by="idx asc",
    )

    result = []
    for item in items:
        row = frappe.db.get_value(
            "Content",
            {"content_name": item.content},
            CONTENT_FIELDS,
            as_dict=True,
        )
        if not row:
            continue
        result.append(format_content(row, site_url, item.duration_sec))

    return result
