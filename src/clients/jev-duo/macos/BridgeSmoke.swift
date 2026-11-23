import AppKit
import CoreGraphics

@main
struct Smoke {
    struct Reply: Decodable { let reply: String }
    static func main() async throws {
        let args = CommandLine.arguments
        let resources = URL(fileURLWithPath: args[1])
        let bridge = Bridge(resources)
        let strings = InterfaceStrings(resources: resources)
        precondition(strings.text("Settings", language: nil) == "Settings")
        precondition(strings.text("Settings", language: "zh-CN") == "连接设置")
        precondition(strings.text("Settings", language: "en") == "Settings")
        let worker = Endpoint(alias: "writer", model: "worker", baseUrl: args[2], apiKey: "fixture")
        let p = Profile(id: "vllm", decision: worker, workers: [worker])
        try p.validate()
        var pieces = [String]()
        let request = BridgeRequest(action: "ask", session: "smoke", profile: p, prompt: "测试",
                                    stream: true, showReason: true)
        let answer = try await bridge.run(request, as: Reply.self) { pieces.append($0) }
        precondition(pieces == ["第一段", "第二段"] && answer.reply == pieces.joined())
        let sessions = try await bridge.run(BridgeRequest(action: "sessions"), as: [String].self)
        precondition(sessions == ["smoke"])
        let history = try await bridge.run(BridgeRequest(action: "history", session: "smoke"), as: [Turn].self)
        precondition(history.count == 1 && history[0].model == "pool-model")
        precondition(history[0].trace == "algorithm=static")
        // Verify that launching the shipping executable opens a regular application window.
        let process = Process()
        process.executableURL = resources.appendingPathComponent("../MacOS/JevDuo")
        try process.run()
        defer { if process.isRunning { process.terminate(); process.waitUntilExit() } }
        for _ in 0..<50 {
            let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String:Any]] ?? []
            if windows.contains(where: {
                ($0[kCGWindowOwnerPID as String] as? Int32) == process.processIdentifier &&
                ($0[kCGWindowLayer as String] as? Int) == 0
            }) { print("Native window and packaged bridge verified"); return }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        throw ClientError("The packaged application did not open a window.")
    }
}
