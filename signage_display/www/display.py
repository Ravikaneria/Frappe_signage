import frappe


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = False

    # Screen ID from URL: /display/<screen_id>
    screen_id = frappe.form_dict.get("screen_id", "").strip("/") or ""
    context.screen_id = screen_id

    settings = frappe.db.get_singles_dict("Signage Settings") or {}
    context.global_duration = int(settings.get("display_duration") or 10000)

    if screen_id:
        screen = frappe.db.get_value(
            "Screen",
            {"screen_id": screen_id, "is_active": 1},
            ["screen_name"],
            as_dict=True,
        )
        context.screen_title = screen.screen_name if screen else "Invalid Screen"
        context.error_message = "" if screen else f"Screen '{screen_id}' not found or inactive."
    else:
        context.screen_title = "Signage Display"
        context.error_message = ""

    context.title = context.screen_title
    return context
