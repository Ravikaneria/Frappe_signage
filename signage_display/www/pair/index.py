import frappe


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = False
    context.title = "Pair Screen"

    # Must be logged in — this is an admin action
    if frappe.session.user == "Guest":
        frappe.throw("Please login to pair a screen.", frappe.PermissionError)

    try:
        context.csrf_token = frappe.sessions.get_csrf_token()
    except Exception:
        context.csrf_token = frappe.local.session.data.get("csrf_token", "")

    return context
