import frappe

DOCTYPES = ["Content", "Playlist", "Screen"]
ROLES    = ["Administrator", "System Manager", "System Integrator"]


def after_install():
    setup_permissions()
    frappe.db.commit()


def setup_permissions():
    for doctype in DOCTYPES:
        if not frappe.db.exists("DocType", doctype):
            continue
        for role in ROLES:
            existing = frappe.db.exists("DocPerm", {"parent": doctype, "role": role})
            if not existing:
                perm = frappe.new_doc("DocPerm")
                perm.parent      = doctype
                perm.parenttype  = "DocType"
                perm.parentfield = "permissions"
                perm.role        = role
                perm.read        = 1
                perm.write       = 1
                perm.create      = 1
                perm.delete      = 1
                perm.submit      = 0
                perm.cancel      = 0
                perm.amend       = 0
                perm.report      = 1
                perm.export      = 1
                perm.share       = 1
                perm.print_      = 1
                perm.email       = 1
                perm.insert(ignore_permissions=True)
            else:
                frappe.db.set_value(
                    "DocPerm",
                    {"parent": doctype, "role": role},
                    {"create": 1, "write": 1, "read": 1, "delete": 1},
                    update_modified=False,
                )
        frappe.clear_cache(doctype=doctype)
        frappe.logger().info(f"[Signage] Permissions set for {doctype}")
