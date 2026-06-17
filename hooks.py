app_name = "signage_display"
app_title = "Signage Display"
app_publisher = "Highflyer Global Innovations"
app_description = "Display Signage Boards"
app_email = "hello@hfgi.co.uk"
app_license = "MIT"
app_version = "0.0.2"

# ─────────────────────────────────────────────────────────────────────────────
# Website routing
# /display          → www/display.html  (all screens, legacy URL)
# /display/<id>     → www/display.html  (screen-specific player)
# ─────────────────────────────────────────────────────────────────────────────
website_route_rules = [
    {"from_route": "/display/<path:screen_id>", "to_route": "display"},
]

# ─────────────────────────────────────────────────────────────────────────────
# Scheduled Tasks
# mark_screens_offline runs every minute.
# Screens with no heartbeat for >90 s are marked is_live = 0.
# ─────────────────────────────────────────────────────────────────────────────
scheduler_events = {
    "all": [
        "signage_display.signage_display.doctype.screen.screen.mark_screens_offline"
    ]
}
