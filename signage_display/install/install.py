"""
signage_display/install/install.py

Runs once when the app is installed via `bench install-app signage_display`
or when triggered manually. Ensures all DocType permissions are correctly
written to the database — fixing the "New button missing" issue that can
occur on Frappe Cloud shared hosting where migrate alone doesn't always
re-apply DocType-level permissions.
"""

import frappe


DOCTYPES_WITH_PERMISSIONS = ["Content", "Playlist", "Screen"]
ROLES = ["Administrator", "System Manager"]


def after_install():
    """Called automatically by Frappe after `bench install-app`."""
    setup_permissions()
    frappe.db.commit()


def setup_permissions():
    """
    Ensures the Content, Playlist, and Screen DocTypes have full
    create/write/delete permissions for Administrator and System Manager.
    Safe to call multiple times — skips existing permissions.
    """
    for doctype in DOCTYPES_WITH_PERMISSIONS:
        if not frappe.db.exists("DocType", doctype):
            frappe.log_error(
                f"DocType '{doctype}' not found during permission setup — "
                "run bench migrate first.",
                "Signage Display Install"
            )
            continue

        for role in ROLES:
            if not frappe.db.exists("DocPerm", {"parent": doctype, "role": role}):
                perm = frappe.new_doc("DocPerm")
                perm.parent    = doctype
                perm.parenttype = "DocType"
                perm.parentfield = "permissions"
                perm.role      = role
                perm.read      = 1
                perm.write     = 1
                perm.create    = 1
                perm.delete    = 1
                perm.submit    = 0
                perm.cancel    = 0
                perm.amend     = 0
                perm.report    = 1
                perm.export    = 1
                perm.import_   = 0
                perm.share     = 1
                perm.print_    = 1
                perm.email     = 1
                perm.insert(ignore_permissions=True)
                frappe.logger().info(
                    f"[Signage Display] Added {role} permission on {doctype}"
                )
            else:
                # Permission exists — ensure create=1 and write=1 are set
                frappe.db.set_value(
                    "DocPerm",
                    {"parent": doctype, "role": role},
                    {"create": 1, "write": 1, "read": 1, "delete": 1},
                    update_modified=False,
                )

        # Clear Frappe's DocType permission cache for this DocType
        frappe.clear_cache(doctype=doctype)
