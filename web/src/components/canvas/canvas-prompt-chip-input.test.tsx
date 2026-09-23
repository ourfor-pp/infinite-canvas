import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";

afterEach(cleanup);
it("输入法组词立即隐藏提示，取消恢复，确认与清空保持正确", () => {
    const changed = vi.fn();
    function Editor() {
        const [value, setValue] = useState("");
        return <CanvasPromptChipInput value={value} references={[]} placeholder="描述要生成的视频内容" onChange={(next) => { changed(next); setValue(next); }} />;
    }
    render(<Editor />);
    const editor = screen.getByRole("textbox");
    expect(screen.queryByText("描述要生成的视频内容")).not.toBeNull();
    fireEvent.compositionStart(editor);
    expect(screen.queryByText("描述要生成的视频内容")).toBeNull();
    editor.textContent = "zuo";
    fireEvent.input(editor, { isComposing: true });
    expect(changed).not.toHaveBeenCalled();
    editor.textContent = "";
    fireEvent.compositionEnd(editor, { data: "" });
    expect(screen.queryByText("描述要生成的视频内容")).not.toBeNull();
    fireEvent.compositionStart(editor);
    editor.textContent = "做";
    fireEvent.compositionEnd(editor, { data: "做" });
    expect(changed).toHaveBeenLastCalledWith("做");
    expect(screen.queryByText("描述要生成的视频内容")).toBeNull();
    editor.textContent = "";
    fireEvent.input(editor);
    expect(screen.queryByText("描述要生成的视频内容")).not.toBeNull();
});
