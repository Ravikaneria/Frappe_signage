import frappe


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = False

    # Read screen_id from URL: /display/<screen_id>
    # Frappe passes the path segment via frappe.form_dict when using
    # website_route_rules: {"from_route": "/display/<path:screen_id>", "to_route": "display"}
    screen_id = frappe.form_dict.get("screen_id", "").strip("/") or ""
    context.screen_id = screen_id

    # Global display duration from Signage Settings (in ms)
    try:
        settings = frappe.db.get_singles_dict("Signage Settings") or {}
        context.global_duration = int(settings.get("display_duration") or 10000)
    except Exception:
        context.global_duration = 10000

    # CSRF token for API calls
    context.csrf_token = frappe.session.csrf_token or "Guest"

    # Screen title and error message
    if screen_id:
        screen = frappe.db.get_value(
            "Screen",
            {"screen_id": screen_id, "is_active": 1},
            ["screen_name"],
            as_dict=True,
        )
        if not screen:
            context.screen_title = "Invalid Screen"
            context.error_message = f"Screen '{screen_id}' not found or inactive."
        else:
            context.screen_title = screen.screen_name
            context.error_message = ""
    else:
        context.screen_title = "Signage Display"
        context.error_message = "No screen ID in URL."

    context.title = context.screen_title
    return context
