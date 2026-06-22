app_name = "signage_display"
app_title = "Signage Display"
app_publisher = "Highflyer Global Innovations"
app_description = "Display Signage Boards"
app_email = "hello@hfgi.co.uk"
app_license = "MIT"
app_version = "0.0.2"

website_route_rules = [
    {"from_route": "/display/<path:screen_id>", "to_route": "display"},
]

scheduler_events = {
    "all": [
        "signage_display.signage_display.doctype.screen.screen.mark_screens_offline"
    ]
}
