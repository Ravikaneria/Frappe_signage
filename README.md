# Signage Display

A Frappe app for creating digital signage display boards.

## Features

- Multiple screen support (up to 50 unique display URLs)
- Live screen status tracking (Live Now / Offline)
- Content types: Image, Video (MP4/WebM), YouTube, Text Only
- Per-screen signage assignment or show all published signages
- Auto image resize to max 1920x1080 on upload
- Swiper-based slideshow with configurable durations

## Installation

```bash
bench get-app https://github.com/Ravikaneria/frappe-signage-display-app
bench --site yoursite install-app signage_display
bench --site yoursite migrate
```

## Usage

1. Go to **Signage Display** module in ERPNext
2. Create **Signage** records (Image / Video / YouTube / Text Only)
3. Create **Screen** records — each gets a unique display URL
4. Open the display URL on any TV or browser
5. Assign specific signages to a screen or show all published content

## License

MIT
