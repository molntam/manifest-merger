# Manifest Merger

A lightweight, fully browser-based tool that takes multiple **Loading List / Manifest PDFs** exported from the shipping system and merges them into a single, clean, consolidated **Loading List PDF** — complete with a summary table, QR codes for tracking, and barcodes for shipment IDs.

Built as a **sustainability project**: by replacing the manual paper-based workflow it saves a significant amount of paper, ink and operator time every year.

---

## Why this project exists

Before this tool existed, every truck loading required printing **each individual manifest PDF separately**, sorting them by hand, stapling them together, and physically handing the stack to the driver and the loader.

The Manifest Merger replaces that workflow with a **one-click merge** that produces a single, well-formatted PDF.

### Estimated annual impact

| Resource | Saved per year |
|----------|---------------|
| Paper sheets | **25,000 – 35,000 sheets** |
| Operator time | **60 – 75 hours** of manual sorting, stapling and reprinting |
| Printer toner / ink | Significant reduction (proportional to paper savings) |
| Errors from manual sorting | Effectively eliminated |

In short: less paper, less waste, less wasted time, and more consistent output for the warehouse / loading team.

---

## How it works

The whole application runs **100% client-side in the browser** — no server, no upload, no data ever leaves the user's machine. This is important because the manifests can contain customer and shipment data.

### The pipeline

1. **Drop / select PDFs** (`index.html` + `script.js`)
   - Files are added through drag-and-drop or the file picker.
   - The list can be re-ordered with `Sortable.js`, previewed, or removed.

2. **Parse each PDF** (`extractFromPDF` in `script.js`)
   - `pdf.js` reads the text content and the position of every text item on every page.
   - Items are grouped by Y-coordinate into rows, then split into columns based on fixed X-coordinate widths (`COL_WIDTHS`).
   - From the text the tool extracts:
     - the **logistics service provider** and **service**,
     - the **loading list number**,
     - **totals** (orders, weight, volume, HU count),
     - **transport start** date/time,
     - and every **HU / delivery row** that belongs in the consolidated table.

3. **Extract QR codes** (`extractQRCodeFromPage`)
   - Each page is rendered to a canvas at 4× scale.
   - `jsQR` detects the QR code and the exact area is cropped out as a PNG, so the original printed QR is preserved (not re-encoded).

4. **Build the merged PDF** (`generatePDF`)
   - `pdf-lib` creates a fresh A4-landscape document.
   - Page 1 → header (provider, service, totals) and the start of the consolidated table.
   - Additional pages are added automatically when the table overflows; the column header is repeated on each page.
   - A final section, **"Tracking and POD"**, lays out the extracted QR codes paired with a freshly generated **CODE128 barcode** (`JsBarcode`) of the shipment ID and the transport-start time.
   - Footers with driver / loader signature lines and page numbers are stamped on every page.

5. **Download**
   - The generated PDF is offered as a download with the file name typed by the user (default `Merged_Manifest`).

### Project structure

```
.
├── index.html            UI shell + CDN script imports (two tabs)
├── script.js             Manifest Merger logic: parsing, QR extraction, PDF building
├── dn-extractor.js       Pure DN order-number extractor used after a merge
├── ocr-dn-extractor.js   Pure helpers for the OCR tab (regex, page range, dedupe)
├── ocr-ui.js             OCR tab UI + pdf.js/Tesseract.js orchestration
├── style.css             Styling for the drop area, file list, buttons, tabs, OCR panel
├── logo.svg              Header logo
└── icon.webp             Favicon
```

### Tech stack

- [pdf.js](https://mozilla.github.io/pdf.js/) – parse incoming PDFs (text + render pages)
- [pdf-lib](https://pdf-lib.js.org/) – build the merged output PDF
- [jsQR](https://github.com/cozmo/jsQR) – detect and crop QR codes
- [JsBarcode](https://github.com/lindell/JsBarcode) – render CODE128 barcodes
- [Sortable.js](https://github.com/SortableJS/Sortable) – drag-and-drop reordering of the file list
- [Tesseract.js](https://github.com/naptha/tesseract.js) – client-side WASM OCR for the OCR DN Extraction tab
- Vanilla HTML / CSS / JS — no build step

### OCR DN Extraction tab

An optional second tab, **OCR DN Extraction**, lets you pull DN order numbers out of scanned loading lists whose PDF text layer is empty. Everything still runs in the browser: pages are rendered with pdf.js (~300 DPI, grayscale + contrast stretch), OCR is done with Tesseract.js (WASM), and only values that match the strict pattern `\bDN[\s:.-]*(\d{8})\b` (case-insensitive) are accepted. Values that look like DN references but do not cleanly resolve to exactly eight digits (e.g. `DN 571I6344`) are surfaced separately as "Possible OCR Issues" for manual verification instead of being silently accepted. Modes: **Automatic** (try the text layer first, fall back to OCR only when the text layer finds no DNs) and **Force OCR**. Optional page range like `1-5` or `1,3,5-7`.

---

## Usage

1. Open `index.html` in a modern browser (Chrome / Edge recommended). No installation, no server.
2. Drag the manifest PDFs into the drop area, or click **Select PDFs**.
3. Re-order them by dragging if needed (the order in the list is the order in the merged output).
4. (Optional) Type a custom file name for the output.
5. Click **Generate Manifest PDF**. After a couple of seconds the merged PDF downloads automatically.

> Tip: you can host the folder on any static web server or SharePoint site — there is nothing to build or deploy.

---

## Next steps / roadmap

Things that are planned or would be nice to add:

- [ ] **Configurable templates.** Move the column headers, widths and parsing regexes into a JSON config so a non-developer can adapt the tool when the source manifest layout changes.
- [ ] **Dark mode** and a more accessible color palette (current palette assumes a light background).

---

## Known issues / limitations

These are the things that currently can bite you. Read them before opening a bug report:

- **Tightly coupled to the current manifest template.**
  The parser relies on the exact layout of the source PDF — column X-positions (`COL_WIDTHS`), header strings such as `Logistics service provider:`, `Service:`, `Amount of orders:`, `Transport start:` and the regex patterns that match HU IDs (`/\b(13\d{5,}|200\d{7,})\b/`). **If the upstream template changes, the code has to be updated** to match the new layout — this is the single biggest maintenance item.
- **Rows are detected by Y-coordinate.** PDFs whose text was generated with very different line spacing or rotated pages may produce missing or duplicated rows.
- **Only the first QR code on each page is extracted.** If a page contains more than one QR, the second one is ignored.
- **QR detection fails on very low-resolution PDFs.** The page is rendered at 4× scale; pages exported at very low DPI can fall below `jsQR`'s minimum readable size.
- **Browser-only.** Because everything happens in JavaScript in the browser, very large batches (hundreds of PDFs, thousands of rows) can be slow or run out of memory. For normal daily volumes this is not an issue.
- **Hard-coded constants.** Page size (A4 landscape, 842×595 pt), font (Helvetica), margins and column widths are defined as constants at the top of `script.js`. Changing them requires editing the source.
- **`VALID_CODES` is currently empty.** The HU-code disambiguation logic at `script.js` only kicks in when `VALID_CODES` is populated; until then, ambiguous Delivery / HU-ID columns fall back to the previous row's values.
- **CDN dependencies.** The libraries are loaded from public CDNs (`jsdelivr`, `cdnjs`, `unpkg`). On networks that block these, the page will load but nothing will work. For offline use the libraries should be vendored locally.
- **No error UI.** Most failures are reported with `alert()` or a silent console error. A proper toast / error panel would be a nice improvement.

---

## Contributing

This is a small internal tool — pull requests and issue reports are welcome. When changing the parser, please:

1. Keep a sample of the original manifest PDF (anonymised) alongside the change.
2. Mention which template version the change targets.
3. Verify that the output still renders correctly with at least 2–3 different manifests of varying sizes.

