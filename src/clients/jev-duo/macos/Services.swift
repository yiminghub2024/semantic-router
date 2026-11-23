import Foundation
import Security

struct InterfaceStrings {
    let chinese: [String:String]
    init(resources: URL) {
        let file = resources.appendingPathComponent("src/ui.zh-CN.json")
        chinese = (try? JSONDecoder().decode([String:String].self, from: Data(contentsOf: file))) ?? [:]
    }
    func text(_ english: String, language: String?) -> String {
        language == "zh-CN" ? (chinese[english] ?? english) : english
    }
}
private let interfaceStrings = InterfaceStrings(resources: Bundle.main.resourceURL!)

func ui(_ english: String) -> String {
    interfaceStrings.text(english, language: UserDefaults.standard.string(forKey: "interfaceLanguage"))
}

struct ClientError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct Endpoint: Codable {
    var alias = ""
    var model = ""
    var baseUrl = "http://127.0.0.1:8000/v1"
    var apiKey = ""
    var description = ""
    var protocolName = "systemone"
    var inputs = ["text"]
    var textBudgetBytes = 16000

    enum CodingKeys: String, CodingKey {
        case alias, model, baseUrl, apiKey, description, inputs, textBudgetBytes
        case protocolName = "protocol"
    }

    func validate() throws {
        guard !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let url = URLComponents(string: baseUrl), let host = url.host, !host.isEmpty,
              ["http", "https"].contains(url.scheme), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else {
            throw ClientError(ui("Enter a model ID and a valid HTTP(S) API base URL."))
        }
    }
}

struct Profile: Codable, Identifiable {
    var id: String
    var decision: Endpoint
    var workers: [Endpoint]
    var title: String {
        switch id { case "vllm": return "vLLM · System Duo"; case "typesafe": return "TypeSafe Jev"; default: return ui("Local decision model") }
    }
    static let presets: [Profile] = {
        let duo = "https://app.vllm-sr.ai/v1"
        return [
            Profile(id: "vllm", decision: Endpoint(model: "vllm-sr/d3-flash", baseUrl: duo),
                    workers: [Endpoint(alias: "auto", model: "vllm-sr/auto", baseUrl: duo,
                                       description: "System Duo", inputs: ["text","image"], textBudgetBytes: 64000)]),
            Profile(id: "typesafe", decision: Endpoint(model: "jev-latest", baseUrl: "https://api.typesafe.ai/v1"), workers: []),
            Profile(id: "local", decision: Endpoint(model: "kev-latest", baseUrl: "http://127.0.0.1:8009/v1"), workers: [])
        ]
    }()

    func validate() throws {
        try decision.validate()
        var aliases = Set<String>()
        for worker in workers {
            try worker.validate()
            guard !worker.alias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  aliases.insert(worker.alias).inserted, worker.textBudgetBytes >= 512 else {
                throw ClientError(ui("Each model needs a unique alias and a text budget of at least 512 bytes."))
            }
        }
    }
    func forRequest() -> Profile {
        var result = self
        for i in result.workers.indices where result.workers[i].apiKey.isEmpty &&
            result.workers[i].baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ==
            decision.baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) {
            result.workers[i].apiKey = decision.apiKey
        }
        return result
    }
}

// Store credentials and their associated endpoint together in the login keychain.
enum ProfileStore {
    static let item: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "io.github.yiminghub2024.jev-duo", kSecAttrAccount as String: "profiles-v1"]
    static func load() throws -> [Profile] {
        var query = item
        query[kSecReturnData as String] = true
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecItemNotFound { return Profile.presets }
        guard status == errSecSuccess, let data = out as? Data else { throw keyError(status) }
        return try JSONDecoder().decode([Profile].self, from: data)
    }
    static func save(_ profiles: [Profile]) throws {
        let data = try JSONEncoder().encode(profiles)
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(item as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var create = item
            create[kSecValueData as String] = data
            create[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(create as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw keyError(status) }
    }
    static func keyError(_ status: OSStatus) -> ClientError {
        ClientError(ui("Keychain error") + " (\(status))")
    }
}

struct Turn: Decodable, Identifiable {
    let seq: Int
    var id: Int { seq }
    let prompt, reply, model: String
    let decision, trace: String?
    let hasRouting: Int
    let attachments: [[String:String]]
}

struct BridgeRequest: Encodable {
    var action: String
    var language: String? = UserDefaults.standard.string(forKey: "interfaceLanguage") ?? "en"
    var session: String?
    var profile: Profile?
    var prompt: String?
    var files: [String]?
    var override: String?
    var stream: Bool?
    var showReason: Bool?
}

struct Bridge {
    let resources: URL
    init(_ resources: URL = Bundle.main.resourceURL!) { self.resources = resources }
    func run<T: Decodable>(_ request: BridgeRequest, as type: T.Type,
                           delta: @escaping (String) -> Void = { _ in }) async throws -> T {
        let payload = try JSONEncoder().encode(request)
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let process = Process()
                    process.executableURL = resources.appendingPathComponent("../MacOS/node")
                    process.arguments = [resources.appendingPathComponent("desktop/bridge.mjs").path]
                    let input = Pipe(), output = Pipe()
                    process.standardInput = input
                    process.standardOutput = output
                    process.standardError = FileHandle.nullDevice
                    try process.run()
                    defer { if process.isRunning { process.terminate() } }
                    try input.fileHandleForWriting.write(contentsOf: payload)
                    try input.fileHandleForWriting.close()
                    var buffer = Data()
                    var result: T?
                    while true {
                        let bytes = output.fileHandleForReading.availableData
                        if bytes.isEmpty { break }
                        buffer.append(bytes)
                        while let end = buffer.firstIndex(of: 10) {
                            let line = Data(buffer[..<end])
                            buffer.removeSubrange(...end)
                            let frame = try JSONDecoder().decode(Frame<T>.self, from: line)
                            if let error = frame.error { throw ClientError(error) }
                            if let text = frame.delta { delta(text) }
                            if let value = frame.value { result = value }
                        }
                    }
                    process.waitUntilExit()
                    guard process.terminationStatus == 0, let result else { throw ClientError(ui("Local inference process exited unexpectedly.")) }
                    continuation.resume(returning: result)
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    private struct Frame<T: Decodable>: Decodable {
        let value: T?
        let delta, error: String?
    }
}
