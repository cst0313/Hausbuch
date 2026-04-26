// Pre-extracts text from every PDF in tmp/hackathon/{briefe,rechnungen}/**.
// Output: tmp/hackathon/pdf_texts.json — single file the seed reads at boot.
// Run once after pulling the data: `node scripts/extract-pdf-texts.mjs`
import { PDFParse } from "pdf-parse";
import fs from "fs";
import path from "path";

const ROOTS = [
  "tmp/hackathon/briefe",
  "tmp/hackathon/rechnungen",
  "tmp/hackathon/incremental",
];
const OUT = "tmp/hackathon/pdf_texts.json";

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const walk = (root, out = []) => {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root)) {
    const p = path.join(root, entry);
    if (isDir(p)) walk(p, out);
    else if (p.endsWith(".pdf")) out.push(p);
  }
  return out;
};

const all = ROOTS.flatMap((r) => walk(r));
console.log(`extracting ${all.length} PDFs...`);

const out = [];
let i = 0;
for (const file of all) {
  i++;
  if (i % 25 === 0) console.log(`  ${i}/${all.length}`);
  try {
    const buf = fs.readFileSync(file);
    const parser = new PDFParse({ data: buf });
    const r = await parser.getText();
    await parser.destroy?.();
    // Normalize Windows path separators so the JSON is portable.
    const normalized = file.split(path.sep).join("/");
    out.push({
      file: normalized,
      text: r.text,
      bytes: buf.length,
    });
  } catch (e) {
    console.warn(`  parse-fail ${file}: ${e.message}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(out));
const totalChars = out.reduce((n, e) => n + e.text.length, 0);
console.log(`wrote ${out.length} entries, ${totalChars.toLocaleString()} chars total → ${OUT}`);
