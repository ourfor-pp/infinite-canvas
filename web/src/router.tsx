import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";
import AudioPage from "@/pages/audio";
import AdminAiPage from "@/pages/admin/ai";

const DirectorPage = lazy(() => import("@/pages/director"));
const DirectorProjectPage = lazy(() => import("@/pages/director/project"));
const deferred = (element: ReactNode) => <Suspense fallback={<div className="grid h-full place-items-center bg-[#09090a] text-sm text-white/40">正在进入导演台…</div>}>{element}</Suspense>;

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/audio", element: <AudioPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/director", element: deferred(<DirectorPage />) },
            { path: "/director/:id/:section?", element: deferred(<DirectorProjectPage />) },
            { path: "/admin/ai", element: <AdminAiPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
], { basename: import.meta.env.BASE_URL });
