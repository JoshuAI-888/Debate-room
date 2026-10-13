import fs from "node:fs";
import path from "node:path";
import { AGENTS_DIR, BRAINS_DIR } from "./env.mjs";

import { config } from "./inference.mjs";
import { loadCharacters } from "./characters.mjs";
export const SEATS = loadCharacters().filter((s) => s.enabled);
export const byKey = Object.fromEntries(SEATS.map((s) => [s.key, s]));

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const stripFront = (t) => t.replace(/^---[\s\S]*?\n---\n/, "");

const systemCache = new Map();
/** The seat's agent instructions plus its brain, loaded inline (the API has no file tools). */
export function systemFor(key) {
  const context = config().context;
  const cacheKey = `${key}:${context}`;
  if (systemCache.has(cacheKey)) return systemCache.get(cacheKey);
  const s = byKey[key];
  const agent = stripFront(read(path.join(AGENTS_DIR, `council-${key}.md`)));
  const files = context === "compact" ? ["_hot.md", "voice.md", "sources.md"] : ["_hot.md", "frameworks.md", "positions.md", "principles.md", "voice.md", "stories.md", "sources.md"];
  const brain = files
    .map((f) => `\n\n===== brains/${s.slug}/${f} =====\n` + read(path.join(BRAINS_DIR, s.slug, f)))
    .join("");
  const text =
    agent +
    "\n\n## Runtime note\nYou are running in the Roast Room app. You have no file tools: your brain files are loaded below in full, so treat instructions to read the supplied files as already done. Cite and quote only material actually supplied below. If a file or fact is absent, admit the limitation; never infer its contents. Never mention files, tools, or this note in your answer.\n" +
    brain;
  const system = [{ type: "text", text, cache_control: { type: "ephemeral" } }];
  systemCache.set(cacheKey, system);
  return system;
}

// ---------- quote verification against the brain ----------
const norm = (s) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/'\s+(t|s|re|ll|ve|d|m)\b/g, "'$1")
    .replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const brainText = new Map();
function brainNorm(key) {
  if (!brainText.has(key)) {
    const dir = path.join(BRAINS_DIR, byKey[key].slug);
    const all = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => read(path.join(dir, f))).join(" ") : "";
    brainText.set(key, norm(all));
  }
  return brainText.get(key);
}
/** Quotes the seat attributed to a source id, each marked verified or not. */
export function checkQuotes(key, text) {
  const out = [];
  const re = /["“]([^"“”\n]{20,400})["”][^\n"]{0,40}?[(\[](S\d{3})/g;
  let m;
  const hay = brainNorm(key);
  while ((m = re.exec(text))) {
    const q = norm(m[1]);
    if (q.split(" ").length < 5) continue;
    out.push({ quote: m[1], source: m[2], verified: hay.includes(q) || hay.replace(/ /g, "").includes(q.replace(/ /g, "")) });
  }
  return out;
}

// ---------- card parsing ----------
const field = (text, label) => {
  // label at line start, or after a "·" or "|" when several fields share a line
  const m = text.match(new RegExp(`(?:^|[·|])[ \\t]*\\**${label}\\**[ \\t]*:[ \\t]*([^\\n·]+)`, "im"));
  return m ? m[1].replace(/\*+/g, "").trim() : "";
};
const num = (s) => { const m = (s || "").match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };

export function parseOptionScores(text, optionIds) {
  // the option line itself uses "·" between options, so read to end of line
  const lm = text.match(/OPTION SCORES\**[ \t]*:[ \t]*([^\n]+)/i);
  const line = (lm ? lm[1] : "").split(/PILLAR SCORE|CONFIDENCE|FINAL SCORE/i)[0];
  const scores = {};
  for (const id of optionIds) {
    const m = line.match(new RegExp(`\\b${id}\\b\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)`));
    if (m) scores[id] = Math.max(0, Math.min(10, Number(m[1])));
  }
  return scores;
}

export function parseCard(text, optionIds) {
  const stance = field(text, "STANCE");
  const ruin = (field(text, "RUIN RISK").match(/none|possible|likely/i) || [""])[0].toLowerCase();
  const disagree = field(text, "I DISAGREE MOST WITH");
  const target = SEATS.find((s) => new RegExp(`\\b(${s.short}|${s.name.split(" ").pop()})\\b`, "i").test(disagree.slice(0, 40)));
  const voteRaw = field(text, "VOTE");
  const vote = /dissent/i.test(voteRaw) ? "dissent" : /amend/i.test(voteRaw) ? "amend" : /endorse/i.test(voteRaw) ? "endorse" : "";
  return {
    stance,
    call: field(text, "THE CALL"),
    optionScores: parseOptionScores(text, optionIds),
    pillar: num(field(text, "PILLAR SCORE")) ?? num(field(text, "FINAL PILLAR SCORE")),
    finalScore: num(field(text, "FINAL SCORE")),
    confidence: num(field(text, "CONFIDENCE")),
    ruin,
    door: (field(text, "DOOR").match(/one-way|two-way/i) || [""])[0].toLowerCase(),
    disagreeWith: target ? target.key : null,
    disagreeLine: disagree,
    concede: field(text, "I CONCEDE"),
    moved: field(text, "MOVED"),
    vote,
    amendment: field(text, "AMENDMENT OR DISSENT"),
    oneLine: field(text, "ONE LINE FOR THE FOUNDER"),
    question: field(text, "QUESTION FOR THE FOUNDER"),
    risk: field(text, "THE RISK I SEE"),
    thisWeek: field(text, "WHAT I'D DO THIS WEEK"),
  };
}
