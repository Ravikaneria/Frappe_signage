import frappe
from frappe.model.document import Document


class ScreenGroup(Document):

    def on_update(self):
        self._refresh_screen_count()

    def on_trash(self):
        # Unlink screens from this group before deletion (don't cascade-delete screens)
        frappe.db.sql(
            "UPDATE `tabScreen` SET screen_group = NULL WHERE screen_group = %s",
            (self.name,),
        )

    def _refresh_screen_count(self):
        count = frappe.db.count("Screen", {"screen_group": self.name})
        if count != self.screen_count:
            frappe.db.set_value(
                "Screen Group", self.name, "screen_count", count, update_modified=False
            )
