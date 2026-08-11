import { App } from "antd";
import { useCallback } from "react";

import { useUserStore } from "@/stores/use-user-store";

export function useMissingModelNotice() {
    const { message } = App.useApp();
    const isAdmin = useUserStore((state) => state.user?.isAdmin);
    return useCallback((_shouldContinue?: boolean) => {
        message.warning(isAdmin ? "请先在管理员配置中启用对应类型的模型" : "管理员尚未配置对应类型的模型");
    }, [isAdmin, message]);
}
