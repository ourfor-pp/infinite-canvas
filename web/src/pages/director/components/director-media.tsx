import { createElement, useState, type ComponentProps } from "react";
import { serverFileIdFromUrl } from "@/services/api/server";
import { useDeferredDirectorValue } from "../use-director-sync";

export function DirectorMedia({ kind = "video", mediaKey, ...props }: ComponentProps<"video"> & { kind?: "audio" | "video"; mediaKey?: string }) {
    const [playing, setPlaying] = useState(false);
    const source = useDeferredDirectorValue(mediaKey || serverFileIdFromUrl(props.src || "") || "", props.src, playing);
    return <>{createElement(kind, { ...props, src: source.value, onPlay: (event: React.SyntheticEvent<HTMLVideoElement>) => { setPlaying(true); props.onPlay?.(event); }, onPause: (event: React.SyntheticEvent<HTMLVideoElement>) => { setPlaying(false); props.onPause?.(event); }, onEnded: (event: React.SyntheticEvent<HTMLVideoElement>) => { setPlaying(false); props.onEnded?.(event); } })}{source.pending ? <span role="status" className={kind === "video" ? "absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 text-xs text-blue-700" : "mt-1 block text-xs text-blue-700"}>媒体已更新，暂停后切换到新版本</span> : null}</>;
}
