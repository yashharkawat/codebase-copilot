/**
 * BM25 with a tokenizer built for source code: `getCookieValue`, `get_cookie_value` and
 * `GET_COOKIE` all yield get / cookie / value, plus the whole identifier for exact matches.
 */
const STOPWORDS = new Set(
  "a an and are as at be by can do does for from how i if in into is it its of on or that the this to what when where which who why will with code function method class implemented implementation logic file find show me".split(" "),
);

export function tokenize(text: string, dropStopwords = false): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[A-Za-z_][A-Za-z0-9_]*|[0-9]+/g) ?? []) {
    const whole = raw.toLowerCase();
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_]+/)
      .map((p) => p.toLowerCase())
      .filter((p) => p.length > 1);
    if (parts.length > 1 && whole.length <= 40) out.push(whole.replace(/_/g, ""));
    out.push(...parts);
  }
  const stemmed = out.map(stem);
  return dropStopwords ? stemmed.filter((t) => !STOPWORDS.has(t)) : stemmed;
}

/** Light suffix stripping so "routes"/"routing"/"routed" meet "route". Deliberately conservative. */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export interface Bm25Doc {
  text: string;
  /** Extra text (symbol name, file path) counted with a boost */
  boosted?: string;
}

export class Bm25Index {
  private readonly postings = new Map<string, Array<[number, number]>>();
  private readonly docLen: Float32Array;
  private readonly avgLen: number;
  private readonly n: number;

  constructor(docs: Bm25Doc[], private readonly k1 = 1.2, private readonly b = 0.75, boost = 3) {
    this.n = docs.length;
    this.docLen = new Float32Array(docs.length);
    let total = 0;
    docs.forEach((doc, i) => {
      const tf = new Map<string, number>();
      for (const t of tokenize(doc.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
      if (doc.boosted) for (const t of tokenize(doc.boosted)) tf.set(t, (tf.get(t) ?? 0) + boost);
      let len = 0;
      for (const [term, f] of tf) {
        len += f;
        let list = this.postings.get(term);
        if (!list) this.postings.set(term, (list = []));
        list.push([i, f]);
      }
      this.docLen[i] = len;
      total += len;
    });
    this.avgLen = total / Math.max(1, docs.length);
  }

  /** Returns [docIndex, score] sorted by score, best first. */
  search(query: string, limit: number, allow?: (doc: number) => boolean): Array<[number, number]> {
    const scores = new Map<number, number>();
    for (const term of new Set(tokenize(query, true))) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = Math.log(1 + (this.n - list.length + 0.5) / (list.length + 0.5));
      for (const [doc, f] of list) {
        if (allow && !allow(doc)) continue;
        const norm = f + this.k1 * (1 - this.b + (this.b * this.docLen[doc]) / this.avgLen);
        scores.set(doc, (scores.get(doc) ?? 0) + idf * ((f * (this.k1 + 1)) / norm));
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }
}
