/**
 * display.js — Signage Display Player
 * Supports: Image · Video (MP4/WebM) · YouTube · Text Only
 * Multi-screen via /display/<screen_id>
 * Heartbeat keeps Screen "Live Now" status updated in ERPNext
 */
"use strict";

const SD = window._sd || {};
const SCREEN_ID        = SD.screenId || "";
const POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_MS     = 30_000;

const API_ALL      = "/api/method/signage_display.signage_display.doctype.signage.signage.get_all_signages";
const API_SCREEN   = "/api/method/signage_display.signage_display.doctype.signage.signage.get_signages_for_screen";
const API_HB       = "/api/method/signage_display.signage_display.doctype.signage.signage.screen_heartbeat";

let swiper = null;
let _lastJson = null;

document.addEventListener("DOMContentLoaded", () => {
    initSwiper();
    startPolling();
    if (SCREEN_ID) startHeartbeat();
});

function initSwiper() {
    swiper = new Swiper(".sd-swiper", {
        speed: 1500,
        direction: "horizontal",
        autoplay: {
            delay: SD.displayDuration || 20000,
            disableOnInteraction: false,
        },
        slidesPerView: SD.columnCount || 1,
        grid: { rows: SD.rowCount || 1, fill: "row" },
        spaceBetween: 20,
        pagination: { el: ".swiper-pagination", clickable: true },
        loop: false,
    });
    swiper.on("autoplayStop", () => swiper.autoplay.start());
    swiper.on("slideChangeTransitionEnd", handleActiveSlide);
}

function handleActiveSlide() {
    if (!swiper) return;
    document.querySelectorAll(".sd-video").forEach(v => { v.pause(); v.currentTime = 0; });
    const slide = swiper.slides[swiper.activeIndex];
    if (!slide) return;
    const video = slide.querySelector("video.sd-video");
    if (video) {
        swiper.autoplay.stop();
        video.currentTime = 0;
        video.play().catch(() => {});
        video.onended = () => { video.onended = null; goNext(); };
        const maxWait = parseInt(slide.dataset.swiperAutoplay) || (SD.displayDuration || 20000);
        setTimeout(() => { if (!video.ended) { video.onended = null; goNext(); } }, maxWait);
    }
}

function goNext() {
    if (!swiper) return;
    const isLast = swiper.activeIndex >= swiper.slides.length - 1;
    isLast ? swiper.slideTo(0, 800) : swiper.slideNext(800);
    swiper.autoplay.start();
}

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

function buildSlide(s) {
    const type     = (s.content_type || "Image");
    const height   = (SD.signageHeight || 76) - 4;
    const duration = s.display_duration ? s.display_duration * 1000 : (SD.displayDuration || 20000);
    const titleHtml = s.show_title ? `<h1 class="card-title">${esc(s.title)}</h1>` : "";
    const descHtml  = s.description  ? `<p class="card-text">${s.description}</p>` : "";
    let inner = "";

    if (type === "Image") {
        inner = s.display_image
            ? `<img src="${esc(s.display_image)}" class="card-img sd-img" alt="${esc(s.title)}" />
               <div class="card-img-overlay p-5">${titleHtml}${descHtml}</div>`
            : `<div class="card-body p-5">${titleHtml}${descHtml}</div>`;
    } else if (type === "Video") {
        inner = `<video class="sd-video" src="${esc(s.video_file)}" muted playsinline data-slide-video="1"></video>
                 ${(titleHtml||descHtml) ? `<div class="card-img-overlay p-5">${titleHtml}${descHtml}</div>` : ""}`;
    } else if (type === "YouTube") {
        inner = `<iframe class="sd-youtube" src="${esc(s.youtube_embed_url)}"
                   allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0"></iframe>`;
    } else {
        inner = `<div class="card-body p-5 sd-text-only">${titleHtml}<div class="card-text">${s.description||""}</div></div>`;
    }

    return `<div class="swiper-slide" data-swiper-autoplay="${duration}">
              <div class="card sd-card" style="height:${height}vh;">${inner}</div>
            </div>`;
}

function buildEmptySlide() {
    const h = (SD.signageHeight || 76) - 4;
    return `<div class="swiper-slide">
              <div class="card sd-card" style="height:${h}vh;">
                <div class="card-body p-5 d-flex align-items-center justify-content-center">
                  <p style="color:#888;">No published signages yet.</p>
                </div>
              </div>
            </div>`;
}

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
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
