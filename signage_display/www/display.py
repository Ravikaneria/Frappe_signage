import frappe


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = False

    settings = frappe.get_doc("Signage Settings")
    context.signage_settings = settings
    context.csrf_token = frappe.session.csrf_token

    # Detect screen_id from URL: /display/<screen_id>
    screen_id = frappe.form_dict.get("path", "").strip("/") or None
    context.screen_id = screen_id or ""

    if screen_id:
        screen = frappe.db.get_value(
            "Screen",
            {"screen_id": screen_id, "is_active": 1},
            ["screen_name"],
            as_dict=True,
        )
        if not screen:
            context.title = "Invalid Screen"
            context.error_message = f"Screen '{screen_id}' not found or inactive."
        else:
            context.title = screen.screen_name
            context.error_message = ""
    else:
        context.title = settings.display_name or "Signage Display"
        context.error_message = ""

    context.signages = frappe.db.get_list(
        "Signage",
        filters={"published": 1},
        fields=["title", "description", "display_image", "show_title",
                "content_type", "display_duration", "video_file", "youtube_embed_url"],
    )
    context.signage_height = 80 // (settings.row_count or 1)
    return context
