(function() {
// Signage Display Player v3 — wrapped in IIFE to prevent duplicate declaration errors
// when Frappe's template engine loads this script more than once.
if (window._signageV3Loaded) return;
window._signageV3Loaded = true;

/**
 * display.js — Signage Display Player v3
 * Complete rewrite: no Swiper timing, custom engine, no transitions
 */
"use strict";

const SD = window._sd || {};
const SCREEN_ID    = SD.screenId || "";
const GLOBAL_MS    = SD.globalDuration || 10000;
const POLL_MS      = 30_000;
const HEARTBEAT_MS = 30_000;

const API_CONTENT = "/api/method/signage_display.signage_display.doctype.screen.screen.get_content_for_screen";
const API_HB      = "/api/method/signage_display.signage_display.doctype.screen.screen.screen_heartbeat";

let _slides        = [];
let _currentIndex  = 0;
let _slideTimer    = null;
let _clockInterval = null;
let _lastJson      = null;
let _wakeLock      = null;
let _userInteracted = false;

document.addEventListener("DOMContentLoaded", () => {
    console.log("[Signage v3] Screen:", SCREEN_ID || "(none)");
    startPolling();
    if (SCREEN_ID) startHeartbeat();
    initWakeLock();
    startFakeActivity();
    setupAudioUnmute();
});

async function initWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try { _wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !_wakeLock) initWakeLock();
});
setInterval(() => { if (!_wakeLock) initWakeLock(); }, 60_000);

function startFakeActivity() {
    setInterval(() => { window.scrollBy(0,1); window.scrollBy(0,-1); }, 4*60*1000);
}

function setupAudioUnmute() {
    ["click","touchstart","keydown","pointerdown"].forEach(evt =>
        document.addEventListener(evt, onUserInteraction, { passive: true })
    );
    setTimeout(() => {
        document.querySelectorAll("video").forEach(v => {
            v.muted = false;
            v.play().catch(() => { v.muted = true; });
        });
    }, 5000);
}

function onUserInteraction() {
    if (_userInteracted) return;
    _userInteracted = true;
    const hint = document.getElementById("sd-audio-hint");
    if (hint) { hint.classList.add("hide"); setTimeout(() => hint.remove(), 700); }
    document.querySelectorAll("iframe.sd-youtube").forEach(f => {
        try {
            f.contentWindow.postMessage(JSON.stringify({event:"command",func:"unMute",args:[]}), "*");
            f.contentWindow.postMessage(JSON.stringify({event:"command",func:"setVolume",args:[100]}), "*");
        } catch(_) {}
    });
    document.querySelectorAll("video").forEach(v => { v.muted = false; v.play().catch(()=>{}); });
}

function getContainer() {
    return document.querySelector(".sd-slide-container");
}

// Build flat slide list — PDF expanded to one entry per page
function buildSlideList(items) {
    const slides = [];
    for (const item of items) {
        const t = item.content_type || "Image";
        const durMs = (item.duration_sec || 0) * 1000 || GLOBAL_MS;
        if (t === "PDF") {
            const pages = Array.isArray(item.pdf_pages) ? item.pdf_pages : [];
            const pageDurMs = (item.pdf_page_duration_sec || 8) * 1000;
            pages.forEach((url, i) => slides.push({
                type: "PDF", url, pageNum: i+1,
                totalPages: pages.length, durMs: pageDurMs,
                contentName: item.content_name,
            }));
        } else if (t === "Clock") {
            slides.push({ type: "Clock", item, durMs: 24*60*60*1000 });
        } else {
            slides.push({ type: t, item, durMs });
        }
    }
    return slides;
}

function renderSlide(slide) {
    const container = getContainer();
    if (!container) return;
    if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
    document.querySelectorAll("video").forEach(v => { v.pause(); v.onended = null; });
    container.innerHTML = buildSlideHTML(slide);

    if (slide.type === "Video") {
        const video = container.querySelector("video");
        if (video) {
            video.muted = true;
            video.currentTime = 0;
            video.play().catch(() => {});
            if (_userInteracted) video.muted = false;
        }
    } else if (slide.type === "Clock") {
        startClock(container, slide.item);
    } else if (slide.type === "YouTube") {
        const iframe = container.querySelector("iframe.sd-youtube");
        if (iframe && _userInteracted) {
            setTimeout(() => {
                try { iframe.contentWindow.postMessage(JSON.stringify({event:"command",func:"unMute",args:[]}), "*"); } catch(_) {}
            }, 1500);
        }
    } else if (slide.type === "Webpage" || slide.type === "URL Redirect") {
        const iframe = container.querySelector("iframe.sd-webpage");
        if (iframe) {
            const src = iframe.getAttribute("src").split("?_t=")[0];
            iframe.setAttribute("src", src + (src.includes("?") ? "&" : "?") + "_t=" + Date.now());
        }
    }
}

function buildSlideHTML(slide) {
    const t = slide.type;
    if (t === "PDF") {
        return `<div class="sd-slide-inner">
            <img src="${e(slide.url)}" class="sd-img" alt="Page ${slide.pageNum}" />
            ${slide.totalPages > 1 ? `<div class="sd-pdf-indicator">${slide.pageNum} / ${slide.totalPages}</div>` : ""}
        </div>`;
    }
    const item = slide.item;
    if (t === "Image") {
        return item && item.media_image
            ? `<div class="sd-slide-inner"><img src="${e(item.media_image)}" class="sd-img" /></div>`
            : `<div class="sd-no-playlist">No image set.</div>`;
    }
    if (t === "Video") {
        return `<div class="sd-slide-inner">
            <video class="sd-video" src="${e(item.video_file)}" muted playsinline webkit-playsinline></video>
        </div>`;
    }
    if (t === "YouTube") {
        return `<div class="sd-slide-inner">
            <iframe class="sd-youtube" src="${e(item.youtube_embed_url)}"
                allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0"></iframe>
        </div>`;
    }
    if (t === "Webpage" || t === "URL Redirect") {
        const src = t === "Webpage" ? item.webpage_url : item.redirect_url;
        return `<div class="sd-slide-inner">
            <iframe class="sd-webpage" src="${e(src)}"
                allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0" scrolling="no"></iframe>
        </div>`;
    }
    if (t === "Clock") {
        const showDate = item.clock_show_date ? 1 : 0;
        const tz = item.clock_timezone_label ? `<div class="sd-clock-tz">${e(item.clock_timezone_label)}</div>` : "";
        return `<div class="sd-slide-inner">
            <div class="sd-clock-wrapper" data-format="${e(item.clock_format||"24 Hour")}" data-show-date="${showDate}">
                ${item.content_name ? `<div class="sd-clock-label">${e(item.content_name)}</div>` : ""}
                <div class="sd-clock-time">--:--</div>
                <div class="sd-clock-date"></div>
                ${tz}
            </div>
        </div>`;
    }
    return `<div class="sd-no-playlist">Unknown: ${e(t)}</div>`;
}

function startClock(container, item) {
    const wrapper = container.querySelector(".sd-clock-wrapper");
    if (!wrapper) return;
    const timeEl  = wrapper.querySelector(".sd-clock-time");
    const dateEl  = wrapper.querySelector(".sd-clock-date");
    const format  = wrapper.dataset.format || "24 Hour";
    const showDate = wrapper.dataset.showDate === "1";
    function tick() {
        const now = new Date();
        let h = now.getHours(), suffix = "";
        const m = String(now.getMinutes()).padStart(2,"0");
        const s = String(now.getSeconds()).padStart(2,"0");
        if (format === "12 Hour (AM/PM)") { suffix = h >= 12 ? " PM" : " AM"; h = h%12||12; }
        if (timeEl) timeEl.textContent = `${String(h).padStart(2,"0")}:${m}:${s}${suffix}`;
        if (showDate && dateEl) dateEl.textContent = now.toLocaleDateString(undefined, {
            weekday:"long", year:"numeric", month:"long", day:"numeric"
        });
    }
    tick();
    _clockInterval = setInterval(tick, 1000);
}

function showSlide(index) {
    if (_slides.length === 0) { showNoPlaylist(); return; }
    _currentIndex = ((index % _slides.length) + _slides.length) % _slides.length;
    const slide = _slides[_currentIndex];
    renderSlide(slide);
    scheduleNext(slide);
}

function scheduleNext(slide) {
    if (_slideTimer) { clearTimeout(_slideTimer); _slideTimer = null; }
    if (slide.type === "Clock") return; // clock never auto-advances
    if (slide.type === "Video") {
        const container = getContainer();
        const video = container ? container.querySelector("video") : null;
        if (video) {
            video.onended = () => { video.onended = null; advance(); };
            _slideTimer = setTimeout(() => {
                if (video.onended) { video.onended = null; }
                advance();
            }, 3*60*60*1000);
            return;
        }
    }
    _slideTimer = setTimeout(advance, slide.durMs || GLOBAL_MS);
}

function advance() {
    _slideTimer = null;
    showSlide(_currentIndex + 1);
}

function showNoPlaylist() {
    const container = getContainer();
    if (container) container.innerHTML = `<div class="sd-no-playlist">Please check playlist configuration.</div>`;
}

async function fetchContent() {
    if (!SCREEN_ID) {
        showError("No Screen ID in URL. Check your display URL.");
        return null;
    }
    try {
        const res = await fetch(
            `${API_CONTENT}?screen_id=${encodeURIComponent(SCREEN_ID)}`,
            { headers: { Accept: "application/json" } }
        );
        if (!res.ok) {
            showError(`API error ${res.status}. Check server logs.`);
            return null;
        }
        const data = await res.json();
        return data.message || null;
    } catch (err) {
        showError("Network error — retrying...");
        return null;
    }
}

function showError(msg) {
    const container = getContainer();
    if (container) {
        container.innerHTML = `<div class="sd-no-playlist">${msg}</div>`;
    }
}

async function sendHeartbeat() {
    if (!SCREEN_ID) return;
    try { await fetch(`${API_HB}?screen_id=${encodeURIComponent(SCREEN_ID)}`, { headers: { Accept: "application/json" } }); } catch {}
}

async function refreshContent() {
    const response = await fetchContent();
    if (!response) return;
    const now = new Date();
    const json = JSON.stringify(response) + `${now.getHours()}:${now.getMinutes()}`;
    if (json === _lastJson) return;
    _lastJson = json;
    const items = response.items || [];
    if (items.length === 0 || response.error === "no_playlist") {
        _slides = [];
        if (_slideTimer) { clearTimeout(_slideTimer); _slideTimer = null; }
        showNoPlaylist();
        return;
    }
    const newSlides = buildSlideList(items);
    if (newSlides.length === 0) { showNoPlaylist(); return; }

    const isFirstLoad = _slides.length === 0;
    const prevIndex = _currentIndex;
    _slides = newSlides;

    if (isFirstLoad) {
        // First time — always start from slide 0
        showSlide(0);
    } else if (prevIndex >= _slides.length) {
        // Playlist changed and current index is out of bounds — restart
        if (_slideTimer) { clearTimeout(_slideTimer); _slideTimer = null; }
        if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
        showSlide(0);
    }
    // Otherwise current slide finishes naturally then picks up new list
}

function startPolling()   { refreshContent(); setInterval(refreshContent, POLL_MS); }
function startHeartbeat() { sendHeartbeat();  setInterval(sendHeartbeat, HEARTBEAT_MS); }

function e(str) {
    if (!str) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}


})();
