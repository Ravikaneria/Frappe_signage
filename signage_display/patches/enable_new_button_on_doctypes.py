"""
patch: enable_new_button_on_doctypes
Directly sets in_create = 1 on Content, Playlist, Screen in the database
and resets DocPerm rows so the New button appears in the list view.
"""
import frappe


def execute():
    doctypes = ["Content", "Playlist", "Screen"]
    roles = ["Administrator", "System Manager"]

    for dt in doctypes:
        if not frappe.db.exists("DocType", dt):
            continue

        # Force in_create = 1 directly in the database
        frappe.db.set_value("DocType", dt, "in_create", 1, update_modified=False)

        # Ensure DocPerm rows exist with create = 1
        for role in roles:
            filters = {"parent": dt, "role": role, "permlevel": 0}
            if frappe.db.exists("DocPerm", filters):
                frappe.db.set_value("DocPerm", filters, {
                    "read": 1, "write": 1, "create": 1,
                    "delete": 1, "report": 1, "export": 1,
                    "share": 1, "print": 1, "email": 1,
                }, update_modified=False)
            else:
                doc = frappe.new_doc("DocPerm")
                doc.parent = dt
                doc.parenttype = "DocType"
                doc.parentfield = "permissions"
                doc.role = role
                doc.permlevel = 0
                doc.read = 1
                doc.write = 1
                doc.create = 1
                doc.delete = 1
                doc.report = 1
                doc.export = 1
                doc.share = 1
                doc.print_ = 1
                doc.email = 1
                doc.insert(ignore_permissions=True)

        # Clear cache so ERPNext picks up the changes immediately
        frappe.clear_cache(doctype=dt)

    frappe.db.commit()
    frappe.logger().info("[Signage Display] New button patch applied successfully")
