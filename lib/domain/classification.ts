export type ClassificationRule = {
  term: string;
  category: string;
  subcategory?: string;
};
const normalized = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
export function classify(name: string, rules: ClassificationRule[]) {
  const candidate = normalized(name),
    rule = rules.find((r) => candidate.includes(normalized(r.term)));
  return rule
    ? { category: rule.category, subcategory: rule.subcategory || "" }
    : null;
}
