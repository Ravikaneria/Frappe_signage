import frappe


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = False
    context.title = "Content Manager"

    if frappe.session.user == "Guest":
        frappe.throw("Please login to access Content Manager", frappe.PermissionError)

    # Use Frappe's proper CSRF token helper — frappe.session.csrf_token
    # is not reliable on website/portal pages and can return a stale or
    # invalid token. frappe.sessions.get_csrf_token() is the correct,
    # canonical way to get a valid token for POST requests from here.
    try:
        context.csrf_token = frappe.sessions.get_csrf_token()
    except Exception:
        # Fallback for older Frappe versions
        context.csrf_token = frappe.local.session.data.get("csrf_token", "")

    return context
