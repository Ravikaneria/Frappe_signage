import frappe


def get_context(context):
    context.no_cache = 1
    context.show_sidebar = False

    settings = frappe.get_doc("Signage Settings")
    context.signage_settings = settings
    context.csrf_token = frappe.session.csrf_token

    # Detect screen_id from URL: /display/<screen_id>
    screen_id = frappe.form_dict.get("screen_id", "").strip("/") or ""
    context.screen_id = screen_id

    # ── Resolve screen and set top-level template variables ──────────────────
    # IMPORTANT: Do NOT use context.title / context.error_message inside the
    # Jinja template via "context.xxx" — "context" is reserved in Frappe v15.
    # Instead set plain top-level variables directly on context so the template
    # can access them as {{ screen_title }}, {{ error_message }}, {{ screen_id }}

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
        context.screen_title = settings.display_name or "Signage Display"
        context.error_message = ""

    # top-level title for the <title> tag (Frappe reads this automatically)
    context.title = context.screen_title

    # ── Fetch signages for the initial server-rendered slideshow ──────────────
    # This is a simple fallback render — display.js re-fetches via the
    # screen-aware API (get_all_signages / get_signages_for_screen) on load
    # and rebuilds the slides, so this SSR pass mainly avoids a blank flash
    # before JS executes. Uses the same _format_signage logic as the API so
    # PDF pages and all fields are consistent.
    from signage_display.signage_display.doctype.signage.signage import (
        _SIGNAGE_FIELDS, _format_signage,
    )

    site_url = frappe.utils.get_url()
    rows = frappe.db.get_list(
        "Signage",
        filters={"published": 1},
        fields=_SIGNAGE_FIELDS,
    )
    context.signages = [_format_signage(r, site_url) for r in rows]

    context.signage_height = 80 // (settings.row_count or 1)
    return context
