frappe.ui.form.on("Signage Schedule", {
    refresh: function(frm) {
        if (!frm.is_new()) {
            frm.add_custom_button(__("Preview: What's Active Now"), function() {
                frappe.call({
                    method: "signage_display.signage_display.doctype.signage_schedule.signage_schedule.preview_active_rule",
                    args: { schedule_name: frm.doc.name },
                    callback: function(r) {
                        if (r.message && r.message.rule_name) {
                            const items = (r.message.signages || [])
                                .map(s => `• ${s}`)
                                .join("<br>");
                            frappe.msgprint({
                                title: __("Currently Active"),
                                indicator: "green",
                                message: `<b>Rule:</b> ${r.message.rule_name}<br><br><b>Signages:</b><br>${items || "(none assigned)"}`,
                            });
                        } else {
                            frappe.msgprint({
                                title: __("No Active Rule"),
                                indicator: "orange",
                                message: "No rule matches the current time. " +
                                    (frm.doc.fallback_show_all_published
                                        ? "Fallback is ON — all published signages will show."
                                        : "Fallback is OFF — screen will show nothing."),
                            });
                        }
                    },
                });
            });
        }
    },
});

frappe.listview_settings["Signage Schedule"] = {
    add_fields: ["is_active"],
    get_indicator: function(doc) {
        return doc.is_active
            ? [__("Active"), "green", "is_active,=,1"]
            : [__("Inactive"), "grey", "is_active,=,0"];
    },
};
