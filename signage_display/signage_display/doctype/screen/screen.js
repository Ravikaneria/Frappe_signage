// ── Screen List ───────────────────────────────────────────────────────────────
frappe.listview_settings["Screen"] = {
    add_fields: ["is_live", "last_seen", "screen_id", "display_url", "is_active"],

    get_indicator: function(doc) {
        if (!doc.is_active) return [__("Inactive"), "red",   "is_active,=,0"];
        if (doc.is_live)    return [__("Live"),     "green", "is_live,=,1"];
        return                     [__("Offline"),  "grey",  "is_live,=,0"];
    },

    onload: function(listview) {
        listview.page.add_action_item(__("Generate Screens"), function() {
            const d = new frappe.ui.Dialog({
                title: __("Generate Screens"),
                fields: [
                    {
                        fieldname: "count",
                        fieldtype: "Int",
                        label: __("Number of Screens"),
                        default: 5,
                        reqd: 1,
                        description: "Maximum 50"
                    },
                    {
                        fieldname: "default_playlist",
                        fieldtype: "Link",
                        label: __("Default Playlist (optional)"),
                        options: "Playlist",
                    },
                ],
                primary_action_label: __("Generate"),
                primary_action: function(vals) {
                    frappe.call({
                        method: "signage_display.signage_display.doctype.screen.screen.generate_screens",
                        args: { count: vals.count, default_playlist: vals.default_playlist || "" },
                        freeze: true, freeze_message: "Generating screens...",
                        callback: function(r) {
                            if (r.message) {
                                frappe.msgprint({
                                    title: "Done",
                                    indicator: "green",
                                    message: `Created ${r.message.created} screen(s).`
                                });
                                d.hide();
                                listview.refresh();
                            }
                        }
                    });
                }
            });
            d.show();
        });

        listview.page.add_action_item(__("Copy Selected URLs"), function() {
            const sel = listview.get_checked_items();
            if (!sel.length) {
                frappe.show_alert({ message: "Select at least one row.", indicator: "orange" });
                return;
            }
            navigator.clipboard.writeText(
                sel.map(d => `${d.screen_id} – ${d.screen_name}: ${d.display_url}`).join("\n")
            ).then(() => frappe.show_alert({ message: `Copied ${sel.length} URL(s)!`, indicator: "green" }));
        });
    },
};

// ── Screen Form ───────────────────────────────────────────────────────────────
frappe.ui.form.on("Screen", {

    refresh: function(frm) {
        // Live / Offline badge
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

        if (frm.doc.display_url) {
            frm.add_custom_button(__("Open Display"), function() {
                window.open(frm.doc.display_url, "_blank");
            }, __("Actions"));

            frm.add_custom_button(__("Copy URL"), function() {
                navigator.clipboard.writeText(frm.doc.display_url).then(() =>
                    frappe.show_alert({ message: "URL copied!", indicator: "green" })
                );
            }, __("Actions"));
        }
    },
});
