import Link from 'next/link';
import type { Metadata } from 'next';
import BulkRename from '@/components/BulkRename';
import AiSummarize from '@/components/AiSummarize';
import { BRAND } from '@/lib/converters/registry';
import { SITE_URL } from '@/lib/site';
import { ldScript, webApplicationJsonLd, faqPageJsonLd, breadcrumbJsonLd, howToJsonLd } from '@/lib/jsonld';

export const metadata: Metadata = {
  // Note: layout applies the `%s | Quick Files Converter` template, so the
  // brand suffix is intentionally omitted here to avoid duplication.
  title: 'Bulk Rename Files Online — Free, No Upload',
  description:
    'Rename hundreds of files at once, free: find & replace, add prefixes, sequential numbering, fix cases and spaces. Live preview, extensions always protected, download as ZIP — 100% in your browser, no upload.',
  alternates: { canonical: '/tools/bulk-rename/' },
};

const FAQS = [
  {
    q: 'Is the bulk file renamer really free?',
    a: `Yes — like every tool on ${BRAND}, the bulk renamer is free forever. No sign-up, no watermarks, no limits on how many batches you rename. Rename 500 photos now and 500 more in an hour; nobody is counting.`,
  },
  {
    q: 'Are my files uploaded anywhere?',
    a: `No. The renamer runs entirely in your browser — your files never leave your device. In fact the file contents are never even read: only the file names are processed. There is no server that could see them, because ${BRAND} has no file-processing servers at all.`,
  },
  {
    q: 'Can renaming break my files?',
    a: 'No. Two things protect you: first, the extension (the .jpg, .pdf, .mp4 part) is never renamed — it is always preserved exactly, because renaming it is what breaks files. Second, your original files are never modified; the tool produces renamed copies inside a ZIP, so the sources stay exactly as they were.',
  },
  {
    q: 'What happens if two files end up with the same new name?',
    a: 'The preview flags it and the download fixes it automatically: duplicates get " (2)", " (3)" and so on appended before the extension. You will never get a ZIP where one file silently overwrote another.',
  },
  {
    q: 'Can I undo a rename?',
    a: 'There is nothing to undo on your device — the renamer never touches your original files. If you do not like the result, just adjust the rules and download again. Your source files remain exactly as they were.',
  },
  {
    q: 'Does it work with any file type?',
    a: 'Yes. The renamer does not care what is inside the file — photos, videos, PDFs, documents, even files with no extension at all. It only rewrites the name string, so every file type works the same way.',
  },
  {
    q: 'What is the 500-file limit?',
    a: 'A safety cap so a single batch stays snappy in the browser. Renaming itself is instant — the cap only keeps the preview table and the ZIP build comfortable. Need more? Rename in two batches; it takes seconds.',
  },
];

const HOWTO_STEPS = [
  {
    name: 'Add your files',
    text: 'Drag up to 500 files onto the drop zone, or click to pick them. Any file type works — only names are processed, contents are never read or uploaded.',
  },
  {
    name: 'Set your rename rules',
    text: 'Combine find & replace, prefix/suffix, sequential numbering, case changes, space handling and special-character stripping. Rules apply top to bottom.',
  },
  {
    name: 'Check the live preview',
    text: 'Every keystroke updates the old → new preview instantly. Duplicates are flagged and fixed automatically before you download.',
  },
  {
    name: 'Download as ZIP',
    text: 'Hit "Download all as ZIP" and get every file with its new name. Your originals stay untouched on your device.',
  },
];

const USE_CASES = [
  {
    t: 'Photographers: tame the camera roll',
    d: 'Turn "DSC_0042.JPG", "DSC_0043.JPG" into "greece-trip-001.jpg", "greece-trip-002.jpg" with find & replace plus sequential numbering — clients and galleries both prefer meaningful names.',
  },
  {
    t: 'Clean up the Downloads folder',
    d: 'Strip the "final", "final2", "(1)" chaos: find & replace plus strip-special-characters turns a messy download pile into a tidy, searchable set in one batch.',
  },
  {
    t: 'SEO-friendly file names',
    d: 'Search engines read file names. Convert "My Product Photo 1.PNG" into "my-product-photo-1.png" — lowercase, dashed, no spaces — across your whole media library before uploading.',
  },
  {
    t: 'Number scanned pages in order',
    d: 'Scans often arrive out of order with random names. Sort your files, then apply sequential numbering to get "contract-001.pdf" through "contract-120.pdf" in seconds.',
  },
  {
    t: 'Prep assets for developers',
    d: 'Codebases hate spaces and special characters in asset names. One pass with "spaces to dashes" plus "strip special characters" makes every asset build-safe.',
  },
];

const PAGE_URL = `${SITE_URL}/tools/bulk-rename/`;

export default function BulkRenamePage() {
  return (
    <div className="wrap">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> › <Link href="/categories/tools">File Tools</Link> › Bulk File Renamer
      </nav>

      <div className="page-head">
        <span className="pill">FILE TOOLS</span>
        <h1>Free Bulk File Renamer</h1>
        <p className="lead">
          Rename hundreds of files in one go — find &amp; replace, prefixes, sequential
          numbering, case fixes and space cleanup, all combined. Free forever, no sign-up,
          and your files never leave your device.
        </p>
        <p className="tldr">
          <strong>TL;DR:</strong> Drop up to 500 files, set rename rules, watch the live
          preview update with every keystroke, then download everything renamed as a ZIP.
          Extensions are always protected, duplicates are auto-fixed, and your originals
          are never touched.
        </p>
      </div>

      <AiSummarize
        summaryText={`Free Bulk File Renamer on ${BRAND}. TL;DR: drop up to 500 files of any type, combine find & replace, prefix/suffix, sequential numbering, case changes, space handling and special-character stripping, watch the live old → new preview update on every keystroke, then download all renamed files as a ZIP. Extensions are always preserved, duplicates auto-fixed, originals never touched — everything runs in your browser, so your files never leave your device.`}
      />

      <BulkRename />

      <section className="prose">
        <h2>How to rename files in bulk</h2>
        <div className="steps">
          {HOWTO_STEPS.map((s, i) => (
            <div className="step" key={s.name} id={`step-${i + 1}`}>
              <div className="s-t">{s.name}</div>
              <div className="s-d">{s.text}</div>
            </div>
          ))}
        </div>

        <h2>Why rename in bulk instead of one by one</h2>
        <p>
          Renaming 200 photos by hand takes the better part of an hour and invites typos —
          "greece-trip-042.jpg" becomes "greece-trip-024.jpg" and nobody notices until a
          client asks. A bulk renamer applies the exact same rule to every file, numbers
          them in order, and shows you the full result before anything is downloaded.
          What took an hour takes twenty seconds, with zero typos.
        </p>
        <p>
          Most bulk renamers are desktop programs you have to install — or they upload
          your files to a server first. This one does neither: it runs entirely in your
          browser, works with any file type, and never sees your file contents at all.
          That is also why there is nothing to sign up for and nothing to pay.
        </p>

        <h2>When to use the bulk renamer</h2>
        {USE_CASES.map((u) => (
          <div key={u.t} className="use-case">
            <div className="s-t">{u.t}</div>
            <p>{u.d}</p>
          </div>
        ))}

        <h2>One practical tip</h2>
        <p>
          Combine <strong>find &amp; replace</strong> with <strong>sequential
          numbering</strong>: first replace the messy part of every name ("DSC_"),
          then number the results ("trip-001", "trip-002"). The live preview shows the
          combined result instantly, so experiment freely — nothing is final until you
          hit download.
        </p>

        <h2>Bulk file renamer — FAQs</h2>
        {FAQS.map((f) => (
          <details key={f.q} className="faq">
            <summary>{f.q}</summary>
            <div className="faq-a">{f.a}</div>
          </details>
        ))}

        <h2>More free file tools</h2>
        <p>
          Renaming is just the start. <Link href="/categories/tools">Browse all file
          tools</Link>, or jump to the <Link href="/convert/merge-pdf">Merge PDF</Link>{' '}
          and <Link href="/convert/compress-pdf">Compress PDF</Link> tools. See{' '}
          <Link href="/all-converters">every converter</Link> on {BRAND} — all free,
          all on-device.
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(
          webApplicationJsonLd(
            {
              id: 'bulk-rename',
              title: 'Bulk File Renamer',
              description:
                'Free bulk file renamer: find & replace, prefix/suffix, sequential numbering, case and space cleanup for up to 500 files. Live preview, ZIP download, 100% in your browser.',
            },
            '/tools/bulk-rename/'
          )
        )}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={ldScript(faqPageJsonLd(FAQS))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(
          breadcrumbJsonLd([
            { name: 'Home', url: `${SITE_URL}/` },
            { name: 'File Tools', url: `${SITE_URL}/categories/tools/` },
            { name: 'Bulk File Renamer', url: PAGE_URL },
          ])
        )}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(
          howToJsonLd('How to rename files in bulk', 'Rename up to 500 files at once with live preview and ZIP download, entirely in your browser.', HOWTO_STEPS, PAGE_URL)
        )}
      />
    </div>
  );
}
