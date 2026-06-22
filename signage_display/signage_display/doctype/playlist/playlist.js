frappe.listview_settings["Playlist"] = {
    add_fields: ["is_published"],
    get_indicator: function(doc) {
        return doc.is_published
            ? [__("Published"), "green", "is_published,=,1"]
            : [__("Draft"),     "grey",  "is_published,=,0"];
    },
};
