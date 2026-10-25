# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- Note: the desktop app is Kotlin Compose Multiplatform (JVM, Windows-first) with the video
player's controls drawn as an HTML page in WebView2 over mpv. "web" here records that the
design language is the app's own, not a native iOS/Android language. -->

## Users

One person's personal fork. The owner watches movies, series and anime on a Windows PC, both at a
desk with mouse and keyboard and from a couch/TV distance, roughly equally. Arabic subtitles are
essential (often addon subtitles that need syncing); English UI.

## Product Purpose

A media center that plays streams from user-installed Stremio-compatible addons (AIOStreams over
TorBox debrid, Anime Kitsu, Cinemeta, SubSense) with a local (offline) profile. Success: finding
something to watch and getting it playing with correct, well-placed Arabic subtitles in as few
steps as possible, in an interface that feels polished rather than bare-bones.

## Positioning

A personal, desktop-first Nuvio build: subtitle handling tuned for Arabic (MBC 2 style right
alignment, RTL fixes, automatic sync to the video's embedded timing) on top of Nuvio's addon
ecosystem.

## Operating Context

- Windows desktop, mouse/keyboard and lean-back viewing both matter.
- Streams are large remux/WEB-DL files via debrid; many titles have no 4K or Blu-ray release.
- Builds come from GitHub Actions on the fork (`.github/workflows/custom-windows-build.yml`).

## Capabilities and Constraints

- Redesign scope is **desktop only**; shared Compose code used by Android/iOS must keep working
  and should not change appearance on mobile.
- Custom builds lack upstream secrets: Nuvio cloud sign-in, Trakt and MDBList are unavailable;
  the local account is fully supported.
- No local Gradle in the build sandbox; verification happens through CI builds and screenshots
  from the owner's PC.
- Player UI is HTML/CSS/JS (WebView2) and can use web animation; the rest is Compose.

## Brand Commitments

- Name: Nuvio (fork). The owner asked for an Apple-like feel, specifically the macOS / visionOS
  feel: translucent sidebars, frosted panels, depth. They also named GSAP and React Bits as
  inspiration; React Bits cannot run in Compose screens, so its ideas apply only as motion
  references.

## Evidence on Hand

No marketing content, testimonials or metrics; none should be invented.

## Product Principles

1. Get to playback fast: fewer steps from launch to a playing stream.
2. Subtitles are first-class, especially Arabic: correct placement, direction and timing.
3. Work equally well with a mouse at a desk and from a distance.
4. Desktop changes must not break or restyle the mobile apps.
5. Standard streaming-service conveniences are expected, not extras.
