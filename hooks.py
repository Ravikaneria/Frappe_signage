app_name = "signage_display"
app_title = "Signage Display"
app_publisher = "H.P. Automation Pvt. Ltd."
app_description = "Digital Signage Display"
app_email = "ravi.kaneria@hpautomation.in"
app_license = "MIT"
app_version = "2.0.0"

website_route_rules = [
    {"from_route": "/display/<path:screen_id>", "to_route": "display"},
    {"from_route": "/content-manager", "to_route": "content-manager/index"},
]

# Reduced from "all" (runs every ~4 min) to explicit cron every 5 minutes.
# This is a lighter, predictable schedule that reduces background compute
# while still catching offline screens promptly.
scheduler_events = {
    "cron": {
        "*/5 * * * *": [
            "signage_display.signage_display.doctype.screen.screen.mark_screens_offline"
        ]
    }
}

after_install = "signage_display.install.install.after_install"
after_migrate = "signage_display.install.install.after_install"
