// ── Screen List View ─────────────────────────────────────────────────────────
frappe.listview_settings["Screen"] = {
    add_fields: ["is_live", "last_seen", "screen_name", "display_url", "is_active"],

    get_indicator: function(doc) {
        if (!doc.is_active) return [__("Inactive"), "red",   "is_active,=,0"];
        if (doc.is_live)    return [__("Live"),     "green", "is_live,=,1"];
        return                     [__("Offline"),  "grey",  "is_live,=,0"];
    },

    onload: function(listview) {
        listview.page.add_action_item(__("Generate 50 Screens"), function() {
            frappe.confirm(
                "This will create Screen-01 to Screen-50. Existing screens are skipped. Proceed?",
                function() {
                    frappe.call({
                        method: "signage_display.signage_display.doctype.screen.screen.generate_screens",
                        args: { count: 50, prefix: "Screen" },
                        freeze: true,
                        freeze_message: "Generating screens...",
                        callback: function(r) {
                            if (r.message) {
                                frappe.msgprint({
                                    title: "Done",
                                    indicator: "green",
                                    message: `Created ${r.message.created} new screen(s).`
                                });
                                listview.refresh();
                            }
                        }
                    });
                }
            );
        });

        listview.page.add_action_item(__("Copy Selected URLs"), function() {
            const selected = listview.get_checked_items();
            if (!selected.length) {
                frappe.show_alert({ message: "Select at least one row first.", indicator: "orange" });
                return;
            }
            const text = selected.map(d => `${d.screen_name}: ${d.display_url}`).join("\n");
            navigator.clipboard.writeText(text).then(() => {
                frappe.show_alert({ message: `Copied ${selected.length} URL(s)!`, indicator: "green" });
            });
        });
    },
};

// ── Screen Form ───────────────────────────────────────────────────────────────
frappe.ui.form.on("Screen", {

    refresh: function(frm) {
        // Live / Offline status banner
        if (frm.doc.is_live) {
            const since = frm.doc.last_seen
                ? " · Last seen: " + frappe.datetime.prettyDate(frm.doc.last_seen) : "";
            frm.dashboard.set_headline_alert(
                `<span style="color:green;font-weight:bold;">🟢 Live Now${since}</span>`
            );
        } else if (frm.doc.last_seen) {
            frm.dashboard.set_headline_alert(
                `<span style="color:#888;">⚫ Offline · Last seen: ${frappe.datetime.prettyDate(frm.doc.last_seen)}</span>`
            );
        }

        // Action buttons
        if (frm.doc.display_url) {
            frm.add_custom_button(__("Open Display"), function() {
                window.open(frm.doc.display_url, "_blank");
            }, __("Actions"));

            frm.add_custom_button(__("Copy URL"), function() {
                navigator.clipboard.writeText(frm.doc.display_url).then(() => {
                    frappe.show_alert({ message: "URL copied!", indicator: "green" });
                });
            }, __("Actions"));
        }

        // Show/hide signage table based on toggle
        frm.trigger("show_all_signages");
    },

    show_all_signages: function(frm) {
        const showAll = frm.doc.show_all_signages;
        frm.toggle_display("signages", !showAll);

        if (showAll) {
            frm.set_df_property("signages", "reqd", 0);
            frm.dashboard.set_headline_alert(
                frm.doc.is_live
                    ? `<span style="color:green;font-weight:bold;">🟢 Live — showing ALL published signages</span>`
                    : `<span style="color:#888;">Showing ALL published signages when live</span>`,
                "blue"
            );
        } else {
            frm.dashboard.clear_headline();
            if (frm.doc.is_live) {
                frm.dashboard.set_headline_alert(
                    `<span style="color:green;font-weight:bold;">🟢 Live — showing assigned signages only</span>`
                );
            }
        }
    },
});
