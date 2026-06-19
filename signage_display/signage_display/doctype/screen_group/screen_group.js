frappe.listview_settings["Screen Group"] = {
    add_fields: ["screen_count", "default_schedule"],
    get_indicator: function(doc) {
        return doc.screen_count > 0
            ? [`${doc.screen_count} screens`, "blue", ""]
            : ["No screens", "grey", ""];
    },
};

frappe.ui.form.on("Screen Group", {
    refresh: function(frm) {
        if (!frm.is_new()) {
            frm.add_custom_button(__("View Screens"), function() {
                frappe.set_route("List", "Screen", { screen_group: frm.doc.name });
            });
        }
    },
});
