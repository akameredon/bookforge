# BookForge Studio

Drop Markdown chapters and a cover image into the browser. Get a print-ready PDF, a valid EPUB 3 for Amazon KDP, and a launch pack with copy-paste listing fields for KDP, Selar and Gumroad.

No signup. No backend. No database. Everything runs in your browser, so hosting costs nothing.

## Use it

1. Open `index.html` locally, or deploy it (below).
2. Drag in `.md` files (named `01_intro.md`, `02_chapter.md`, ...) and a PNG/JPG cover, or click **Load sample**.
3. Fill in the book details, then use **Print / Save PDF**, **Download EPUB** or **Download launch pack**.

## Deploy free on GitHub Pages

1. Create a new public repo on github.com.
2. Upload `index.html` and `README.md` (Add file, then Upload files).
3. Go to Settings, Pages, choose the `main` branch and the root folder, and save.
4. Your app goes live at `https://<your-username>.github.io/<repo-name>/`.

Cloudflare Pages works the same way: connect the repo and leave the build command empty.

## Notes

- PDF export uses the browser print dialog. Choose "Save as PDF" and turn off headers and footers.
- Gumroad has no one-click publish here. The app opens the new-product page and gives you copy buttons for every field.
- Amazon KDP and Selar have no public upload API, so the launch pack is a guided handoff.
- Drafts autosave in your browser (localStorage). Clearing site data removes them.
- Libraries are loaded from public CDNs: marked, JSZip and DOMPurify.
