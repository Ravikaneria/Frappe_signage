// ── Screen List View ─────────────────────────────────────────────────────────
frappe.listview_settings["Screen"] = {
    add_fields: ["is_live", "last_seen", "screen_name", "display_url", "is_active", "screen_group", "content_mode"],

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

        listview.page.add_action_item(__("Assign to Group"), function() {
            const selected = listview.get_checked_items();
            if (!selected.length) {
                frappe.show_alert({ message: "Select at least one screen first.", indicator: "orange" });
                return;
            }
            const d = new frappe.ui.Dialog({
                title: __("Assign Screens to Group"),
                fields: [
                    {
                        fieldname: "screen_group",
                        fieldtype: "Link",
                        options: "Screen Group",
                        label: __("Screen Group"),
                        reqd: 1,
                    },
                ],
                primary_action_label: __("Assign"),
                primary_action: function(values) {
                    frappe.call({
                        method: "signage_display.signage_display.doctype.screen.screen.bulk_assign_group",
                        args: {
                            screen_names: JSON.stringify(selected.map(s => s.name)),
                            screen_group: values.screen_group,
                        },
                        freeze: true,
                        callback: function(r) {
                            if (r.message) {
                                frappe.show_alert({
                                    message: `Assigned ${r.message.updated} screen(s) to ${values.screen_group}`,
                                    indicator: "green",
                                });
                                d.hide();
                                listview.refresh();
                            }
                        },
                    });
                },
            });
            d.show();
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

        frm.trigger("content_mode");
    },

    content_mode: function(frm) {
        const mode = frm.doc.content_mode || "Show All Published";
        frm.toggle_display("signages", mode === "Manual Signage List");
        frm.toggle_display("signage_schedule", mode === "Use Schedule");

        if (mode === "Use Schedule" && !frm.doc.signage_schedule && frm.doc.screen_group) {
            frm.set_df_property(
                "signage_schedule", "description",
                `No schedule set here — will inherit from group "${frm.doc.screen_group}".`
            );
        }
    },
});
