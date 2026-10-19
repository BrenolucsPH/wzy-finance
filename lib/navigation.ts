import { z } from "zod";
export const navigationLabels = [
  "Visão geral",
  "Transações",
  "Contas recorrentes",
  "Assinaturas em grupo",
  "Contas e cartões",
  "Orçamentos",
  "Metas",
  "Dívidas",
  "Relatórios",
  "Arquivos",
  "Planejamento",
  "Conciliação",
  "Inteligência",
  "Moedas e parcelas",
  "Privacidade e offline",
] as const;
export type NavigationLabel = (typeof navigationLabels)[number];
export function navigationGroup(label: string) {
  if (
    [
      "Visão geral",
      "Transações",
      "Contas e cartões",
      "Contas recorrentes",
      "Dívidas",
      "Assinaturas em grupo",
    ].includes(label)
  )
    return "DIA A DIA";
  if (["Planejamento", "Orçamentos", "Metas"].includes(label))
    return "PLANEJAR";
  if (["Relatórios", "Inteligência"].includes(label)) return "ENTENDER";
  return "FERRAMENTAS";
}
const groupOrder = ["DIA A DIA", "PLANEJAR", "ENTENDER", "FERRAMENTAS"];
const defaultOrder = [...navigationLabels].sort(
  (a, b) =>
    groupOrder.indexOf(navigationGroup(a)) -
    groupOrder.indexOf(navigationGroup(b)),
);
export type NavigationPreferences = {
  sidebarOrder: NavigationLabel[];
  sidebarPinned: NavigationLabel[];
  guideDismissed: boolean;
};
const unique = (items: string[]) => new Set(items).size === items.length;
export const navigationPreferenceSchema = z.object({
  sidebarOrder: z
    .array(z.enum(navigationLabels))
    .length(navigationLabels.length)
    .refine(unique)
    .optional(),
  sidebarPinned: z
    .array(z.enum(navigationLabels))
    .max(4)
    .refine(unique)
    .optional(),
  guideDismissed: z.boolean().optional(),
});
export function normalizeNavigation(value: unknown): NavigationPreferences {
  const p =
    value && typeof value === "object"
      ? (value as Partial<NavigationPreferences>)
      : {};
  const legacyDefault =
    Array.isArray(p.sidebarOrder) &&
    p.sidebarOrder.length === navigationLabels.length &&
    p.sidebarOrder.every((label, index) => label === navigationLabels[index]);
  const order =
    Array.isArray(p.sidebarOrder) && !legacyDefault
      ? p.sidebarOrder.filter((s): s is NavigationLabel =>
          navigationLabels.includes(s),
        )
      : [];
  return {
    sidebarOrder: [...new Set([...order, ...defaultOrder])],
    sidebarPinned: Array.isArray(p.sidebarPinned)
      ? [
          ...new Set(
            p.sidebarPinned.filter((s): s is NavigationLabel =>
              navigationLabels.includes(s),
            ),
          ),
        ].slice(0, 4)
      : [],
    guideDismissed: p.guideDismissed === true,
  };
}
