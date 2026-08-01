// Client Script — Content Form (simplified UX)
// Image/Video/PDF attach fields are always visible — just click and upload.
// Content Type auto-detects and locks once you attach something.

frappe.ui.form.on("Content", {
    onload: function(frm) {
        if (frm.is_new() && !frm.doc.content_type) {
            frm.set_value("content_type", "Image");
        }
    },

    refresh: function(frm) {
        frm.trigger("content_type");

        frm.add_custom_button(__("🎬 Use YouTube instead"), () => {
            frm.set_value("content_type", "YouTube");
            frappe.show_alert({ message: "Scroll down to paste the YouTube link", indicator: "blue" });
        });
        frm.add_custom_button(__("🌐 Use Webpage instead"), () => {
            frm.set_value("content_type", "Webpage");
        });
        frm.add_custom_button(__("🕐 Use Clock instead"), () => {
            frm.set_value("content_type", "Clock");
        });
        frm.add_custom_button(__("🔗 Use URL Redirect instead"), () => {
            frm.set_value("content_type", "URL Redirect");
        });
    },

    content_type: function(frm) {
        // Only the "other" section fields toggle — upload fields always visible
        const t = frm.doc.content_type || "Image";
        frm.toggle_display("youtube_url",          t === "YouTube");
        frm.toggle_display("youtube_embed_url",    t === "YouTube");
        frm.toggle_display("webpage_url",          t === "Webpage");
        frm.toggle_display("redirect_url",         t === "URL Redirect");
        frm.toggle_display("clock_format",         t === "Clock");
        frm.toggle_display("clock_show_date",      t === "Clock");
        frm.toggle_display("clock_timezone_label", t === "Clock");
    },

    // ── Auto-detect + auto-name on attach ─────────────────────────────────────
    media_image: function(frm) {
        if (frm.doc.media_image) {
            frm.set_value("content_type", "Image");
            autoName(frm, frm.doc.media_image);
        }
    },
    video_file: function(frm) {
        if (frm.doc.video_file) {
            frm.set_value("content_type", "Video");
            autoName(frm, frm.doc.video_file);
        }
    },
    pdf_file: function(frm) {
        if (frm.doc.pdf_file) {
            frm.set_value("content_type", "PDF");
            autoName(frm, frm.doc.pdf_file);
            frappe.show_alert({ message: "PDF pages will be generated on save.", indicator: "blue" });
        }
    },

    youtube_url: function(frm) {
        const url = frm.doc.youtube_url || "";
        if (!url) return;
        const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
        if (m) {
            const id = m[1];
            frm.set_value("youtube_embed_url",
                `https://www.youtube.com/embed/${id}?autoplay=1&mute=0&loop=1&playlist=${id}&controls=0&modestbranding=1&rel=0&enablejsapi=1`
            );
            frappe.show_alert({ message: `YouTube ID: ${id}`, indicator: "green" });
        } else {
            frappe.show_alert({ message: "Could not detect YouTube video ID", indicator: "orange" });
        }
    },
});

function autoName(frm, fileUrl) {
    if (!frm.doc.content_name) {
        const guess = fileUrl.split("/").pop().replace(/\.[^.]+$/, "");
        frm.set_value("content_name", guess);
    }
}
