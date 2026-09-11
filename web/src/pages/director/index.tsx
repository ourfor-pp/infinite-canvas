import { useEffect } from "react";
import { App, Button, ConfigProvider, Popconfirm, Spin, theme as antdTheme } from "antd";
import { Clapperboard, Film, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDirectorStore } from "@/stores/use-director-store";
import "./director-light.css";

export default function DirectorPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const projects = useDirectorStore((state) => state.projects);
    const loading = useDirectorStore((state) => state.loading);
    const loadProjects = useDirectorStore((state) => state.loadProjects);
    const createProject = useDirectorStore((state) => state.createProject);
    const deleteProject = useDirectorStore((state) => state.deleteProject);
    useEffect(() => { void loadProjects().catch((error) => message.error(error instanceof Error ? error.message : "导演项目加载失败")); return useDirectorStore.getState().watchProjects(); }, [loadProjects, message]);
    const create = async () => {
        try { const project = await createProject(`未命名长片 ${projects.length + 1}`); navigate(`/director/${project.id}/overview`); }
        catch (error) { message.error(error instanceof Error ? error.message : "创建失败"); }
    };

    return (
        <ConfigProvider theme={{ algorithm: antdTheme.defaultAlgorithm }}>
        <main className="director-light h-full overflow-auto bg-[#0a0a0b] text-[#eee9df]">
            <div className="mx-auto min-h-full max-w-7xl px-6 py-12 lg:px-10">
                <header className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
                    <div>
                        <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[.28em] text-amber-400/75"><Film className="size-4" /> Director's room</div>
                        <h1 className="font-serif text-4xl tracking-tight">导演台</h1>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-white/45">从长篇故事到完整成片。每个项目拥有独立的剧本、资产、分镜与声音时间线。</p>
                    </div>
                    <Button className="!h-10 !border-amber-300/30 !bg-amber-300 !px-5 !text-black hover:!bg-amber-200" icon={<Plus className="size-4" />} onClick={() => void create()}>新建长片</Button>
                </header>
                {loading ? <div className="grid min-h-96 place-items-center"><Spin /></div> : projects.length ? (
                    <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project, index) => (
                            <article key={project.id} className="group relative min-h-60 cursor-pointer overflow-hidden border border-white/10 bg-[#111113] p-6 transition hover:-translate-y-0.5 hover:border-amber-300/30" onClick={() => navigate(`/director/${project.id}/overview`)}>
                                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/50 to-transparent opacity-0 transition group-hover:opacity-100" />
                                <div className="flex items-start justify-between"><span className="font-mono text-xs text-white/25">FILM {String(index + 1).padStart(2, "0")}</span><Clapperboard className="size-5 text-amber-300/60" /></div>
                                <h2 className="mt-14 font-serif text-2xl">{project.title}</h2>
                                <p className="mt-3 text-xs text-white/35">最后更新 {new Date(project.updatedAt).toLocaleString("zh-CN")}</p>
                                <div className="absolute inset-x-6 bottom-5 flex items-end justify-between border-t border-white/8 pt-4 text-xs text-white/35">
                                    <span>长视频 · 独立项目</span>
                                    <Popconfirm title="删除这个导演项目？" description="剧本、资产、分镜与文件引用会一并删除。" okText="删除" cancelText="取消" onConfirm={() => void deleteProject(project.id).catch((error) => message.error(error instanceof Error ? error.message : "删除失败"))}>
                                        <button className="grid size-8 place-items-center text-white/30 transition hover:text-red-300" onClick={(event) => event.stopPropagation()} aria-label="删除项目"><Trash2 className="size-4" /></button>
                                    </Popconfirm>
                                </div>
                            </article>
                        ))}
                    </section>
                ) : (
                    <section className="grid min-h-[460px] place-items-center border-b border-white/10 text-center">
                        <div><Clapperboard className="mx-auto size-8 text-amber-300/55" /><h2 className="mt-5 font-serif text-2xl">第一部片，从这里开机</h2><p className="mt-3 text-sm text-white/40">上传小说，或直接和 Agent 对话建立故事。</p><Button className="mt-6 !border-white/15 !bg-white/5 !text-white" onClick={() => void create()}>建立导演项目</Button></div>
                    </section>
                )}
            </div>
        </main>
        </ConfigProvider>
    );
}
