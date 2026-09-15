#if os(iOS) && canImport(WebRTC)
import Foundation
import RuimtePulsar
@preconcurrency import WebRTC

@MainActor public final class NativeWebRTCLink: NSObject, MachineLink {
    private static let factory = RTCPeerConnectionFactory()
    private let machineID: String
    private let machineKey: String
    private let signer: any SessionSigner
    private let ownIce: [JSONValue]
    private let relayOnly: Bool
    private let access: (() async throws -> JSONValue)?
    private let events: LinkEvents
    private let connectionID: String
    private let scheduler: any TransportScheduling
    private var membership: BrokerMembership?
    private var peer: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var relayIDs = Set<String>()
    private var assembler = FrameAssembler()
    private var liveness: ChannelLiveness?
    private var receivedBytes: Double?
    private var relayed: Bool?
    private var sampling = false
    private var authenticated = false
    private var proofSent = false
    private var ended = false
    private var negotiationStarted = false
    private var offerSDP: String?
    private var binding: String?
    private var cancelTimeout: (() -> Void)?
    private var cancelGather: (() -> Void)?
    private var cancelTick: (() -> Void)?
    private var gatherDone: (() -> Void)?
    private var candidates = PendingIceCandidates()
    private var accessTask: Task<Void, Never>?

    public init(machineID: String, machineKey: String, signer: any SessionSigner, brokerURL: URL, sockets: BrokerSockets, iceServers: [JSONValue], relayOnly: Bool = false, access: (() async throws -> JSONValue)? = nil, scheduler: any TransportScheduling = TaskTransportScheduler(), events: LinkEvents) throws {
        self.machineID = machineID
        self.machineKey = machineKey
        self.signer = signer
        self.ownIce = iceServers
        self.relayOnly = relayOnly
        self.access = access
        self.events = events
        self.scheduler = scheduler
        connectionID = try Base64URL.randomToken(bytes: 16)
        super.init()
        cancelTimeout = scheduler.after(milliseconds: 20_000) { [weak self] in
            self?.end(TransportFailure.invalid("The direct connection did not come up within 20 seconds."))
        }
        do {
            membership = try sockets.join(url: brokerURL, signer: signer, member: .init(ready: { [weak self] servers in
                self?.negotiate(servers)
            }, relayed: { [weak self] frame in
                self?.receiveSignal(frame)
            }, refused: { [weak self] frame in
                guard let self, let id = frame["id"]?.stringValue, self.relayIDs.contains(id) else { return }
                self.end(TransportFailure.invalid(frame["message"]?.stringValue ?? "The broker refused this connection attempt."))
            }, lost: { [weak self] error in self?.end(error) }))
        } catch {
            cancelTimeout?()
            throw error
        }
    }

    public func send(_ text: String) throws {
        guard authenticated, !ended else { throw TransportFailure.invalid("The machine connection is not authenticated.") }
        do { try sendFrame(text) }
        catch { end(error); throw error }
    }

    public func close() { end(nil) }

    private func trace(_ message: String) {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["RUIMTE_TRACE_CONNECTION"] == "1" else { return }
        print("[connection \(connectionID.prefix(8))] \(message)")
        #endif
    }

    private func negotiate(_ route: [JSONValue]) {
        guard !ended, !negotiationStarted else { return }
        negotiationStarted = true
        trace("broker ready, \(route.count) ICE servers")
        do {
            let configuration = RTCConfiguration()
            configuration.sdpSemantics = .unifiedPlan
            configuration.iceTransportPolicy = relayOnly ? .relay : .all
            configuration.iceServers = try IceServers.merge(own: ownIce, route: route).map { server in
                let urls = server["urls"]!.arrayValue!.compactMap(\.stringValue)
                return RTCIceServer(urlStrings: urls, username: server["username"]?.stringValue ?? "", credential: server["credential"]?.stringValue ?? "")
            }
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            guard let created = Self.factory.peerConnection(with: configuration, constraints: constraints, delegate: self) else {
                throw TransportFailure.invalid("WebRTC could not create a connection.")
            }
            peer = created
            let channelConfiguration = RTCDataChannelConfiguration()
            channelConfiguration.isOrdered = true
            guard let channel = created.dataChannel(forLabel: WireConstants.directChannelLabel, configuration: channelConfiguration) else {
                throw TransportFailure.invalid("WebRTC could not create a data channel.")
            }
            self.channel = channel
            channel.delegate = self
            created.offer(for: constraints) { [weak self] description, error in
                Task { @MainActor in
                    guard let self, !self.ended else { return }
                    guard let description, error == nil else {
                        self.end(error ?? TransportFailure.invalid("WebRTC made no offer.")); return
                    }
                    created.setLocalDescription(description) { [weak self] error in
                        Task { @MainActor in
                            guard let self, !self.ended else { return }
                            if let error { self.end(error); return }
                            self.waitForGathering()
                        }
                    }
                }
            }
        } catch { end(error) }
    }

    private func waitForGathering() {
        guard let peer else { return }
        // Keep initial routes in the offer until candidate-free negotiation is verified with deployed daemons.
        if peer.iceGatheringState == .complete { offer(); return }
        gatherDone = { [weak self] in self?.offer() }
        cancelGather = scheduler.after(milliseconds: 5_000) { [weak self] in self?.finishGathering() }
    }

    private func finishGathering() {
        cancelGather?()
        cancelGather = nil
        let finish = gatherDone
        gatherDone = nil
        finish?()
    }

    private func offer() {
        guard !ended, offerSDP == nil, let sdp = peer?.localDescription?.sdp else { return }
        offerSDP = sdp
        candidates.offered(sdp)
        trace("offer with \(sdp.components(separatedBy: "a=candidate:").count - 1) candidates")
        accessTask = Task { [weak self] in
            guard let self else { return }
            do {
                var signal: [String: JSONValue] = ["kind": .string("offer"), "sdp": .string(sdp)]
                if let access { signal["access"] = try await access() }
                guard !ended, !Task.isCancelled else { return }
                let envelope = try WireSchema.validate("SignalEnvelopeSchema", .object(["connectionId": .string(connectionID), "signal": .object(signal)]))
                if let id = try membership?.relay(to: machineKey, envelope: envelope) { relayIDs.insert(id) }
                trace("offer sent")
            } catch { if !Task.isCancelled { end(error) } }
        }
    }

    private func receiveSignal(_ raw: JSONValue) {
        guard !ended else { return }
        do {
            let frame = try WireSchema.validate("BrokerRelayedSchema", raw)
            let envelope = try field(frame, "envelope")
            guard frame["from"]?.stringValue == machineKey, envelope["connectionId"]?.stringValue == connectionID else { return }
            let message = try DirectIdentity.signalMessage(from: machineKey, to: signer.publicKey, envelope: envelope)
            guard DirectIdentity.verify(publicKey: machineKey, message: message, signature: try string(frame, "signature")) else {
                throw TransportFailure.invalid("A broker signal names the machine but is not signed by it.")
            }
            let signal = try field(envelope, "signal")
            switch try string(signal, "kind") {
            case "answer":
                trace("answer received")
                guard let peer, let offerSDP, binding == nil else { return }
                let sdp = try string(signal, "sdp")
                binding = try DirectIdentity.channelBinding(offer: offerSDP, answer: sdp)
                peer.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [weak self] error in
                    Task { @MainActor in
                        guard let self, !self.ended else { return }
                        if let error { self.end(error); return }
                        self.trace("answer applied")
                        let pending = self.candidates.answerApplied()
                        self.trace("forwarding \(pending.count) additional candidates")
                        for candidate in pending { self.relayCandidate(candidate) }
                    }
                }
            case "candidate":
                let candidate = try string(signal, "candidate")
                if !candidate.isEmpty {
                    let ice = RTCIceCandidate(sdp: candidate, sdpMLineIndex: Int32(signal["sdpMLineIndex"]?.numberValue ?? 0), sdpMid: signal["sdpMid"]?.stringValue)
                    peer?.add(ice) { _ in }
                }
            case "close": throw TransportFailure.invalid("The machine ended this connection: \(try string(signal, "reason")).")
            default: break
            }
        } catch { end(error) }
    }

    private func relayCandidate(_ signal: JSONValue) {
        guard !ended, !authenticated else { return }
        do {
            let envelope = try WireSchema.validate("SignalEnvelopeSchema", .object([
                "connectionId": .string(connectionID), "signal": signal,
            ]))
            if let id = try membership?.relay(to: machineKey, envelope: envelope) { relayIDs.insert(id) }
        } catch { end(error) }
    }

    private func generatedCandidate(_ candidate: RTCIceCandidate) {
        guard !ended, !authenticated else { return }
        let kind = candidate.sdp.components(separatedBy: " typ ").last?.components(separatedBy: " ").first ?? "unknown"
        trace("local candidate \(kind)")
        let signal: JSONValue = .object([
            "kind": .string("candidate"), "candidate": .string(candidate.sdp),
            "sdpMid": candidate.sdpMid.map(JSONValue.string) ?? .null,
            "sdpMLineIndex": .number(Double(candidate.sdpMLineIndex)),
        ])
        if let ready = candidates.generated(signal) { relayCandidate(ready) }
    }

    private func receivePiece(_ text: String) {
        guard !ended else { return }
        liveness?.heard(now: now)
        switch assembler.push(text, maxChars: authenticated ? 16 * 1_024 * 1_024 : 4_096) {
        case .invalid: end(TransportFailure.invalid("The machine sent a frame this app cannot read."))
        case .partial: break
        case .frame(let frame):
            if authenticated { events.message(frame); return }
            do { try handshake(JSONValue.decode(Data(frame.utf8))) }
            catch { end(error) }
        }
    }

    private func handshake(_ frame: JSONValue) throws {
        trace("handshake frame")
        if !proofSent {
            guard let binding else { throw TransportFailure.invalid("The channel opened before its answer was applied.") }
            let proof = try DirectIdentity.proof(challenge: frame, binding: binding, machineID: machineID, machineKey: machineKey, signer: signer)
            proofSent = true
            try sendFrame(wireText(proof))
            return
        }
        let verdict = try WireSchema.validate("DirectVerdictFrameSchema", frame)
        guard verdict["type"]?.stringValue == "direct.accepted" else {
            throw TransportFailure.invalid(verdict["reason"]?.stringValue ?? "The machine refused this connection.")
        }
        authenticated = true
        trace("authenticated")
        cancelTimeout?()
        cancelTimeout = nil
        membership?.leave()
        membership = nil
        liveness = ChannelLiveness(now: now)
        scheduleTick()
        events.opened()
    }

    private var now: Double { ProcessInfo.processInfo.systemUptime * 1_000 }

    private func scheduleTick() {
        cancelTick = scheduler.after(milliseconds: WireConstants.directPingTickMs) { [weak self] in
            guard let self, !self.ended else { return }
            self.tick()
            if !self.ended { self.scheduleTick() }
        }
    }

    private func tick() {
        if !sampling, let peer {
            sampling = true
            peer.statistics { [weak self] report in
                Task { @MainActor in
                    guard let self else { return }
                    self.sampling = false
                    guard !self.ended else { return }
                    let stats = Array(report.statistics.values)
                    let transports = stats.filter { $0.type == "transport" }
                    let totals = transports.compactMap { ($0.values["bytesReceived"] as? NSNumber)?.doubleValue }
                    if !totals.isEmpty { self.receivedBytes = totals.reduce(0, +) }
                    let selectedID = transports.compactMap { $0.values["selectedCandidatePairId"] as? String }.first
                    let pairs = stats.filter { $0.type == "candidate-pair" }
                    let selected = selectedID.flatMap { report.statistics[$0] } ?? pairs.first { ($0.values["selected"] as? Bool) == true } ?? pairs.first {
                        ($0.values["nominated"] as? Bool) == true && ($0.values["state"] as? String) == "succeeded"
                    }
                    if let selected {
                        let local = (selected.values["localCandidateId"] as? String).flatMap { report.statistics[$0] }
                        let remote = (selected.values["remoteCandidateId"] as? String).flatMap { report.statistics[$0] }
                        let localType = local?.values["candidateType"] as? String
                        let remoteType = remote?.values["candidateType"] as? String
                        let relayed: Bool? = localType == "relay" || remoteType == "relay" ? true : (localType != nil && remoteType != nil ? false : nil)
                        if self.relayed != relayed { self.relayed = relayed; self.events.route(relayed) }
                    }
                    self.checkLiveness()
                }
            }
        } else {
            checkLiveness()
        }
    }

    private func checkLiveness() {
        guard !ended else { return }
        switch liveness?.tick(now: now, received: receivedBytes) {
        case .ping(let id):
            do {
                let request = try WireSchema.validate("RequestSchema", .object(["id": .string(id), "type": .string("server.ping"), "payload": .object([:])]))
                try sendFrame(wireText(request))
            } catch { end(error) }
        case .dead: end(TransportFailure.invalid("The machine stopped answering over the direct connection."))
        default: break
        }
    }

    private func sendFrame(_ frame: String) throws {
        guard let channel, channel.readyState == .open else { throw TransportFailure.invalid("The data channel is not open.") }
        for piece in DirectFraming.split(frame) {
            guard channel.sendData(RTCDataBuffer(data: Data(piece.utf8), isBinary: false)) else {
                throw TransportFailure.invalid("The data channel refused a frame.")
            }
        }
    }

    private func end(_ error: Error?) {
        guard !ended else { return }
        ended = true
        trace("ended: \(error?.localizedDescription ?? "closed")")
        cancelTimeout?()
        cancelGather?()
        cancelTick?()
        gatherDone = nil
        accessTask?.cancel()
        accessTask = nil
        membership?.leave()
        membership = nil
        let closingPeer = peer
        let closingChannel = channel
        peer = nil
        channel = nil
        closingChannel?.delegate = nil
        closingPeer?.delegate = nil
        if closingChannel?.readyState == .open {
            // SCTP stream reset must reach the machine before tearing down DTLS.
            closingChannel?.close()
            scheduler.after(milliseconds: 2_000) { closingPeer?.close() }
        } else {
            closingChannel?.close()
            closingPeer?.close()
        }
        events.closed(error)
    }
}

extension NativeWebRTCLink: RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    nonisolated public func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        Task { @MainActor [weak self] in
            if dataChannel.readyState == .closed { self?.end(TransportFailure.invalid("The direct connection closed.")) }
        }
    }
    nonisolated public func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        Task { @MainActor [weak self] in
            guard let text = String(data: buffer.data, encoding: .utf8) else {
                self?.end(TransportFailure.invalid("The data channel sent invalid UTF-8.")); return
            }
            self?.receivePiece(text)
        }
    }
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated public func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        Task { @MainActor [weak self] in
            self?.trace("ICE state \(newState.rawValue)")
            if newState == .failed { self?.end(TransportFailure.invalid("No network path to the machine: ICE failed.")) }
        }
    }
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        Task { @MainActor [weak self] in
            if newState == .complete { self?.finishGathering() }
        }
    }
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        Task { @MainActor [weak self] in self?.generatedCandidate(candidate) }
    }
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
#endif
