// Client Script — Signage Form
frappe.ui.form.on("Signage", {
    refresh: function(frm) {
        frm.trigger("content_type");
    },
    content_type: function(frm) {
        const t = frm.doc.content_type || "Image";
        frm.toggle_display("display_image",     t === "Image");
        frm.toggle_display("video_file",        t === "Video");
        frm.toggle_display("youtube_url",       t === "YouTube");
        frm.toggle_display("youtube_embed_url", t === "YouTube");
        frm.toggle_display("webpage_url",       t === "Webpage");
        frm.toggle_display("display_duration",  t !== "Video");
    },
    youtube_url: function(frm) {
        const url = frm.doc.youtube_url || "";
        if (!url) return;
        const m = url.match(
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/
        );
        if (m) {
            const id = m[1];
            const embed =
                `https://www.youtube.com/embed/${id}` +
                `?autoplay=1&mute=0&loop=1&playlist=${id}` +
                `&controls=0&modestbranding=1&rel=0&enablejsapi=1`;
            frm.set_value("youtube_embed_url", embed);
            frappe.show_alert({ message: `YouTube ID detected: ${id}`, indicator: "green" });
        } else {
            frappe.show_alert({ message: "Could not detect YouTube video ID — check the URL", indicator: "orange" });
        }
    },
    webpage_url: function(frm) {
        const url = frm.doc.webpage_url || "";
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) {
            frappe.show_alert({ message: "URL must start with http:// or https://", indicator: "orange" });
            return;
        }
        frappe.show_alert({
            message: "Note: the target site must allow embedding (no X-Frame-Options: DENY / SAMEORIGIN).",
            indicator: "blue",
        });
    },
    display_image: function(frm) {
        if (frm.doc.display_image) {
            frappe.show_alert({
                message: "Image will be auto-resized to max 1920x1080 on save",
                indicator: "blue",
            });
        }
    },
});
