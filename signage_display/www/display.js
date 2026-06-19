/**
 * display.js — Signage Display Player
 *
 * YouTube fixes:
 *  - Swiper autoplay stopped for YouTube slides (same as video)
 *  - YouTube advances after its display_duration (not global 20s)
 *  - Countdown progress bar shown for YouTube slides
 *
 * Video fixes (kept from before):
 *  - Audio plays, advances on 'ended' event
 *  - Safety timeout = 3 hours
 */
"use strict";

const SD = window._sd || {};
const SCREEN_ID        = SD.screenId || "";
const POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_MS     = 30_000;

const API_ALL    = "/api/method/signage_display.signage_display.doctype.signage.signage.get_all_signages";
const API_SCREEN = "/api/method/signage_display.signage_display.doctype.signage.signage.get_signages_for_screen";
const API_HB     = "/api/method/signage_display.signage_display.doctype.signage.signage.screen_heartbeat";

let swiper          = null;
let _lastJson       = null;
let _ytTimer        = null;   // setTimeout handle for YouTube advancement
let _ytBarInterval  = null;   // setInterval handle for progress bar animation

document.addEventListener("DOMContentLoaded", () => {
    initSwiper();
    startPolling();
    if (SCREEN_ID) startHeartbeat();
});

// ── Swiper init ───────────────────────────────────────────────────────────────
function initSwiper() {
    swiper = new Swiper(".sd-swiper", {
        speed: 1200,
        direction: "horizontal",
        autoplay: {
            delay: SD.displayDuration || 20000,
            disableOnInteraction: false,
        },
        slidesPerView: SD.columnCount || 1,
        grid: { rows: SD.rowCount || 1, fill: "row" },
        spaceBetween: 0,
        pagination: { el: ".swiper-pagination", clickable: true },
        loop: false,
    });

    // When autoplay fires, check — if current slide is video, YouTube, or Webpage, suppress it
    swiper.on("autoplayStop", () => {
        const slide = swiper.slides[swiper.activeIndex];
        if (!slide) return;
        const isVideo = !!slide.querySelector("video.sd-video");
        const isTimedIframe = ["YouTube", "Webpage"].includes(slide.dataset.contentType);
        if (!isVideo && !isTimedIframe) {
            swiper.autoplay.start();
        }
    });

    swiper.on("slideChangeTransitionEnd", handleActiveSlide);
}

// ── Active slide handler ──────────────────────────────────────────────────────
function handleActiveSlide() {
    if (!swiper) return;

    // Clear any running YouTube timer + progress bar
    clearYouTubeTimer();

    // Pause all videos
    document.querySelectorAll(".sd-video").forEach(v => {
        v.pause();
        v.currentTime = 0;
        v.onended = null;
    });

    const slide = swiper.slides[swiper.activeIndex];
    if (!slide) return;

    const contentType = slide.dataset.contentType || "Image";

    // ── VIDEO ─────────────────────────────────────────────────────────────────
    if (contentType === "Video") {
        const video = slide.querySelector("video.sd-video");
        if (!video) return;

        swiper.autoplay.stop();
        video.currentTime = 0;

        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                video.muted = true;
                video.play().catch(() => {});
            });
        }

        video.onended = () => { video.onended = null; goNext(); };

        // Safety — 3 hours, won't fire for normal videos
        setTimeout(() => {
            if (video.onended) { video.onended = null; goNext(); }
        }, 3 * 60 * 60 * 1000);
    }

    // ── YOUTUBE ───────────────────────────────────────────────────────────────
    else if (contentType === "YouTube") {
        swiper.autoplay.stop();

        // Read duration from the slide's data attribute (set during buildSlide)
        const durationMs = parseInt(slide.dataset.ytDuration) || (SD.displayDuration || 60000);

        // Show and animate the progress bar
        startProgressBar(slide, durationMs);

        // Try to unmute immediately (works if user has already interacted)
        const ytIframe = slide.querySelector("iframe.sd-youtube");
        if (ytIframe) {
            setTimeout(() => {
                try {
                    ytIframe.contentWindow.postMessage(
                        JSON.stringify({ event: "command", func: "unMute", args: [] }),
                        "*"
                    );
                    ytIframe.contentWindow.postMessage(
                        JSON.stringify({ event: "command", func: "setVolume", args: [100] }),
                        "*"
                    );
                } catch(e) {}
            }, 1500); // wait 1.5s for iframe to fully load
        }

        // Advance after the duration
        _ytTimer = setTimeout(() => {
            clearYouTubeTimer();
            goNext();
        }, durationMs);
    }

    // ── WEBPAGE ───────────────────────────────────────────────────────────────
    // Same timer + progress bar as YouTube — we can't detect "end" of an
    // arbitrary external webpage, so it advances after its set duration.
    else if (contentType === "Webpage") {
        swiper.autoplay.stop();

        const durationMs = parseInt(slide.dataset.ytDuration) || (SD.displayDuration || 60000);

        startProgressBar(slide, durationMs);

        _ytTimer = setTimeout(() => {
            clearYouTubeTimer();
            goNext();
        }, durationMs);
    }
}

function clearYouTubeTimer() {
    if (_ytTimer)       { clearTimeout(_ytTimer);   _ytTimer = null; }
    if (_ytBarInterval) { clearInterval(_ytBarInterval); _ytBarInterval = null; }
    // Reset all progress bars
    document.querySelectorAll(".sd-yt-progress-bar").forEach(bar => {
        bar.style.transition = "none";
        bar.style.width = "0%";
    });
}

// ── YouTube progress bar ──────────────────────────────────────────────────────
function startProgressBar(slide, durationMs) {
    const bar = slide.querySelector(".sd-yt-progress-bar");
    if (!bar) return;

    bar.style.transition = "none";
    bar.style.width = "0%";

    // Force reflow so transition starts from 0
    void bar.offsetWidth;

    bar.style.transition = `width ${durationMs}ms linear`;
    bar.style.width = "100%";

    // Update the countdown label every second
    const label = slide.querySelector(".sd-yt-countdown");
    if (!label) return;

    let remaining = Math.round(durationMs / 1000);
    label.textContent = formatTime(remaining);

    _ytBarInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            label.textContent = "0:00";
            clearInterval(_ytBarInterval);
            _ytBarInterval = null;
        } else {
            label.textContent = formatTime(remaining);
        }
    }, 1000);
}

function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── YouTube audio: unmute all iframes via postMessage ────────────────────────
// Browsers block autoplay-with-audio until first user gesture.
// We send unMute + playVideo commands to every YouTube iframe on first click.
let _userInteracted = false;

function unmuteAllYouTubeIframes() {
    if (_userInteracted) return;
    _userInteracted = true;

    // Hide the "tap for audio" hint
    const hint = document.getElementById("sd-audio-hint");
    if (hint) { hint.classList.add("hide"); setTimeout(() => hint.remove(), 700); }
    document.querySelectorAll("iframe.sd-youtube").forEach(iframe => {
        try {
            iframe.contentWindow.postMessage(
                JSON.stringify({ event: "command", func: "unMute", args: [] }),
                "*"
            );
            iframe.contentWindow.postMessage(
                JSON.stringify({ event: "command", func: "setVolume", args: [100] }),
                "*"
            );
        } catch(e) {}
    });
}

// Listen for any user interaction to unmute
["click", "touchstart", "keydown"].forEach(evt => {
    document.addEventListener(evt, unmuteAllYouTubeIframes, { once: false, passive: true });
});

function goNext() {
    if (!swiper) return;
    const isLast = swiper.activeIndex >= swiper.slides.length - 1;
    isLast ? swiper.slideTo(0, 800) : swiper.slideNext(800);
    swiper.autoplay.start();
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function fetchSignages() {
    try {
        const url = SCREEN_ID
            ? `${API_SCREEN}?screen_id=${encodeURIComponent(SCREEN_ID)}`
            : API_ALL;
        const res = await fetch(url, {
            headers: { "X-Frappe-CSRF-Token": SD.csrfToken || "Guest", Accept: "application/json" },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.message || [];
    } catch { return null; }
}

async function sendHeartbeat() {
    if (!SCREEN_ID) return;
    try {
        await fetch(`${API_HB}?screen_id=${encodeURIComponent(SCREEN_ID)}`, {
            method: "POST",
            headers: { "X-Frappe-CSRF-Token": SD.csrfToken || "Guest", "Content-Type": "application/json" },
            body: JSON.stringify({ screen_id: SCREEN_ID }),
        });
    } catch {}
}

// ── Slide builder ─────────────────────────────────────────────────────────────
function buildSlide(s) {
    const type       = (s.content_type || "Image");
    const durationMs = s.display_duration
        ? s.display_duration * 1000
        : (SD.displayDuration || 20000);

    const titleHtml = s.show_title ? `<h1 class="card-title">${esc(s.title)}</h1>` : "";
    const descHtml  = s.description ? `<p class="card-text">${s.description}</p>` : "";

    let inner = "";

    if (type === "Image") {
        inner = s.display_image
            ? `<img src="${esc(s.display_image)}" class="sd-img" alt="${esc(s.title)}" />
               <div class="card-img-overlay">${titleHtml}${descHtml}</div>`
            : `<div class="card-body">${titleHtml}${descHtml}</div>`;

    } else if (type === "Video") {
        inner = `<video class="sd-video" src="${esc(s.video_file)}" playsinline data-slide-video="1"></video>
                 ${(titleHtml || descHtml) ? `<div class="card-img-overlay">${titleHtml}${descHtml}</div>` : ""}`;

    } else if (type === "YouTube") {
        // Progress bar + countdown label overlay at the bottom
        const countdownSecs = Math.round(durationMs / 1000);
        inner = `
            <iframe class="sd-youtube"
                src="${esc(s.youtube_embed_url)}"
                allow="autoplay; encrypted-media; fullscreen"
                allowfullscreen frameborder="0"></iframe>
            <div class="sd-yt-bar-wrapper">
                <div class="sd-yt-bar-track">
                    <div class="sd-yt-progress-bar"></div>
                </div>
                <span class="sd-yt-countdown">${formatTime(countdownSecs)}</span>
            </div>`;

    } else if (type === "Webpage") {
        // Fullscreen iframe of an external URL. Same timer-based advancement as YouTube
        // (we can't detect "end" of an arbitrary webpage), with the same progress bar UX.
        const countdownSecs = Math.round(durationMs / 1000);
        inner = `
            <iframe class="sd-webpage"
                src="${esc(s.webpage_url)}"
                allow="autoplay; encrypted-media; fullscreen"
                allowfullscreen frameborder="0" scrolling="no"></iframe>
            <div class="sd-yt-bar-wrapper">
                <div class="sd-yt-bar-track">
                    <div class="sd-yt-progress-bar"></div>
                </div>
                <span class="sd-yt-countdown">${formatTime(countdownSecs)}</span>
            </div>`;

    } else {
        // Text Only — always show title, description is raw HTML from Text Editor
        const txtTitle = s.title ? `<h1 class="card-title">${esc(s.title)}</h1>` : "";
        const txtDesc  = s.description ? `<div class="card-text">${s.description}</div>` : "";
        inner = `<div class="sd-text-only">${txtTitle}${txtDesc}</div>`;
    }

    // Store timer duration on the slide for YouTube AND Webpage (both use the timer-based advance)
    const timedAttr = (type === "YouTube" || type === "Webpage")
        ? `data-yt-duration="${durationMs}"` : "";

    return `<div class="swiper-slide" data-swiper-autoplay="${durationMs}" data-content-type="${esc(type)}" ${timedAttr}>
              <div class="card sd-card">${inner}</div>
            </div>`;
}

function buildEmptySlide() {
    return `<div class="swiper-slide" data-content-type="Image">
              <div class="card sd-card">
                <div class="card-body" style="color:#888;font-size:1.5rem;">
                  No published signages yet.
                </div>
              </div>
            </div>`;
}

// ── Refresh cycle ─────────────────────────────────────────────────────────────
async function refreshSignages() {
    const signages = await fetchSignages();
    if (!signages) return;

    const json = JSON.stringify(signages);
    if (json === _lastJson) return;
    _lastJson = json;

    const prev = swiper ? swiper.activeIndex : 0;
    clearYouTubeTimer();
    swiper.autoplay.stop();
    swiper.removeAllSlides();

    signages.length === 0
        ? swiper.appendSlide(buildEmptySlide())
        : signages.forEach(s => swiper.appendSlide(buildSlide(s)));

    swiper.update();
    swiper.slideTo(Math.min(prev, swiper.slides.length - 1), 0);
    swiper.autoplay.start();
    handleActiveSlide();
}

function startPolling()   { refreshSignages(); setInterval(refreshSignages, POLL_INTERVAL_MS); }
function startHeartbeat() { sendHeartbeat();   setInterval(sendHeartbeat, HEARTBEAT_MS); }

function esc(str) {
    if (!str) return "";
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
