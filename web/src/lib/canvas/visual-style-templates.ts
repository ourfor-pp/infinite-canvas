import type { VisualStyleTemplate, VisualStyleTemplateCategory } from "@/types/visual-style";

export function filterVisualStyleTemplates(templates: VisualStyleTemplate[], category: "all" | VisualStyleTemplateCategory, query: string) {
    const keyword = query.trim().toLowerCase();
    return templates.filter((item) => (category === "all" || item.category === category) && (!keyword || `${item.name} ${item.tagline} ${item.description}`.toLowerCase().includes(keyword)));
}
