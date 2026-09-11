import { useEffect, useState } from "react";
import { replaceEqualDeep } from "@tanstack/react-query";
import { useDirectorStore } from "@/stores/use-director-store";
import { serverApiUrl, serverFileIdFromUrl } from "@/services/api/server";
import type { DirectorResource } from "@/types/director-sync";
import type { WorkspaceImagePreviewItem } from "@/components/workspace-image-preview-lightbox";

export const useDirectorResourceVersion = (projectId: string, resource: DirectorResource) => useDirectorStore((store) => store.data[projectId]?.epochs[resource] || 0);


export function directorMediaUrl(fileId: string | undefined, fallbackVersion?: number) {
    if (!fileId) return "";
    const data = Object.values(useDirectorStore.getState().data);
    const version = data.find((project) => project.mediaVersions?.[fileId])?.mediaVersions?.[fileId];
    return serverApiUrl(`/files/${encodeURIComponent(fileId)}/content${version ? `?v=${version}` : fallbackVersion ? `?revision=${fallbackVersion}` : ""}`);
}

export function currentDirectorPreviewItems(items: WorkspaceImagePreviewItem[]) {
    const projects = Object.values(useDirectorStore.getState().data);
    return items.flatMap((item) => {
        const fileId = serverFileIdFromUrl(item.url);
        if (!fileId) return [item];
        if (fileId.startsWith("director-") && !projects.some((project) => project.mediaVersions?.[fileId])) return [];
        const asset = projects.flatMap((project) => project.assets || []).find((asset) => asset.payload.variants.some((variant) => variant.fileId === fileId));
        return [{ ...item, url: directorMediaUrl(fileId), alt: asset ? `${asset.name} · ${asset.payload.variants.find((variant) => variant.fileId === fileId)?.label || "素材图片"}` : item.alt }];
    });
}

export function useDeferredDirectorValue<T>(identity: string, value: T, playing: boolean) {
    const [shown, setShown] = useState({ identity, value });
    const current = shown.identity === identity ? shown.value : value;
    useEffect(() => {
        if (playing && shown.identity === identity && value) return;
        setShown((previous) => { const next = replaceEqualDeep(previous.value, value); return previous.identity === identity && next === previous.value ? previous : { identity, value: next }; });
    }, [identity, value, playing, shown.identity]);
    return { value: current, pending: shown.identity === identity && replaceEqualDeep(current, value) !== current };
}
