import uuid
import frappe
from frappe.model.document import Document


class Screen(Document):

    def before_insert(self):
        if not self.screen_id:
            self.screen_id = uuid.uuid4().hex[:12].upper()

    def validate(self):
        # Keep legacy show_all_signages flag in sync with content_mode
        # so any old code/reports relying on it still behave correctly.
        self.show_all_signages = 1 if self.content_mode == "Show All Published" else 0

    def after_insert(self):
        self._refresh_display_url()
        self._refresh_group_count()

    def on_update(self):
        self._refresh_display_url()
        self._refresh_group_count()

    def on_trash(self):
        self._refresh_group_count(removing=True)

    def _refresh_display_url(self):
        site_url = frappe.utils.get_url()
        url = f"{site_url}/display/{self.screen_id}"
        if self.display_url != url:
            frappe.db.set_value(
                "Screen", self.name, "display_url", url, update_modified=False
            )

    def _refresh_group_count(self, removing=False):
        """Update the screen_count on this screen's group, and the previous
        group if the group assignment just changed."""
        groups_to_refresh = set()
        if self.screen_group:
            groups_to_refresh.add(self.screen_group)

        # Also refresh the previous group if it changed (handles re-assignment)
        if not removing and self.has_value_changed("screen_group"):
            prev = self.get_doc_before_save()
            if prev and prev.screen_group:
                groups_to_refresh.add(prev.screen_group)

        for group_name in groups_to_refresh:
            if frappe.db.exists("Screen Group", group_name):
                count = frappe.db.count("Screen", {"screen_group": group_name})
                frappe.db.set_value(
                    "Screen Group", group_name, "screen_count", count, update_modified=False
                )


def mark_screens_offline():
    """Scheduler: runs every minute. Marks screens offline if no heartbeat for 90s."""
    cutoff = frappe.utils.add_to_date(frappe.utils.now_datetime(), seconds=-90)
    frappe.db.sql(
        """
        UPDATE `tabScreen`
        SET is_live = 0
        WHERE is_live = 1
          AND (last_seen IS NULL OR last_seen < %s)
        """,
        (cutoff,),
    )
    frappe.db.commit()


@frappe.whitelist()
def generate_screens(count=50, prefix="Screen", screen_group=None):
    """Bulk-create Screen records. Called from the Screen List button.
    Optionally assigns all created screens to a Screen Group."""
    count = min(int(count), 50)
    created = []
    for i in range(1, count + 1):
        name = f"{prefix}-{str(i).zfill(2)}"
        if frappe.db.exists("Screen", {"screen_name": name}):
            continue
        doc = frappe.new_doc("Screen")
        doc.screen_name = name
        doc.is_active = 1
        doc.content_mode = "Show All Published"
        if screen_group:
            doc.screen_group = screen_group
        doc.insert(ignore_permissions=True)
        created.append({
            "name": doc.name,
            "screen_id": doc.screen_id,
            "screen_name": doc.screen_name,
            "display_url": doc.display_url,
        })
    frappe.db.commit()
    return {"created": len(created), "screens": created}


@frappe.whitelist()
def bulk_assign_group(screen_names, screen_group):
    """Assign a list of screens to a Screen Group in one call (used by list view bulk action)."""
    import json
    if isinstance(screen_names, str):
        screen_names = json.loads(screen_names)

    updated = 0
    for name in screen_names:
        frappe.db.set_value("Screen", name, "screen_group", screen_group)
        updated += 1
    frappe.db.commit()

    if screen_group:
        count = frappe.db.count("Screen", {"screen_group": screen_group})
        frappe.db.set_value("Screen Group", screen_group, "screen_count", count, update_modified=False)

    return {"updated": updated}
