import type { VisualStyleMediumFamily, VisualStyleTemplate } from "@/types/visual-style";

export function filterVisualStyleTemplates(templates: VisualStyleTemplate[], mediumFamily: "all" | VisualStyleMediumFamily, query: string) {
    const keyword = query.trim().toLowerCase();
    return templates.filter((item) => {
        if (mediumFamily !== "all" && item.dna.mediumFamily !== mediumFamily) return false;
        if (!keyword) return true;
        const dna = Object.values(item.dna).flat().join(" ");
        return `${item.name} ${item.tagline} ${item.description} ${item.tags.join(" ")} ${dna}`.toLowerCase().includes(keyword);
    });
}
