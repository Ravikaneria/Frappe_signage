import frappe
from frappe.model.document import Document


class Playlist(Document):
    pass


def get_playlist_content(playlist_name, site_url):
    """
    Returns ordered active content items for a given Playlist.

    Note: does NOT filter by is_published on the Playlist itself here —
    the schedule assignment already implies the playlist is intended to play.
    Filtering by is_published is done at the Screen level when deciding
    whether to show the default playlist.
    """
    from signage_display.signage_display.doctype.content.content import (
        CONTENT_FIELDS, format_content
    )

    # Check the playlist exists (but do NOT filter by is_published here
    # — overlapping schedule slots need all assigned playlists to work,
    # regardless of their published state)
    if not frappe.db.exists("Playlist", {"playlist_name": playlist_name}):
        frappe.logger().warning(f"[Signage] Playlist not found: {playlist_name}")
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
