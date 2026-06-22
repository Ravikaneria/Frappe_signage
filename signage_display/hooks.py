app_name = "signage_display"
app_title = "Signage Display"
app_publisher = "H.P. Automation Pvt. Ltd."
app_description = "Digital Signage Display"
app_email = "ravi.kaneria@hpautomation.in"
app_license = "MIT"
app_version = "2.0.0"

website_route_rules = [
    {"from_route": "/display/<path:screen_id>", "to_route": "display"},
]

scheduler_events = {
    "all": [
        "signage_display.signage_display.doctype.screen.screen.mark_screens_offline"
    ]
}
