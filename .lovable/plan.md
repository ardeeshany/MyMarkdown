# Use uploaded image as the link share thumbnail (og:image)

## Goal
When someone shares a link to mymarkdown.site (LinkedIn, X, WhatsApp, Slack, etc.), the card should show the uploaded 3D "Markdown transformed into a beautiful page" image.

## Current state (verified)
- `src/routes/index.tsx` already has og:title, og:description, og:type, og:url, and `twitter:card: summary_large_image` — but **no `og:image` / `twitter:image`**, so share cards show no thumbnail.
- The uploaded image is `user-uploads://MyMarkdown_3.webp` (~1536x1024).

## Steps
1. Create a share-sized 1200x630 rendition of the uploaded image with AI image editing (keeps the composition, crops/reframes to the standard social card ratio).
2. Upload the rendition with the Lovable assets CLI (`lovable-assets create`) so it's served from the CDN; store the `.asset.json` pointer in the project.
3. In `src/routes/index.tsx` head(), add:
   - `{ property: "og:image", content: "https://mymarkdown.site/__l5e/assets-v1/<asset_id>/mymarkdown-og.png" }`
   - `{ name: "twitter:image", content: <same absolute URL> }`
   - An `og:image:width` (1200) and `og:image:height` (630) hint for faster/better card rendering.
   - Both tags point at the same image, using the absolute URL so crawlers outside the site can fetch it.
4. Verify the asset URL returns the image (HTTP 200, correct type) and that the head tags render in the page.

## Notes
- The share image is a metadata-only change: nothing visible on the page itself changes.
- Crawlers only see the new thumbnail after the project is **published** — the live URL serves the last published build. I'll flag this at the end so you know to hit publish.
