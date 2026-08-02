import frappe
from frappe.model.document import Document


class Playlist(Document):
    pass


def get_playlist_content(playlist_name, site_url):
    """
    Returns ordered active content items for a given Playlist.
    """
    from signage_display.signage_display.doctype.content.content import (
        CONTENT_FIELDS, format_content
    )

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


# ─────────────────────────────────────────────────────────────────────────────
#  Direct child-row updates — avoid TimestampMismatchError entirely
#
#  Editing a child table row through a full doc.save() cycle is prone to
#  TimestampMismatchError when the browser fires onchange rapidly (common
#  with number inputs) or two edits overlap. Since each Playlist Item row
#  has its own independent `name` in the database, we can update/delete it
#  directly with frappe.db — this never touches the parent Playlist's
#  modified timestamp, so there's nothing to conflict with.
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def update_item_duration(item_name, duration_sec):
    """Directly updates one Playlist Item row's duration — no parent save, no race condition."""
    if not frappe.db.exists("Playlist Item", item_name):
        frappe.throw("Playlist item not found.")
    duration = max(1, min(3600, int(duration_sec)))
    frappe.db.set_value("Playlist Item", item_name, "duration_sec", duration, update_modified=False)
    frappe.db.commit()
    return {"status": "ok", "duration_sec": duration}


@frappe.whitelist()
def remove_playlist_item(item_name):
    """Directly deletes one Playlist Item row — no parent save, no race condition."""
    if not frappe.db.exists("Playlist Item", item_name):
        return {"status": "ok"}  # already gone
    frappe.delete_doc("Playlist Item", item_name, ignore_permissions=True, force=True)
    frappe.db.commit()
    return {"status": "ok"}


@frappe.whitelist()
def add_items_to_playlist(playlist_name, content_names, default_duration=10):
    """
    Adds new Content items to a Playlist, skipping any that are already present.
    Uses direct child-row inserts instead of a full parent doc.save() to avoid
    timestamp conflicts if the parent was edited elsewhere in the meantime.
    """
    import json
    if isinstance(content_names, str):
        content_names = json.loads(content_names)

    if not frappe.db.exists("Playlist", playlist_name):
        frappe.throw("Playlist not found.")

    existing = set(frappe.get_all(
        "Playlist Item",
        filters={"parent": playlist_name},
        pluck="content",
    ))

    # Find current max idx to append new rows after existing ones
    max_idx = frappe.db.sql(
        "SELECT COALESCE(MAX(idx), 0) FROM `tabPlaylist Item` WHERE parent = %s",
        (playlist_name,),
    )[0][0] or 0

    added = 0
    for content_name in content_names:
        if content_name in existing:
            continue
        max_idx += 1
        child = frappe.get_doc({
            "doctype": "Playlist Item",
            "parent": playlist_name,
            "parenttype": "Playlist",
            "parentfield": "items",
            "idx": max_idx,
            "content": content_name,
            "duration_sec": int(default_duration) or 10,
            "is_active": 1,
        })
        child.insert(ignore_permissions=True)
        added += 1

    frappe.db.commit()
    return {"status": "ok", "added": added}
