/**
 * display.js — Signage Display Player
 * Fixes in this version:
 *  1. Video plays WITH audio (muted removed)
 *  2. Video slides wait for the 'ended' event — never cut short
 *  3. Safety timeout for video set to 3 hours (won't fire for normal videos)
 *  4. Fullscreen layout (CSS handles sizing)
 */
"use strict";

const SD = window._sd || {};
const SCREEN_ID        = SD.screenId || "";
const POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_MS     = 30_000;

const API_ALL    = "/api/method/signage_display.signage_display.doctype.signage.signage.get_all_signages";
const API_SCREEN = "/api/method/signage_display.signage_display.doctype.signage.signage.get_signages_for_screen";
const API_HB     = "/api/method/signage_display.signage_display.doctype.signage.signage.screen_heartbeat";

let swiper     = null;
let _lastJson  = null;

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

    swiper.on("autoplayStop", () => {
        // Only restart if the current slide is NOT a video
        // (videos manage their own advancement via 'ended' event)
        const slide = swiper.slides[swiper.activeIndex];
        if (slide && !slide.querySelector("video.sd-video")) {
            swiper.autoplay.start();
        }
    });

    swiper.on("slideChangeTransitionEnd", handleActiveSlide);
}

// ── Video slide handler ───────────────────────────────────────────────────────
function handleActiveSlide() {
    if (!swiper) return;

    // Pause all videos that are not the current slide
    document.querySelectorAll(".sd-video").forEach(v => {
        v.pause();
        v.currentTime = 0;
        v.onended = null;
    });

    const slide = swiper.slides[swiper.activeIndex];
    if (!slide) return;

    const video = slide.querySelector("video.sd-video");
    if (!video) return;

    // Stop Swiper autoplay — video controls when to advance
    swiper.autoplay.stop();
    video.currentTime = 0;

    // Play with audio — browser may block if no user interaction yet
    // We try with audio first, fallback to muted if blocked
    const playPromise = video.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            // Browser blocked autoplay with audio — play muted as fallback
            video.muted = true;
            video.play().catch(() => {});
        });
    }

    // Advance to next slide when video naturally ends
    video.onended = () => {
        video.onended = null;
        goNext();
    };

    // Safety timeout — 3 hours — only fires if video somehow never ends
    // This will NOT interrupt a 3-minute video
    setTimeout(() => {
        if (video.onended) {
            video.onended = null;
            goNext();
        }
    }, 3 * 60 * 60 * 1000);
}

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
            headers: {
                "X-Frappe-CSRF-Token": SD.csrfToken || "Guest",
                Accept: "application/json",
            },
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
            headers: {
                "X-Frappe-CSRF-Token": SD.csrfToken || "Guest",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ screen_id: SCREEN_ID }),
        });
    } catch {}
}

// ── Slide builder ─────────────────────────────────────────────────────────────
function buildSlide(s) {
    const type     = (s.content_type || "Image");
    const duration = s.display_duration
        ? s.display_duration * 1000
        : (SD.displayDuration || 20000);

    const titleHtml = s.show_title
        ? `<h1 class="card-title">${esc(s.title)}</h1>` : "";
    const descHtml  = s.description
        ? `<p class="card-text">${s.description}</p>` : "";

    let inner = "";

    if (type === "Image") {
        inner = s.display_image
            ? `<img src="${esc(s.display_image)}" class="sd-img" alt="${esc(s.title)}" />
               <div class="card-img-overlay">${titleHtml}${descHtml}</div>`
            : `<div class="card-body">${titleHtml}${descHtml}</div>`;

    } else if (type === "Video") {
        // NO muted attribute — audio plays normally
        inner = `<video class="sd-video" src="${esc(s.video_file)}" playsinline data-slide-video="1"></video>
                 ${(titleHtml || descHtml)
                    ? `<div class="card-img-overlay">${titleHtml}${descHtml}</div>`
                    : ""}`;

    } else if (type === "YouTube") {
        inner = `<iframe class="sd-youtube"
                   src="${esc(s.youtube_embed_url)}"
                   allow="autoplay; encrypted-media; fullscreen"
                   allowfullscreen frameborder="0"></iframe>`;

    } else {
        // Text Only
        inner = `<div class="sd-text-only">
                   ${titleHtml}
                   <div class="card-text">${s.description || ""}</div>
                 </div>`;
    }

    return `<div class="swiper-slide" data-swiper-autoplay="${duration}">
              <div class="card sd-card">${inner}</div>
            </div>`;
}

function buildEmptySlide() {
    return `<div class="swiper-slide">
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
function startHeartbeat() { sendHeartbeat();   setInterval(sendHeartbeat,   HEARTBEAT_MS); }

function esc(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
