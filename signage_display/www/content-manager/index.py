import frappe


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = False
    context.title = "Content Manager"

    # Check if user is logged in
    if frappe.session.user == "Guest":
        frappe.throw("Please login to access Content Manager", frappe.PermissionError)

    context.csrf_token = frappe.session.csrf_token
    return context
