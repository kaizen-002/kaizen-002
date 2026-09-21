// Refreshes the "Latest Shorts" block in README.md from the channel's public RSS feed. No API key needed.
// Leaves everything untouched if the feed cannot be read, so a YouTube hiccup never empties the section.
//
// YouTube only serves a Short's custom thumbnail as a 4:3 image: the 9:16 thumbnail in the middle, blurred copies
// on the sides. Each one is saved as a small SVG that embeds that image and shows only the middle, so the README
// gets the real vertical thumbnail without an image library.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCeqBbXyDN4XuX_O6a_LuqVQ';
const MAX = 4;
const WIDTH = 170;
const DIR = 'assets/shorts';
const START = '<!-- SHORTS:START -->';
const END = '<!-- SHORTS:END -->';
// sddefault is 640x480 and hqdefault 480x360. Both are 4:3.
const SOURCES = [['sddefault', 640, 480], ['hqdefault', 480, 360]];

const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const html = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pick = (block, re) => (block.match(re) || [])[1];

const res = await fetch(FEED);
if (!res.ok) {
  console.log(`Feed answered ${res.status}; nothing changed.`);
  process.exit(0);
}
const xml = await res.text();

const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, MAX).map(([, e]) => ({
  id: pick(e, /<yt:videoId>([^<]+)<\/yt:videoId>/),
  link: pick(e, /<link rel="alternate" href="([^"]+)"/),
  // Titles carry hashtags for YouTube search; they are noise here.
  title: unxml(pick(e, /<title>([^<]*)<\/title>/) || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim(),
})).filter(v => v.id && /^[\w-]+$/.test(v.id) && v.link);

if (!videos.length) {
  console.log('Feed has no videos; nothing changed.');
  process.exit(0);
}

async function thumbnailSvg({ id, link }) {
  for (const [name, w, h] of SOURCES) {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`).catch(() => null);
    if (!r?.ok) continue;
    const jpg = Buffer.from(await r.arrayBuffer()).toString('base64');
    // A Short shows its middle 9:16; anything else (a normal video) keeps the whole 4:3 frame.
    const vw = link.includes('/shorts/') ? Math.round((h * 9) / 16) : w;
    const x = Math.round((w - vw) / 2);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} 0 ${vw} ${h}" width="${vw}" height="${h}">` +
      `<clipPath id="r"><rect x="${x}" width="${vw}" height="${h}" rx="${Math.round(vw * 0.05)}"/></clipPath>` +
      `<image clip-path="url(#r)" width="${w}" height="${h}" href="data:image/jpeg;base64,${jpg}"/></svg>\n`;
  }
  return null;
}

mkdirSync(DIR, { recursive: true });
const shown = [];
for (const v of videos) {
  const svg = await thumbnailSvg(v);
  if (!svg) continue;
  const file = `${DIR}/${v.id}.svg`;
  if (!existsSync(file) || readFileSync(file, 'utf8') !== svg) writeFileSync(file, svg);
  shown.push({ ...v, file });
}
if (!shown.length) {
  console.log('No thumbnails could be fetched; nothing changed.');
  process.exit(0);
}
// Thumbnails that dropped out of the list are deleted, so the folder never grows.
for (const f of readdirSync(DIR)) if (!shown.some(v => v.file === `${DIR}/${f}`)) rmSync(`${DIR}/${f}`);

const cells = shown.map(v =>
  `<td align="center" valign="top" width="${WIDTH + 10}">\n` +
  `<a href="${html(v.link)}"><img src="${v.file}" width="${WIDTH}" alt="${html(v.title)}"></a><br>\n` +
  `<sub>${html(v.title)}</sub>\n` +
  `</td>`);
const block = `${START}\n<table><tr>\n${cells.join('\n')}\n</tr></table>\n${END}`;

const readme = readFileSync('README.md', 'utf8');
const from = readme.indexOf(START), to = readme.indexOf(END);
if (from < 0 || to < from) throw new Error('README.md is missing the SHORTS markers');
const next = readme.slice(0, from) + block + readme.slice(to + END.length);
if (next !== readme) writeFileSync('README.md', next);
console.log(`Latest Shorts: ${shown.map(v => v.title).join(' | ')}`);
