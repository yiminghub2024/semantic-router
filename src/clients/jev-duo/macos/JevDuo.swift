import AppKit
import SwiftUI
import UniformTypeIdentifiers

@main
struct JevDuoApp: App {
    var body: some Scene {
        Window("Jev Duo", id: "chat") { ChatView() }
            .defaultSize(width: 1050, height: 700)
    }
}

private struct Answer: Decodable { let reply, model: String }

struct ChatView: View {
    @State private var profiles = Profile.presets
    @AppStorage("interfaceLanguage") private var language = "en"
    @AppStorage("backend") private var backend = "vllm"
    @AppStorage("stream") private var stream = false
    @AppStorage("showReason") private var reason = false
    @State private var judge = false
    @State private var route = ""
    @State private var sessions = [String]()
    @State private var selected = ""
    @State private var turns = [Turn]()
    @State private var prompt = ""
    @State private var files = [URL]()
    @State private var pending = ""
    @State private var active: UUID?
    @State private var loading = true
    @State private var showSettings = false
    @State private var canSaveProfiles = false
    @State private var error: String?
    private let bridge = Bridge()
    private var profile: Profile { profiles.first { $0.id == backend } ?? Profile.presets[0] }
    private var busy: Bool { active != nil }

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Jev Duo").font(.system(size: 25, weight: .semibold))
                Button { newSession() } label: { Label(ui("New chat"), systemImage: "square.and.pencil") }
                Text(ui("Recent chats")).font(.caption).foregroundStyle(.secondary)
                ScrollView {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(sessions, id: \.self) { id in
                            Button { switchSession(id) } label: {
                                Text(id).lineLimit(1).truncationMode(.middle)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(7)
                                    .background(selected == id ? Color.accentColor.opacity(0.15) : .clear,
                                                in: RoundedRectangle(cornerRadius: 6))
                            }.buttonStyle(.plain)
                        }
                    }
                }
                Picker("Language / 语言", selection: $language) {
                    Text("English").tag("en")
                    Text("简体中文").tag("zh-CN")
                }.labelsHidden().accessibilityLabel("Language / 语言")
            }.padding(16).frame(minWidth: 165, idealWidth: 205, maxWidth: 270)
                .disabled(busy || loading)
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Picker(ui("Service"), selection: $backend) {
                        ForEach(profiles) { p in Text(p.title).tag(p.id) }
                    }
                    Button(ui("Settings")) { showSettings = true }.disabled(!canSaveProfiles)
                }
                HStack {
                    Picker(ui("Mode"), selection: $judge) {
                        Text(ui("Chat")).tag(false); Text(ui("Yes/no decision")).tag(true)
                    }.frame(maxWidth: 190)
                    if !judge {
                        Picker(ui("Model"), selection: $route) {
                            Text(ui("Auto route")).tag("")
                            ForEach(profile.workers, id: \.alias) { w in Text(w.alias).tag(w.alias) }
                        }
                    }
                }
                Divider()
                ScrollViewReader { reader in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            ForEach(turns) { turn in
                                message(ui("You") + (turn.attachments.isEmpty ? "" : " · \(turn.attachments.count) " + ui("attachments")), turn.prompt)
                                message(turn.model, turn.reply)
                                if reason && turn.hasRouting != 0 {
                                    message(ui("Routing details") + (turn.decision.map { " · " + $0 } ?? ""), turn.trace ?? ui("No routing trace returned"))
                                }
                            }
                            if busy { message(ui("You"), prompt); message(ui("Responding"), pending.isEmpty ? ui("Waiting for the model…") : pending) }
                            Color.clear.frame(height: 1).id("bottom")
                        }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    }.onChange(of: pending) { _ in reader.scrollTo("bottom", anchor: .bottom) }
                        .onChange(of: turns.last?.id) { _ in reader.scrollTo("bottom", anchor: .bottom) }
                }
                HStack {
                    Button(ui("Add files")) { attach() }
                    if !files.isEmpty { Button(ui("Clear files")) { files = [] } }
                    Spacer()
                    Toggle(ui("Stream response"), isOn: $stream).disabled(judge)
                    Toggle(ui("Show routing reason"), isOn: $reason).disabled(judge || backend != "vllm")
                }
                if !files.isEmpty { Text(files.map(\.lastPathComponent).joined(separator: "、")).font(.caption) }
                TextEditor(text: $prompt).font(.body).frame(height: 78).padding(4)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(.secondary.opacity(0.35)))
                    .accessibilityLabel(ui("Message"))
                HStack { Spacer(); Button(ui("Send")) { Task { await send() } }
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(loading || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }.padding(20).frame(minWidth: 540).disabled(busy)
        }.frame(minWidth: 800, minHeight: 540)
        .environment(\.locale, Locale(identifier: language))
        .task {
            do { profiles = try ProfileStore.load(); canSaveProfiles = true }
            catch { self.error = error.localizedDescription }
            do {
                sessions = try await bridge.run(BridgeRequest(action: "sessions"), as: [String].self)
                if let first = sessions.first { switchSession(first) } else { newSession() }
            } catch { self.error = error.localizedDescription }
            loading = false
        }
        .onChange(of: backend) { _ in route = "" }
        .sheet(isPresented: $showSettings) {
            ConnectionSettings(draft: profile) { edited in
                let updated = profiles.map { $0.id == edited.id ? edited : $0 }
                try ProfileStore.save(updated); profiles = updated; route = ""
            }
        }
        .alert(ui("Operation failed"), isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button(ui("OK")) { error = nil }
        } message: { Text(error ?? "") }
    }

    private func message(_ label: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.caption.bold()).foregroundStyle(.secondary)
            Text(text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func attach() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = ["png","jpg","jpeg","webp","mp4","webm","mov","mkv"].compactMap { UTType(filenameExtension: $0) }
        if panel.runModal() == .OK { for url in panel.urls where !files.contains(url) { files.append(url) } }
    }

    private func newSession() {
        let stamp = Date.now.formatted(date: .abbreviated, time: .standard)
        var id = ui("Chat") + " " + stamp
        var n = 1
        while sessions.contains(id) { n += 1; id = ui("Chat") + " \(stamp) (\(n))" }
        sessions.insert(id, at: 0); switchSession(id)
    }
    @State private var historyVersion = UUID()
    private func switchSession(_ id: String) {
        selected = id; prompt = ""; files = []; turns = []
        let version = UUID(); historyVersion = version
        Task {
            do {
                let rows = try await bridge.run(BridgeRequest(action: "history", session: id), as: [Turn].self)
                if historyVersion == version { turns = rows }
            } catch { if historyVersion == version { self.error = error.localizedDescription } }
        }
    }

    @MainActor private func send() async {
        guard !busy, !selected.isEmpty else { return }
        if !judge && profile.workers.isEmpty { showSettings = canSaveProfiles; return }
        let id = UUID()
        active = id; pending = ""; historyVersion = UUID()
        defer { active = nil; pending = "" }
        do {
            let request = BridgeRequest(action: judge ? "judge" : "ask", session: selected,
                profile: profile.forRequest(), prompt: prompt, files: files.map(\.path),
                override: route.isEmpty ? nil : route, stream: !judge && stream,
                showReason: !judge && backend == "vllm" && reason)
            _ = try await bridge.run(request, as: Answer.self) { chunk in
                DispatchQueue.main.async { if active == id { pending += chunk } }
            }
            prompt = ""; files = []
            turns = try await bridge.run(BridgeRequest(action: "history", session: selected), as: [Turn].self)
        } catch { self.error = error.localizedDescription }
    }
}
