import { norm } from "../text.js";

/**
 * Tech vocabulary for local keyword extraction (no paid AI). Each entry is a
 * canonical term plus regex aliases. Order breaks ties, so put core backend
 * terms first.
 */
const VOCAB: [string, RegExp][] = [
  ["java", /\bjava\b(?!\s*script)/],
  ["python", /\bpython\b/],
  ["node.js", /\bnode(\.?js)?\b/],
  ["typescript", /\btypescript\b|\bts\b/],
  ["javascript", /\bjavascript\b|\bjs\b/],
  ["go", /\bgolang\b|\bgo\b(?=[\s,/)]+(lang|language|programming|developer|services|microservices|,|\/))/],
  ["c++", /\bc\+\+|\bcpp\b/],
  ["c#", /\bc#|\.net\b|\bdotnet\b/],
  ["rust", /\brust\b/],
  ["kotlin", /\bkotlin\b/],
  ["scala", /\bscala\b/],
  ["sql", /\bsql\b/],
  ["mysql", /\bmysql\b/],
  ["postgresql", /\bpostgres(ql)?\b/],
  ["nosql", /\bnosql\b/],
  ["mongodb", /\bmongo(db)?\b/],
  ["redis", /\bredis\b/],
  ["cassandra", /\bcassandra\b/],
  ["dynamodb", /\bdynamo(db)?\b/],
  ["firestore", /\bfirestore\b/],
  ["firebase", /\bfirebase\b/],
  ["kafka", /\bkafka\b/],
  ["rabbitmq", /\brabbitmq\b/],
  ["rest", /\brest(ful)?\b(\s*api)?/],
  ["graphql", /\bgraphql\b/],
  ["grpc", /\bgrpc\b/],
  ["microservices", /\bmicro-?services?\b/],
  ["distributed systems", /\bdistributed systems?\b/],
  ["system design", /\bsystem design\b|\bsystems design\b/],
  ["data structures", /\bdata structures?\b/],
  ["algorithms", /\balgorithms?\b/],
  ["oop", /\bobject[- ]oriented\b|\boop\b/],
  ["spring", /\bspring( boot)?\b/],
  ["express", /\bexpress(\.js)?\b/],
  ["fastapi", /\bfastapi\b/],
  ["flask", /\bflask\b/],
  ["django", /\bdjango\b/],
  ["react", /\breact(\.js)?\b/],
  ["docker", /\bdocker\b/],
  ["kubernetes", /\bkubernetes\b|\bk8s\b/],
  ["aws", /\baws\b|\bamazon web services\b/],
  ["gcp", /\bgcp\b|\bgoogle cloud\b/],
  ["azure", /\bazure\b/],
  ["linux", /\blinux\b|\bunix\b/],
  ["git", /\bgit\b/],
  ["ci/cd", /\bci\s*\/\s*cd\b|\bcontinuous (integration|delivery|deployment)\b/],
  ["terraform", /\bterraform\b/],
  ["oauth", /\boauth2?\b/],
  ["webhooks", /\bwebhooks?\b/],
  ["idempotency", /\bidempoten(t|cy)\b/],
  ["caching", /\bcach(e|ing)\b/],
  ["observability", /\bobservability\b|\bmonitoring\b/],
  ["security", /\bsecurity\b/],
  ["testing", /\bunit test(s|ing)?\b|\btest[- ]driven\b/],
  ["agile", /\bagile\b|\bscrum\b/],
  ["llm", /\bllms?\b|\bgenai\b|\bgenerative ai\b/],
  ["machine learning", /\bmachine learning\b|\bml\b/],
  ["html", /\bhtml5?\b/],
  ["css", /\bcss3?\b/],
  ["c", /\bc\b(?![+#])(?=[\s,/)]+(\+\+|programming|language|,|\/|and|or))/],
];

const ALIAS_INDEX = new Map(VOCAB.map(([term, re]) => [term, re]));

/** Canonicalize a resume skill to the vocab term when possible. */
function canonical(skill: string): string {
  const s = norm(skill);
  for (const [term, re] of VOCAB) if (term === s || re.test(s)) return term;
  return s;
}

/** Profile skills that appear in the text (canonical names, vocab order). */
export function skillHits(text: string, skills: string[]): string[] {
  const t = norm(text);
  const out: string[] = [];
  for (const sk of skills) {
    const term = canonical(sk);
    const re = ALIAS_INDEX.get(term) ?? new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(t) && !out.includes(term)) out.push(term);
  }
  return out;
}

/** Top-N job keywords by frequency, each marked on/off resume. */
export function topKeywords(text: string, skills: string[], n = 5): { term: string; onResume: boolean }[] {
  const t = norm(text);
  const resume = new Set(skills.map(canonical));
  const counts: { term: string; count: number; order: number }[] = [];
  VOCAB.forEach(([term, re], order) => {
    const g = new RegExp(re.source, "g");
    const count = t.match(g)?.length ?? 0;
    if (count) counts.push({ term, count, order });
  });
  counts.sort((a, b) => b.count - a.count || a.order - b.order);
  return counts.slice(0, n).map(({ term }) => ({ term, onResume: resume.has(term) }));
}
