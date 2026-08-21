import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function ScrollArea({ className, viewportClassName, children, orientation = "vertical", ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & { orientation?: "vertical" | "horizontal"; viewportClassName?: string }) {
    return (
        <ScrollAreaPrimitive.Root type="hover" className={cn("relative overflow-hidden", className)} {...props}>
            <ScrollAreaPrimitive.Viewport className={cn("size-full rounded-[inherit]", viewportClassName)}>{children}</ScrollAreaPrimitive.Viewport>
            <ScrollAreaPrimitive.Scrollbar
                orientation={orientation}
                className={cn(
                    "z-10 flex touch-none select-none bg-transparent opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100",
                    orientation === "vertical" ? "h-full w-1.5 p-px" : "h-1.5 flex-col p-px",
                )}
            >
                <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-slate-400/55 transition-colors hover:bg-slate-500/70" />
            </ScrollAreaPrimitive.Scrollbar>
            <ScrollAreaPrimitive.Corner className="bg-transparent" />
        </ScrollAreaPrimitive.Root>
    );
}

export { ScrollArea };
