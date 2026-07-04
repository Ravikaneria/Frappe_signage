/**
 * display.js — Signage Display Player v2
 * Fixes:
 *  - PDF freeze: interval cleared on EVERY slide change, not just when PDF exits
 *  - PDF page indicator updates correctly during cycling
 */
"use strict";

const SD = window._sd || {};
const SCREEN_ID    = SD.screenId || "";
const GLOBAL_MS    = SD.globalDuration || 10000;
const POLL_MS      = 30_000;
const HEARTBEAT_MS = 30_000;

const API_CONTENT = "/api/method/signage_display.signage_display.doctype.screen.screen.get_content_for_screen";
const API_HB      = "/api/method/signage_display.signage_display.doctype.screen.screen.screen_heartbeat";

let swiper          = null;
let _lastJson       = null;
let _ytTimer        = null;
let _ytBarInterval  = null;
let _pdfTimer       = null;   // MUST be cleared on every slide change
let _clockTimer     = null;
let _wakeLock       = null;
let _userInteracted = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    console.log("[Signage v2] Screen:", SCREEN_ID || "(none)");
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
    try { _wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !_wakeLock) initWakeLock();
});
setInterval(() => { if (!_wakeLock) initWakeLock(); }, 60_000);

function startFakeActivitySignal() {
    setInterval(() => {
        window.scrollBy(0, 1); window.scrollBy(0, -1);
        document.dispatchEvent(new Event("touchstart"));
        document.dispatchEvent(new Event("touchend"));
    }, 4 * 60 * 1000);
}

// ── Audio Unmute ──────────────────────────────────────────────────────────────
function setupAudioUnmute() {
    ["click", "touchstart", "keydown", "pointerdown"].forEach(evt =>
        document.addEventListener(evt, handleUserInteraction, { passive: true })
    );
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
    document.querySelectorAll("iframe.sd-youtube").forEach(iframe => {
        try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
            iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [100] }), "*");
        } catch (_) {}
    });
    document.querySelectorAll("video.sd-video").forEach(v => {
        v.muted = false; v.play().catch(() => {});
    });
}

// ── Swiper ────────────────────────────────────────────────────────────────────
function initSwiper() {
    swiper = new Swiper(".sd-swiper", {
        speed: 1200,
        autoplay: { delay: GLOBAL_MS, disableOnInteraction: false },
        pagination: { el: ".swiper-pagination", clickable: true },
        loop: false,
        on: {
            slideChange: function() {
                // Update autoplay delay from current slide BEFORE advancing
                const slide = swiper.slides[swiper.activeIndex];
                if (slide) {
                    const ms = parseInt(slide.dataset.swiperAutoplay);
                    if (ms && ms > 0) swiper.params.autoplay.delay = ms;
                }
            }
        }
    });

    swiper.on("autoplayStop", () => {
        const slide = swiper.slides[swiper.activeIndex];
        if (!slide) return;
        const t = slide.dataset.contentType || "";
        // Only restart autoplay for types that use it
        // Video, YouTube, Webpage, URL Redirect and PDF manage their own timing
        if (!["Video", "YouTube", "Webpage", "URL Redirect", "PDF"].includes(t)) {
            swiper.autoplay.start();
        }
    });

    swiper.on("slideChangeTransitionEnd", handleActiveSlide);
}

// ── CRITICAL: Clear ALL timers on every slide change ─────────────────────────
// This is the root cause of the PDF freeze — if clearTimers() is not called
// before setting up the new slide, the old PDF interval keeps firing and
// advances slides at the wrong time or interferes with the new slide's timing.
function clearTimers() {
    if (_ytTimer)       { clearTimeout(_ytTimer);       _ytTimer = null; }
    if (_ytBarInterval) { clearInterval(_ytBarInterval); _ytBarInterval = null; }
    if (_pdfTimer)      { clearInterval(_pdfTimer);      _pdfTimer = null; }  // KEY FIX
    if (_clockTimer)    { clearInterval(_clockTimer);    _clockTimer = null; }
    // Reset all progress bars
    document.querySelectorAll(".sd-yt-progress-bar").forEach(b => {
        b.style.transition = "none";
        b.style.width = "0%";
    });
}

// ── Active Slide Handler ──────────────────────────────────────────────────────
function handleActiveSlide() {
    if (!swiper) return;

    // Always clear ALL timers first — prevents PDF interval carrying over
    clearTimers();

    // Pause all videos
    document.querySelectorAll("video.sd-video").forEach(v => {
        v.pause(); v.currentTime = 0; v.onended = null;
    });

    const slide = swiper.slides[swiper.activeIndex];
    if (!slide) return;
    const t = slide.dataset.contentType || "Image";

    // ── VIDEO ─────────────────────────────────────────────────────────────────
    if (t === "Video") {
        const video = slide.querySelector("video.sd-video");
        if (!video) return;
        swiper.autoplay.stop();
        video.muted = true;
        video.currentTime = 0;
        video.play().catch(() => setTimeout(() => video.play().catch(() => {}), 300));
        if (_userInteracted) video.muted = false;
        video.onended = () => { video.onended = null; goNext(); };
        // 3-hour safety timeout — won't fire for normal videos
        setTimeout(() => { if (video.onended) { video.onended = null; goNext(); } }, 3 * 60 * 60 * 1000);
    }

    // ── YOUTUBE / WEBPAGE / URL REDIRECT ─────────────────────────────────────
    else if (["YouTube", "Webpage", "URL Redirect"].includes(t)) {
        swiper.autoplay.stop();
        const durationMs = parseInt(slide.dataset.durationMs) || GLOBAL_MS;
        startProgressBar(slide, durationMs);
        _ytTimer = setTimeout(() => { clearTimers(); goNext(); }, durationMs);

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

        if (t === "Webpage" || t === "URL Redirect") {
            const iframe = slide.querySelector("iframe.sd-webpage");
            if (iframe) {
                const baseSrc = iframe.dataset.src || iframe.getAttribute("src").split("?_t=")[0];
                iframe.setAttribute("src", baseSrc + (baseSrc.includes("?") ? "&" : "?") + "_t=" + Date.now());
            }
        }
    }

    // ── PDF ───────────────────────────────────────────────────────────────────
    // The freeze was caused by _pdfTimer not being cleared when leaving a PDF
    // slide. Now clearTimers() above always clears it first.
    else if (t === "PDF") {
        const pages = Array.from(slide.querySelectorAll(".sd-pdf-page"));
        if (pages.length === 0) return;

        // Single page — use normal swiper autoplay, no interval needed
        if (pages.length === 1) {
            swiper.autoplay.start();
            return;
        }

        // Multiple pages — stop swiper autoplay, cycle pages manually
        swiper.autoplay.stop();
        const pageDurationMs = parseInt(slide.dataset.pageDurationMs) || 8000;
        const indicator = slide.querySelector(".sd-pdf-indicator");

        // Reset: show only first page
        pages.forEach((p, i) => p.classList.toggle("active", i === 0));
        if (indicator) indicator.textContent = `1 / ${pages.length}`;

        let currentPage = 0;

        _pdfTimer = setInterval(() => {
            pages[currentPage].classList.remove("active");
            currentPage++;

            if (currentPage >= pages.length) {
                // All pages shown — clear timer first, THEN advance
                clearInterval(_pdfTimer);
                _pdfTimer = null;
                // Use setTimeout(0) to let the interval fully exit before
                // calling goNext(), preventing any race with Swiper's state
                setTimeout(() => {
                    swiper.autoplay.start();  // restart autoplay first
                    goNext();                 // then advance
                }, 0);
                return;
            }

            // Show next page
            pages[currentPage].classList.add("active");
            if (indicator) indicator.textContent = `${currentPage + 1} / ${pages.length}`;

        }, pageDurationMs);
    }

    // ── CLOCK ─────────────────────────────────────────────────────────────────
    else if (t === "Clock") {
        const wrapper = slide.querySelector(".sd-clock-wrapper");
        if (!wrapper) return;
        const timeEl   = wrapper.querySelector(".sd-clock-time");
        const dateEl   = wrapper.querySelector(".sd-clock-date");
        const format   = wrapper.dataset.format || "24 Hour";
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
            if (showDate && dateEl) {
                dateEl.textContent = now.toLocaleDateString(undefined, {
                    weekday: "long", year: "numeric", month: "long", day: "numeric"
                });
            }
        }
        tick();
        _clockTimer = setInterval(tick, 1000);
    }
    // Image and Text Only use Swiper's normal autoplay — nothing special needed
}

function goNext() {
    if (!swiper) return;
    swiper.activeIndex >= swiper.slides.length - 1
        ? swiper.slideTo(0, 800) : swiper.slideNext(800);
    // Delay autoplay restart until after the 800ms slide transition completes
    // This prevents Swiper from ignoring the start() call during animation
    setTimeout(() => swiper.autoplay.start(), 900);
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
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
    const t          = item.content_type || "Image";
    const durationMs = (item.duration_sec || 0) * 1000 || GLOBAL_MS;
    let inner = "";

    if (t === "Image") {
        inner = item.media_image
            ? `<img src="${e(item.media_image)}" class="sd-img" alt="${e(item.content_name)}" />`
            : `<div class="sd-no-playlist" style="position:absolute;inset:0;">No image set.</div>`;

    } else if (t === "Video") {
        inner = `<video class="sd-video" src="${e(item.video_file)}" muted playsinline webkit-playsinline></video>`;

    } else if (t === "YouTube") {
        inner = `
            <iframe class="sd-youtube" src="${e(item.youtube_embed_url)}"
                allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0"></iframe>
            <div class="sd-yt-bar-wrapper">
                <div class="sd-yt-bar-track"><div class="sd-yt-progress-bar"></div></div>
                <span class="sd-yt-countdown">${fmt(Math.round(durationMs / 1000))}</span>
            </div>`;

    } else if (t === "Webpage" || t === "URL Redirect") {
        const src = t === "Webpage" ? item.webpage_url : item.redirect_url;
        inner = `
            <iframe class="sd-webpage" src="${e(src)}" data-src="${e(src)}"
                allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0" scrolling="no"></iframe>
            <div class="sd-yt-bar-wrapper">
                <div class="sd-yt-bar-track"><div class="sd-yt-progress-bar"></div></div>
                <span class="sd-yt-countdown">${fmt(Math.round(durationMs / 1000))}</span>
            </div>`;

    } else if (t === "PDF") {
        const pages = Array.isArray(item.pdf_pages) ? item.pdf_pages : [];
        const pageDurMs = (item.pdf_page_duration_sec || 8) * 1000;
        if (pages.length === 0) {
            inner = `<div class="sd-no-playlist" style="position:absolute;inset:0;">No PDF pages available.</div>`;
        } else {
            const imgs = pages.map((url, i) =>
                `<img src="${e(url)}" class="sd-pdf-page${i === 0 ? " active" : ""}" alt="Page ${i+1}" />`
            ).join("");
            inner = `
                <div class="sd-pdf-wrapper">${imgs}</div>
                ${pages.length > 1 ? `<div class="sd-pdf-indicator">1 / ${pages.length}</div>` : ""}`;
        }
        return `<div class="swiper-slide"
                    data-content-type="PDF"
                    data-swiper-autoplay="${durationMs}"
                    data-duration-ms="${durationMs}"
                    data-page-duration-ms="${pageDurMs}">
                    <div class="card sd-card">${inner}</div>
                </div>`;

    } else if (t === "Clock") {
        const showDate = item.clock_show_date ? 1 : 0;
        const tz = item.clock_timezone_label
            ? `<div class="sd-clock-tz">${e(item.clock_timezone_label)}</div>` : "";
        inner = `
            <div class="sd-clock-wrapper"
                data-format="${e(item.clock_format || "24 Hour")}"
                data-show-date="${showDate}">
                ${item.content_name ? `<div class="sd-clock-label">${e(item.content_name)}</div>` : ""}
                <div class="sd-clock-time">--:--</div>
                <div class="sd-clock-date"></div>
                ${tz}
            </div>`;

    } else {
        inner = `<div class="sd-no-playlist" style="position:absolute;inset:0;">Unknown: ${e(t)}</div>`;
    }

    const ytAttr = ["YouTube", "Webpage", "URL Redirect"].includes(t)
        ? `data-duration-ms="${durationMs}"` : "";

    return `<div class="swiper-slide"
                data-content-type="${e(t)}"
                data-swiper-autoplay="${durationMs}"
                data-duration-ms="${durationMs}"
                ${ytAttr}>
                <div class="card sd-card">${inner}</div>
            </div>`;
}

function buildNoPlaylistSlide() {
    return `<div class="swiper-slide" data-content-type="Image">
                <div class="sd-no-playlist">Please check playlist configuration.</div>
            </div>`;
}

// ── API ───────────────────────────────────────────────────────────────────────
async function fetchContent() {
    if (!SCREEN_ID) return null;
    try {
        const res = await fetch(
            `${API_CONTENT}?screen_id=${encodeURIComponent(SCREEN_ID)}`,
            { headers: { Accept: "application/json" } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.message || null;
    } catch { return null; }
}

async function sendHeartbeat() {
    if (!SCREEN_ID) return;
    try {
        await fetch(`${API_HB}?screen_id=${encodeURIComponent(SCREEN_ID)}`,
            { headers: { Accept: "application/json" } });
    } catch {}
}

// ── Refresh ───────────────────────────────────────────────────────────────────
async function refreshContent() {
    const response = await fetchContent();
    if (!response) return;

    // Include current minute in cache key so schedule slot changes
    // (new time window becoming active) always trigger a content refresh
    const now = new Date();
    const minuteKey = `${now.getHours()}:${now.getMinutes()}`;
    const json = JSON.stringify(response) + minuteKey;
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
    const firstSlide = swiper.slides[0];
    if (firstSlide) {
        const ms = parseInt(firstSlide.dataset.swiperAutoplay);
        if (ms && ms > 0) swiper.params.autoplay.delay = ms;
    }
    swiper.slideTo(Math.min(prev, swiper.slides.length - 1), 0);
    swiper.autoplay.start();
    handleActiveSlide();
}

function startPolling()   { refreshContent(); setInterval(refreshContent, POLL_MS); }
function startHeartbeat() { sendHeartbeat();  setInterval(sendHeartbeat, HEARTBEAT_MS); }

function e(str) {
    if (!str) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
