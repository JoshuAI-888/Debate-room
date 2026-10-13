// Paid smoke test: one structured Chair call and one streamed seat card.
import { SEATS, systemFor, parseCard, checkQuotes } from "../lib/seats.mjs";
import * as ai from "../lib/inference.mjs";
import { MODELS } from "../lib/council.mjs";

console.log("Provider:", ai.publicInfo());
const setup = await ai.json({ model: MODELS.chair, system: "You are a business decision chair.", prompt: "Return a title for a coaching price decision and two options.", schema: ai.S.obj({ title: ai.S.str, options: ai.S.arr(ai.S.str) }), maxTokens: 300 });
console.log("Chair JSON:", setup);
const sys = systemFor("hormozi");
console.log("hormozi system chars:", sys[0].text.length);

const t0 = Date.now();
const card = await ai.stream({
  model: MODELS.seat, system: sys, maxTokens: 900,
  messages: [{ role: "user", content: `ROAST ROOM COUNCIL, ROUND 1 OF 3: OPENING POSITION
You hold the HORMOZI seat. THE BRIEF: A $30k/month coaching business wants to raise prices from $2,000 to $3,500. Options: (A) raise for everyone now, (B) raise for new clients only, (C) keep $2,000.
Answer under 200 words in this shape:
SEAT: HORMOZI
STANCE: ...
OPTION SCORES: A n/10 · B n/10 · C n/10
PILLAR SCORE: n/10
CONFIDENCE: n/5
RUIN RISK: none | possible | likely
DOOR: one-way | two-way
THE CALL: one sentence.
WHY: 1. with a framework and source id, e.g. (Value Equation, S014)` }],
});
console.log(`seat card in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`, card);
console.log(parseCard(card, ["A", "B", "C"]));
console.log(checkQuotes("hormozi", card));
console.log(ai.usage);
