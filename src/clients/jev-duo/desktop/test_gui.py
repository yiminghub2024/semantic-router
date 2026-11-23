"""Windows release smoke test. Install pywinauto, then pass the unpacked JevDuo.exe."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from ctypes import windll

from pywinauto import Application


def wait_for(predicate):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError("Timed out waiting for the desktop operation")


def click(window, text):
    button = window.child_window(title=text, control_type="Button").wrapper_object()
    # Asynchronous BM_CLICK also works when the handler opens a modal dialog.
    windll.user32.PostMessageW(button.handle, 0x00F5, 0, 0)


def select_language(window, index):
    picker = window.child_window(title="Language / 语言", control_type="ComboBox").wrapper_object().handle
    api = windll.user32
    api.SendMessageW(picker, 0x014E, index, 0)  # CB_SETCURSEL
    api.PostMessageW(api.GetParent(picker), 0x0111, (1 << 16) | (api.GetDlgCtrlID(picker) & 0xffff), picker)


def verify(executable, state):
    requests = []
    release_final_chunk = threading.Event()

    class Model(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append((self.path, self.headers.get("Authorization"), body, self.headers.get("X-Vsr-Debug")))
            self.send_response(200)
            if self.headers.get("X-Vsr-Debug") == "true":
                self.send_header("x-vsr-selected-decision", "code")
                self.send_header("x-vsr-trace", "algorithm=static")
            if body.get("stream"):
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                def emit(data):
                    self.wfile.write(("data: " + data + "\n\n").encode())
                    self.wfile.flush()
                emit(json.dumps({"choices":[{"delta":{"content":"首段抵达"}}]}))
                release_final_chunk.wait(18)
                emit(json.dumps({"choices":[{"delta":{"content":"，随后完成。"}}]}))
                emit("[DONE]")
                return
            self.end_headers()
            self.wfile.write(json.dumps({
                "model": "mock-writer", "choices": [{"message": {"content": "桌面回复"}}]
            }).encode())

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Model)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = dict(os.environ, JEV_SETTINGS_DIR=str(state / "profiles"), JEV_DATA_DIR=str(state / "archive"))
    processes = []

    def launch():
        process = subprocess.Popen([str(executable)], env=env)
        processes.append(process)
        app = Application(backend="uia").connect(process=process.pid, timeout=10)
        window = app.window(title="Jev Duo")
        window.wait("visible", timeout=12)
        wait_for(lambda: bool(window.descendants(control_type="ListItem")))
        return process, window

    try:
        process, window = launch()
        assert window.child_window(title="New chat",control_type="Button").exists()
        language_picker = window.child_window(title="Language / 语言",control_type="ComboBox")
        assert language_picker.selected_text() == "English"
        select_language(window, 1)
        wait_for(lambda: window.child_window(title="连接设置",control_type="Button").exists(timeout=0.1))
        click(window, "连接设置")
        settings = window.child_window(title_re="连接设置.*", control_type="Window")
        click(settings, "编辑模型")
        editor = window.child_window(title="编辑生成模型", control_type="Window")
        fields = {"模型 ID": "desktop-model", "Endpoint": f"http://127.0.0.1:{server.server_port}/v1",
                  "API Key": "test-secret-local"}
        for name, value in fields.items():
            editor.child_window(title=name, control_type="Edit").set_edit_text(value)
        click(editor, "确定")
        click(settings, "保存设置")
        vault = state / "profiles" / "profiles.dpapi"
        wait_for(vault.exists)
        assert b"test-secret-local" not in vault.read_bytes()
        window.close()
        process.wait(timeout=10)

        process, window = launch()
        window.child_window(title="提问", control_type="Edit").set_edit_text("桌面客户端测试")
        click(window, "发送")
        wait_for(lambda: window.child_window(title="已保存至本地会话", control_type="Text").exists(timeout=0.1))
        path, auth, request, debug = requests[0]
        assert debug is None and not request.get("stream")
        assert (path, auth) == ("/v1/chat/completions", "Bearer test-secret-local")
        assert request["model"] == "desktop-model"
        assert request["messages"] == [{"role": "user", "content": "桌面客户端测试"}]
        for option in ("流式输出", "显示选择原因"):
            checkbox = window.child_window(title=option, control_type="CheckBox")
            assert checkbox.get_toggle_state() == 0
            checkbox.toggle()
        window.child_window(title="提问", control_type="Edit").set_edit_text("流式测试")
        click(window, "发送")
        transcript = window.child_window(title="对话记录", control_type="Edit")
        wait_for(lambda: "首段抵达" in transcript.get_value())
        release_final_chunk.set()
        wait_for(lambda: "algorithm=static" in transcript.get_value())
        assert "首段抵达，随后完成。" in transcript.get_value()
        assert requests[-1][2]["stream"] and requests[-1][3] == "true"
        select_language(window, 0)
        wait_for(lambda: window.child_window(title="Send",control_type="Button").exists(timeout=0.1))
        assert "首段抵达，随后完成。" in window.child_window(title="Conversation history",control_type="Edit").get_value()
        window.close()
        process.wait(timeout=10)
    finally:
        release_final_chunk.set()
        for process in processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as directory:
        verify(Path(sys.argv[1]).resolve(), Path(directory))
    print("Windows desktop smoke test passed")
