/**
 * display.js — Signage Display Player v2
 *
 * Content types: Image · Video · YouTube · Webpage · URL Redirect · PDF · Clock
 * Scheduling: server-side (get_content_for_screen returns active playlist items)
 * Wake lock: attempted via Web API; native wake lock handled by Android TV app
 */
"use strict";

const SD = window._sd || {};
const SCREEN_ID    = SD.screenId || "";
const GLOBAL_MS    = SD.globalDuration || 10000;
const POLL_MS      = 30_000;
const HEARTBEAT_MS = 30_000;

const API_CONTENT  = "/api/method/signage_display.signage_display.doctype.screen.screen.get_content_for_screen";
const API_HB       = "/api/method/signage_display.signage_display.doctype.screen.screen.screen_heartbeat";

let swiper         = null;
let _lastJson      = null;
let _ytTimer       = null;
let _ytBarInterval = null;
let _pdfTimer      = null;
let _clockTimer    = null;
let _wakeLock      = null;
let _userInteracted = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    console.log("[Signage v2] Screen ID:", SCREEN_ID || "(none)");
    console.log("[Signage v2] Viewport:", window.innerWidth + "×" + window.innerHeight);

    initSwiper();
    startPolling();
    if (SCREEN_ID) startHeartbeat();
    initWakeLock();
    startFakeActivitySignal();
    setupAudioUnmute();
});

// ── Wake Lock ─────────────────────────────────────────────────────────────────
async function initWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
        _wakeLock = await navigator.wakeLock.request("screen");
    } catch (_) {}
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !_wakeLock) initWakeLock();
});
setInterval(() => { if (!_wakeLock) initWakeLock(); }, 60_000);

function startFakeActivitySignal() {
    setInterval(() => {
        window.scrollBy(0, 1);
        window.scrollBy(0, -1);
        document.dispatchEvent(new Event("touchstart"));
        document.dispatchEvent(new Event("touchend"));
    }, 4 * 60 * 1000);
}

// ── Audio Unmute (muted → unmuted on first user interaction) ──────────────────
function setupAudioUnmute() {
    ["click", "touchstart", "keydown", "pointerdown"].forEach(evt =>
        document.addEventListener(evt, handleUserInteraction, { passive: true })
    );
    // Fallback auto-unmute after 5s (works on some Android TV WebViews)
    setTimeout(() => {
        document.querySelectorAll("video.sd-video").forEach(v => {
            v.muted = false;
            v.play().catch(() => { v.muted = true; });
        });
    }, 5000);
}

function handleUserInteraction() {
    if (_userInteracted) return;
    _userInteracted = true;
    const hint = document.getElementById("sd-audio-hint");
    if (hint) { hint.classList.add("hide"); setTimeout(() => hint.remove(), 700); }
    // Unmute YouTube iframes
    document.querySelectorAll("iframe.sd-youtube").forEach(iframe => {
        try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
            iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [100] }), "*");
        } catch (_) {}
    });
    // Unmute videos
    document.querySelectorAll("video.sd-video").forEach(v => {
        v.muted = false;
        v.play().catch(() => {});
    });
}

// ── Swiper ────────────────────────────────────────────────────────────────────
function initSwiper() {
    swiper = new Swiper(".sd-swiper", {
        speed: 1200,
        autoplay: {
            delay: GLOBAL_MS,
            disableOnInteraction: false,
        },
        pagination: { el: ".swiper-pagination", clickable: true },
        loop: false,
        on: {
            // Before each slide transition, update the autoplay delay
            // to match the current slide's data-swiper-autoplay value.
            // This is how Swiper v11 reads per-slide duration.
            autoplayTimeLeft(s, time, progress) {},
            slideChange: function() {
                const slide = swiper.slides[swiper.activeIndex];
                if (slide) {
                    const ms = parseInt(slide.dataset.swiperAutoplay);
                    if (ms && ms > 0) {
                        swiper.params.autoplay.delay = ms;
                    }
                }
            }
        }
    });
    swiper.on("autoplayStop", () => {
        const slide = swiper.slides[swiper.activeIndex];
        if (!slide) return;
        const t = slide.dataset.contentType || "";
        if (!["Video", "YouTube", "Webpage", "URL Redirect"].includes(t))
            swiper.autoplay.start();
    });
    swiper.on("slideChangeTransitionEnd", handleActiveSlide);
}

// ── Active Slide Handler ──────────────────────────────────────────────────────
function handleActiveSlide() {
    if (!swiper) return;
    clearTimers();

    document.querySelectorAll("video.sd-video").forEach(v => {
        v.pause(); v.currentTime = 0; v.onended = null;
    });

    const slide = swiper.slides[swiper.activeIndex];
    if (!slide) return;
    const t = slide.dataset.contentType || "Image";

    if (t === "Video") {
        const video = slide.querySelector("video.sd-video");
        if (!video) return;
        swiper.autoplay.stop();
        video.muted = true;
        video.currentTime = 0;
        video.play().catch(() => setTimeout(() => video.play().catch(() => {}), 300));
        if (_userInteracted) { video.muted = false; }
        video.onended = () => { video.onended = null; goNext(); };
        setTimeout(() => { if (video.onended) { video.onended = null; goNext(); } }, 3 * 60 * 60 * 1000);
    }

    else if (t === "YouTube" || t === "Webpage" || t === "URL Redirect") {
        swiper.autoplay.stop();
        const durationMs = parseInt(slide.dataset.durationMs) || GLOBAL_MS;
        startProgressBar(slide, durationMs);
        _ytTimer = setTimeout(() => { clearTimers(); goNext(); }, durationMs);

        // Reload Webpage/URL iframes every time they become active.
        // This ensures date-sensitive pages like Teamup always show today.
        if (t === "Webpage" || t === "URL Redirect") {
            const iframe = slide.querySelector("iframe.sd-webpage");
            if (iframe) {
                const baseSrc = iframe.dataset.src || iframe.getAttribute("src").split("?_t=")[0];
                iframe.setAttribute("src", baseSrc + (baseSrc.includes("?") ? "&" : "?") + "_t=" + Date.now());
            }
        }

        // Try unmuting YouTube after load
        if (t === "YouTube") {
            const iframe = slide.querySelector("iframe.sd-youtube");
            if (iframe) {
                setTimeout(() => {
                    try {
                        iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
                        iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [100] }), "*");
                    } catch (_) {}
                }, 1500);
            }
        }
    }

    else if (t === "PDF") {
        const pages = slide.querySelectorAll(".sd-pdf-page");
        if (pages.length <= 1) return;
        swiper.autoplay.stop();
        const pageDurationMs = parseInt(slide.dataset.pageDurationMs) || 8000;
        let idx = 0;
        const indicator = slide.querySelector(".sd-pdf-indicator");
        _pdfTimer = setInterval(() => {
            pages[idx].classList.remove("active");
            idx++;
            if (idx >= pages.length) { clearTimers(); goNext(); return; }
            pages[idx].classList.add("active");
            if (indicator) indicator.textContent = `${idx + 1} / ${pages.length}`;
        }, pageDurationMs);
    }

    else if (t === "Clock") {
        const wrapper = slide.querySelector(".sd-clock-wrapper");
        if (!wrapper) return;
        const timeEl  = wrapper.querySelector(".sd-clock-time");
        const dateEl  = wrapper.querySelector(".sd-clock-date");
        const format  = wrapper.dataset.format || "24 Hour";
        const showDate = wrapper.dataset.showDate === "1";
        function tick() {
            const now = new Date();
            let h = now.getHours(), suffix = "";
            const m = String(now.getMinutes()).padStart(2, "0");
            const s = String(now.getSeconds()).padStart(2, "0");
            if (format === "12 Hour (AM/PM)") {
                suffix = h >= 12 ? " PM" : " AM";
                h = h % 12 || 12;
            }
            if (timeEl) timeEl.textContent = `${String(h).padStart(2, "0")}:${m}:${s}${suffix}`;
            if (showDate && dateEl) dateEl.textContent = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        }
        tick();
        _clockTimer = setInterval(tick, 1000);
    }
}

function clearTimers() {
    if (_ytTimer)       { clearTimeout(_ytTimer);       _ytTimer = null; }
    if (_ytBarInterval) { clearInterval(_ytBarInterval); _ytBarInterval = null; }
    if (_pdfTimer)      { clearInterval(_pdfTimer);     _pdfTimer = null; }
    if (_clockTimer)    { clearInterval(_clockTimer);   _clockTimer = null; }
    document.querySelectorAll(".sd-yt-progress-bar").forEach(b => {
        b.style.transition = "none"; b.style.width = "0%";
    });
}

function goNext() {
    if (!swiper) return;
    swiper.activeIndex >= swiper.slides.length - 1
        ? swiper.slideTo(0, 800) : swiper.slideNext(800);
    swiper.autoplay.start();
}

// ── Progress Bar (YouTube/Webpage) ────────────────────────────────────────────
function startProgressBar(slide, durationMs) {
    const bar   = slide.querySelector(".sd-yt-progress-bar");
    const label = slide.querySelector(".sd-yt-countdown");
    if (!bar) return;
    bar.style.transition = "none"; bar.style.width = "0%";
    void bar.offsetWidth;
    bar.style.transition = `width ${durationMs}ms linear`; bar.style.width = "100%";
    if (!label) return;
    let remaining = Math.round(durationMs / 1000);
    label.textContent = fmt(remaining);
    _ytBarInterval = setInterval(() => {
        remaining--;
        label.textContent = remaining > 0 ? fmt(remaining) : "0:00";
        if (remaining <= 0) { clearInterval(_ytBarInterval); _ytBarInterval = null; }
    }, 1000);
}

function fmt(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

// ── Slide Builder ─────────────────────────────────────────────────────────────
function buildSlide(item) {
    const t         = item.content_type || "Image";
    const durationMs = (item.duration_sec || 0) * 1000 || GLOBAL_MS;

    let inner = "";

    if (t === "Image") {
        inner = item.media_image
            ? `<img src="${e(item.media_image)}" class="sd-img" alt="${e(item.content_name)}" />`
            : `<div class="sd-no-playlist" style="position:absolute;inset:0;">No image set.</div>`;
    }
    else if (t === "Video") {
        inner = `<video class="sd-video" src="${e(item.video_file)}" muted playsinline webkit-playsinline></video>`;
    }
    else if (t === "YouTube") {
        inner = `
            <iframe class="sd-youtube" src="${e(item.youtube_embed_url)}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0"></iframe>
            <div class="sd-yt-bar-wrapper"><div class="sd-yt-bar-track"><div class="sd-yt-progress-bar"></div></div><span class="sd-yt-countdown">${fmt(Math.round(durationMs / 1000))}</span></div>`;
    }
    else if (t === "Webpage" || t === "URL Redirect") {
        const src = t === "Webpage" ? item.webpage_url : item.redirect_url;
        inner = `
            <iframe class="sd-webpage" src="${e(src)}" data-src="${e(src)}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0" scrolling="no"></iframe>
            <div class="sd-yt-bar-wrapper"><div class="sd-yt-bar-track"><div class="sd-yt-progress-bar"></div></div><span class="sd-yt-countdown">${fmt(Math.round(durationMs / 1000))}</span></div>`;
    }
    else if (t === "PDF") {
        const pages = Array.isArray(item.pdf_pages) ? item.pdf_pages : [];
        const pageDurMs = (item.pdf_page_duration_sec || 8) * 1000;
        const imgs = pages.map((url, i) =>
            `<img src="${e(url)}" class="sd-pdf-page${i === 0 ? " active" : ""}" alt="Page ${i+1}" />`
        ).join("");
        inner = `<div class="sd-pdf-wrapper">${imgs}${pages.length > 1 ? `<div class="sd-pdf-indicator">1 / ${pages.length}</div>` : ""}</div>`;
        return `<div class="swiper-slide" data-content-type="PDF" data-duration-ms="${durationMs}" data-swiper-autoplay="${durationMs}" data-page-duration-ms="${pageDurMs}"><div class="card sd-card">${inner}</div></div>`;
    }
    else if (t === "Clock") {
        const showDate = item.clock_show_date ? 1 : 0;
        const tz = item.clock_timezone_label ? `<div class="sd-clock-tz">${e(item.clock_timezone_label)}</div>` : "";
        inner = `<div class="sd-clock-wrapper" data-format="${e(item.clock_format || '24 Hour')}" data-show-date="${showDate}">
                    ${item.content_name ? `<div class="sd-clock-label">${e(item.content_name)}</div>` : ""}
                    <div class="sd-clock-time">--:--</div>
                    <div class="sd-clock-date"></div>
                    ${tz}</div>`;
    }
    else {
        inner = `<div class="sd-no-playlist" style="position:absolute;inset:0;">Unknown content type: ${e(t)}</div>`;
    }

    const ytAttr = ["YouTube", "Webpage", "URL Redirect"].includes(t)
        ? `data-duration-ms="${durationMs}"` : "";

    return `<div class="swiper-slide" data-content-type="${e(t)}" data-duration-ms="${durationMs}" data-swiper-autoplay="${durationMs}" ${ytAttr}>
              <div class="card sd-card">${inner}</div>
            </div>`;
}

function buildNoPlaylistSlide() {
    return `<div class="swiper-slide"><div class="sd-no-playlist">Please check playlist configuration.</div></div>`;
}

// ── API ───────────────────────────────────────────────────────────────────────
async function fetchContent() {
    if (!SCREEN_ID) return null;
    try {
        const res = await fetch(`${API_CONTENT}?screen_id=${encodeURIComponent(SCREEN_ID)}`, {
            headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.message || null;
    } catch { return null; }
}

async function sendHeartbeat() {
    if (!SCREEN_ID) return;
    try {
        await fetch(`${API_HB}?screen_id=${encodeURIComponent(SCREEN_ID)}`, {
            headers: { Accept: "application/json" },
        });
    } catch {}
}

// ── Refresh Cycle ─────────────────────────────────────────────────────────────
async function refreshContent() {
    const response = await fetchContent();
    if (!response) return;

    const json = JSON.stringify(response);
    if (json === _lastJson) return;
    _lastJson = json;

    const prev = swiper ? swiper.activeIndex : 0;
    clearTimers();
    swiper.autoplay.stop();
    swiper.removeAllSlides();

    const items = response.items || [];
    if (items.length === 0 || response.error === "no_playlist") {
        swiper.appendSlide(buildNoPlaylistSlide());
    } else {
        items.forEach(item => swiper.appendSlide(buildSlide(item)));
    }

    swiper.update();
    swiper.slideTo(Math.min(prev, swiper.slides.length - 1), 0);

    // Set autoplay delay from the first slide before starting
    const firstSlide = swiper.slides[swiper.activeIndex];
    if (firstSlide) {
        const ms = parseInt(firstSlide.dataset.swiperAutoplay);
        if (ms && ms > 0) swiper.params.autoplay.delay = ms;
    }

    swiper.autoplay.start();
    handleActiveSlide();
}

function startPolling()   { refreshContent(); setInterval(refreshContent, POLL_MS); }
function startHeartbeat() { sendHeartbeat();  setInterval(sendHeartbeat,  HEARTBEAT_MS); }

function e(str) {
    if (!str) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
