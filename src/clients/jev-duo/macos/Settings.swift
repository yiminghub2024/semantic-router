import SwiftUI

struct ConnectionSettings: View {
    @Environment(\.dismiss) private var dismiss
    @State var draft: Profile
    let save: (Profile) throws -> Void
    @State private var selected = -1
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(ui("Settings") + " · " + draft.title).font(.title2.bold())
            HStack {
                Picker(ui("Service settings"), selection: $selected) {
                    Text(ui("Decision service")).tag(-1)
                    ForEach(draft.workers.indices, id: \.self) { i in
                        Text(draft.workers[i].alias.isEmpty ? ui("New generation model") : draft.workers[i].alias).tag(i)
                    }
                }
                Button(ui("Add model")) {
                    draft.workers.append(Endpoint(alias: "model-\(draft.workers.count + 1)"))
                    selected = draft.workers.count - 1
                }
                Button(ui("Remove model")) {
                    let old = selected
                    selected = -1
                    draft.workers.remove(at: old)
                }.disabled(selected < 0)
            }
            Divider()
            if draft.workers.indices.contains(selected) {
                EndpointFields(endpoint: $draft.workers[selected], worker: true, local: false)
            } else {
                EndpointFields(endpoint: $draft.decision, worker: false, local: draft.id == "local")
            }
            Spacer()
            if !error.isEmpty { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Text(ui("Connection settings are stored in this Mac’s keychain.")).foregroundStyle(.secondary)
                Spacer()
                Button(ui("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(ui("Save settings")) {
                    do { try draft.validate(); try save(draft); dismiss() }
                    catch { self.error = error.localizedDescription }
                }.keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 630, height: 510)
    }
}

struct EndpointFields: View {
    @Binding var endpoint: Endpoint
    let worker: Bool
    let local: Bool
    private func mode(_ name: String) -> Binding<Bool> {
        Binding(get: { endpoint.inputs.contains(name) }, set: { on in
            endpoint.inputs.removeAll { $0 == name }
            if on { endpoint.inputs.append(name) }
        })
    }
    var body: some View {
        Form {
            if worker { TextField(ui("Model alias"), text: $endpoint.alias) }
            TextField(ui("Model ID"), text: $endpoint.model)
            TextField("Endpoint", text: $endpoint.baseUrl, prompt: Text("http://127.0.0.1:8000/v1"))
            SecureField("API Key", text: $endpoint.apiKey)
            if local {
                Picker(ui("Decision protocol"), selection: $endpoint.protocolName) {
                    Text("System One").tag("systemone")
                    Text("Chat Completions").tag("chat")
                }
            }
            if worker {
                TextField(ui("Routing description"), text: $endpoint.description)
                HStack { Toggle(ui("Images"), isOn: mode("image")); Toggle(ui("Video"), isOn: mode("video")) }
                TextField(ui("Text budget (bytes)"), value: $endpoint.textBudgetBytes, format: .number)
                Text(ui("Leave the key blank to reuse the decision key for the same endpoint.")).font(.caption).foregroundStyle(.secondary)
            }
        }.textFieldStyle(.roundedBorder)
    }
}
