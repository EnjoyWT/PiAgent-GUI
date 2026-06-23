import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

struct Request: Decodable {
    let id: Int
    let method: String
    let params: [String: AnyCodable]?
}

struct Response: Encodable {
    let id: Int
    let result: AnyCodable?
    let error: String?
}

struct AnyCodable: Codable {
    let value: Any?

    init(_ value: Any?) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = nil
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case nil:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let int64 as Int64:
            try container.encode(int64)
        case let double as Double:
            try container.encode(double)
        case let cgFloat as CGFloat:
            try container.encode(Double(cgFloat))
        case let string as String:
            try container.encode(string)
        case let array as [Any?]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any?]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encode(String(describing: value))
        }
    }

    var string: String? { value as? String }
    var int: Int? {
        if let int = value as? Int { return int }
        if let double = value as? Double { return Int(double) }
        return nil
    }
    var double: Double? {
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        return nil
    }
    var bool: Bool? { value as? Bool }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]
let decoder = JSONDecoder()

func writeResponse(_ response: Response) {
    do {
        let data = try encoder.encode(response)
        if let text = String(data: data, encoding: .utf8) {
            FileHandle.standardOutput.write((text + "\n").data(using: .utf8)!)
        }
    } catch {
        let fallback = #"{"id":0,"result":null,"error":"failed_to_encode_response"}"#
        FileHandle.standardOutput.write((fallback + "\n").data(using: .utf8)!)
    }
}

func accessibilityTrusted(prompt: Bool = false) -> Bool {
    let key = "AXTrustedCheckOptionPrompt"
    return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
}

func screenRecordingStatus() -> String {
    if #available(macOS 10.15, *) {
        return CGPreflightScreenCaptureAccess() ? "granted" : "denied"
    }
    return "granted"
}

func requestPermissions() -> [String: Any] {
    let accessibility = accessibilityTrusted(prompt: true)
    var screenRecording = screenRecordingStatus()
    var screenRecordingRequested = false

    if #available(macOS 10.15, *), screenRecording != "granted" {
        screenRecordingRequested = true
        screenRecording = CGRequestScreenCaptureAccess() ? "granted" : screenRecordingStatus()
    }

    return [
        "permissions": [
            "accessibility": accessibility ? "granted" : "denied",
            "screenRecording": screenRecording
        ],
        "requested": [
            "accessibility": true,
            "screenRecording": screenRecordingRequested
        ]
    ]
}

func doctor() -> [String: Any] {
    let ax = accessibilityTrusted()
    let screen = screenRecordingStatus()
    return [
        "platform": "darwin",
        "helperPid": Int(ProcessInfo.processInfo.processIdentifier),
        "permissions": [
            "accessibility": ax ? "granted" : "denied",
            "screenRecording": screen
        ],
        "capabilities": [
            "listApps": true,
            "listWindows": true,
            "screenshot": screen == "granted",
            "foregroundInput": ax,
            "backgroundClick": ax && SynthPost.isAvailable,
            "backgroundKeyboard": ax,
            "backgroundDrag": ax && SynthPost.isAvailable && SetWindowLocation.isAvailable,
            "backgroundScroll": ax && SynthPost.isAvailable && SetWindowLocation.isAvailable,
            "focusPreservation": ax,
            "setValue": ax,
            "intent": true,
            "windowLocalBackgroundClick": ax && SynthPost.isAvailable && SetWindowLocation.isAvailable,
            "privateSymbols": [
                "cgEventPostToPid": SynthPost.isAvailable,
                "cgEventSetWindowLocation": SetWindowLocation.isAvailable
            ]
        ]
    ]
}

func listApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications.map { app in
        [
            "pid": Int(app.processIdentifier),
            "name": app.localizedName ?? "",
            "bundleId": app.bundleIdentifier ?? "",
            "active": app.isActive,
            "hidden": app.isHidden,
            "terminated": app.isTerminated
        ]
    }
}

func windowDict(_ info: NSDictionary) -> [String: Any]? {
    guard let ownerPid = info[kCGWindowOwnerPID as String] as? Int,
          let windowId = info[kCGWindowNumber as String] as? Int,
          let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
          let bounds = CGRect(dictionaryRepresentation: boundsDict) else {
        return nil
    }
    let layer = info[kCGWindowLayer as String] as? Int ?? 0
    let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
    return [
        "windowId": windowId,
        "pid": ownerPid,
        "ownerName": info[kCGWindowOwnerName as String] as? String ?? "",
        "title": info[kCGWindowName as String] as? String ?? "",
        "layer": layer,
        "alpha": alpha,
        "bounds": [
            "x": bounds.origin.x,
            "y": bounds.origin.y,
            "width": bounds.size.width,
            "height": bounds.size.height
        ]
    ]
}

func listWindows(pid: Int?) -> [[String: Any]] {
    guard let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [NSDictionary] else {
        return []
    }
    return infos.compactMap(windowDict).filter { item in
        guard let targetPid = pid else { return true }
        return item["pid"] as? Int == targetPid
    }
}

func matchesApp(_ app: NSRunningApplication, target: String) -> Bool {
    let normalized = target.lowercased()
    if app.bundleIdentifier?.lowercased() == normalized { return true }
    if app.localizedName?.lowercased() == normalized { return true }
    return app.localizedName?.lowercased().contains(normalized) ?? false
}

func runningApp(params: [String: AnyCodable]?) -> NSRunningApplication? {
    if let pid = params?["pid"]?.int {
        return NSRunningApplication(processIdentifier: pid_t(pid))
    }
    let target = params?["bundle"]?.string ?? params?["app"]?.string
    if let target {
        return NSWorkspace.shared.runningApplications.first { matchesApp($0, target: target) }
    }
    return NSWorkspace.shared.frontmostApplication
}

func explicitRunningApp(params: [String: AnyCodable]?) -> NSRunningApplication? {
    if let pid = params?["pid"]?.int {
        return NSRunningApplication(processIdentifier: pid_t(pid))
    }
    let target = params?["bundle"]?.string ?? params?["app"]?.string
    if let target {
        return NSWorkspace.shared.runningApplications.first { matchesApp($0, target: target) }
    }
    return nil
}

final class FocusPreserver {
    private let enabled: Bool
    private let original: NSRunningApplication?
    private let originalPid: pid_t?
    private let targetPid: Int?

    init(targetPid: Int?, enabled: Bool) {
        self.enabled = enabled
        self.original = NSWorkspace.shared.frontmostApplication
        self.originalPid = original?.processIdentifier
        self.targetPid = targetPid
    }

    func finish() -> [String: Any] {
        guard enabled, let original, let originalPid else {
            return ["enabled": enabled, "restored": false, "reason": "not_enabled"]
        }
        if let targetPid, originalPid == pid_t(targetPid) {
            return ["enabled": enabled, "restored": false, "reason": "target_was_frontmost"]
        }

        usleep(25_000)
        let current = NSWorkspace.shared.frontmostApplication
        let currentPid = current?.processIdentifier
        if currentPid == originalPid {
            return [
                "enabled": enabled,
                "restored": false,
                "reason": "frontmost_unchanged",
                "originalPid": Int(originalPid)
            ]
        }

        let restored = original.activate(options: [.activateIgnoringOtherApps])
        usleep(25_000)
        var result: [String: Any] = [
            "enabled": enabled,
            "restored": restored,
            "reason": "frontmost_restored",
            "originalPid": Int(originalPid)
        ]
        if let currentPid { result["currentPid"] = Int(currentPid) }
        if let targetPid { result["targetPid"] = targetPid }
        return result
    }
}

func requirePid(params: [String: AnyCodable]?) throws -> Int {
    guard let app = runningApp(params: params), app.processIdentifier > 0 else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 80, userInfo: [NSLocalizedDescriptionKey: "pid, bundle, app, or a frontmost application is required"])
    }
    return Int(app.processIdentifier)
}

func requireExplicitPid(params: [String: AnyCodable]?, purpose: String) throws -> Int {
    guard let app = explicitRunningApp(params: params), app.processIdentifier > 0 else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 88, userInfo: [NSLocalizedDescriptionKey: "\(purpose) requires an explicit pid, bundle, or app target"])
    }
    return Int(app.processIdentifier)
}

func doubleValue(_ value: Any?) -> Double {
    if let double = value as? Double { return double }
    if let cgFloat = value as? CGFloat { return Double(cgFloat) }
    if let int = value as? Int { return Double(int) }
    if let number = value as? NSNumber { return number.doubleValue }
    return 0
}

func boundsWidth(_ window: [String: Any]) -> Double {
    guard let bounds = window["bounds"] as? [String: Any] else { return 0 }
    return doubleValue(bounds["width"])
}

func boundsHeight(_ window: [String: Any]) -> Double {
    guard let bounds = window["bounds"] as? [String: Any] else { return 0 }
    return doubleValue(bounds["height"])
}

func visibleWindow(_ window: [String: Any]) -> Bool {
    let layer = window["layer"] as? Int ?? 0
    let alpha = window["alpha"] as? Double ?? 1
    return layer == 0 && alpha > 0 && boundsWidth(window) > 1 && boundsHeight(window) > 1
}

func targetWindowInfo(params: [String: AnyCodable]?) throws -> [String: Any] {
    let pid = try requirePid(params: params)
    let requestedWindowId = params?["windowId"]?.int
    let windows = listWindows(pid: pid).filter(visibleWindow)
    if let requestedWindowId,
       let window = windows.first(where: { $0["windowId"] as? Int == requestedWindowId }) {
        return window
    }
    if let window = windows.first {
        return window
    }
    throw NSError(domain: "PiAgentComputerUseHelper", code: 81, userInfo: [NSLocalizedDescriptionKey: "App has no visible windows to capture."])
}

func imagePayload(_ image: CGImage, prefix: String) throws -> [String: Any] {
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 82, userInfo: [NSLocalizedDescriptionKey: "PNG encoding failed."])
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("piagent-computer-use", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent("\(prefix)-\(UUID().uuidString).png")
    try png.write(to: url, options: .atomic)
    return [
        "mimeType": "image/png",
        "path": url.path,
        "width": image.width,
        "height": image.height
    ]
}

func captureWindow(params: [String: AnyCodable]?) throws -> [String: Any] {
    let window = try targetWindowInfo(params: params)
    guard let windowId = window["windowId"] as? Int else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 83, userInfo: [NSLocalizedDescriptionKey: "windowId is required"])
    }
    guard let image = CGWindowListCreateImage(
        .null,
        .optionIncludingWindow,
        CGWindowID(windowId),
        [.boundsIgnoreFraming, .bestResolution]
    ) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 84, userInfo: [NSLocalizedDescriptionKey: "Window capture failed. Screen Recording permission may be missing or the window is unavailable."])
    }
    var payload = try imagePayload(image, prefix: "window-\(windowId)")
    payload["window"] = window
    return payload
}

func screenshot(displayId: CGDirectDisplayID?) throws -> [String: Any] {
    let display = displayId ?? CGMainDisplayID()
    guard let image = CGDisplayCreateImage(display) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "Screen capture failed. Screen Recording permission may be missing."])
    }
    var payload = try imagePayload(image, prefix: "screen-\(Int(display))")
    payload["displayId"] = Int(display)
    return payload
}

func pointFromParams(_ params: [String: AnyCodable]?) throws -> CGPoint {
    guard let x = params?["x"]?.double, let y = params?["y"]?.double else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 10, userInfo: [NSLocalizedDescriptionKey: "x and y are required"])
    }
    return CGPoint(x: x, y: y)
}

func mouseButton(_ value: String?) -> CGMouseButton {
    switch value {
    case "right": return .right
    case "middle": return .center
    default: return .left
    }
}

func mouseTypes(button: CGMouseButton, down: Bool) -> CGEventType {
    switch button {
    case .right: return down ? .rightMouseDown : .rightMouseUp
    case .center: return down ? .otherMouseDown : .otherMouseUp
    default: return down ? .leftMouseDown : .leftMouseUp
    }
}

func nsMouseTypes(button: CGMouseButton, down: Bool) -> NSEvent.EventType {
    switch button {
    case .right: return down ? .rightMouseDown : .rightMouseUp
    case .center: return down ? .otherMouseDown : .otherMouseUp
    default: return down ? .leftMouseDown : .leftMouseUp
    }
}

func nsMouseDraggedType(button: CGMouseButton) -> NSEvent.EventType {
    switch button {
    case .right: return .rightMouseDragged
    case .center: return .otherMouseDragged
    default: return .leftMouseDragged
    }
}

func nsModifierFlags(_ flags: CGEventFlags) -> NSEvent.ModifierFlags {
    var result = NSEvent.ModifierFlags()
    if flags.contains(.maskCommand) { result.insert(.command) }
    if flags.contains(.maskShift) { result.insert(.shift) }
    if flags.contains(.maskAlternate) { result.insert(.option) }
    if flags.contains(.maskControl) { result.insert(.control) }
    return result
}

let mouseEventSubtypeField = CGEventField(rawValue: 7)!

func resolveCoreGraphicsSymbol(_ name: String) -> UnsafeMutableRawPointer? {
    guard let handle = dlopen(
        "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
        RTLD_NOW
    ) else {
        return nil
    }
    return dlsym(handle, name)
}

enum SynthPost {
    typealias Fn = @convention(c) (pid_t, CGEvent) -> Void

    static let fn: Fn? = {
        guard let symbol = resolveCoreGraphicsSymbol("CGEventPostToPid") else {
            return nil
        }
        return unsafeBitCast(symbol, to: Fn.self)
    }()

    static var isAvailable: Bool {
        fn != nil
    }

    static func post(_ event: CGEvent, to pid: pid_t) {
        if let fn {
            fn(pid, event)
        } else {
            event.postToPid(pid)
        }
    }
}

enum SetWindowLocation {
    typealias Fn = @convention(c) (CGEvent, CGPoint) -> Void

    static let fn: Fn? = {
        guard let symbol = resolveCoreGraphicsSymbol("CGEventSetWindowLocation") else {
            return nil
        }
        return unsafeBitCast(symbol, to: Fn.self)
    }()

    static var isAvailable: Bool {
        fn != nil
    }

    static func set(_ event: CGEvent, point: CGPoint) -> Bool {
        guard let fn else { return false }
        fn(event, point)
        return true
    }
}

final class SyntheticEventCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Int(ProcessInfo.processInfo.systemUptime * 1_000_000) & 0x7fff_ffff

    func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        value = (value + 1) & 0x7fff_ffff
        return value
    }
}

let syntheticEventCounter = SyntheticEventCounter()

func nextSyntheticEventNumber() -> Int {
    syntheticEventCounter.next()
}

func windowBoundsRect(_ window: [String: Any]) -> CGRect? {
    guard let bounds = window["bounds"] as? [String: Any] else { return nil }
    return CGRect(
        x: doubleValue(bounds["x"]),
        y: doubleValue(bounds["y"]),
        width: doubleValue(bounds["width"]),
        height: doubleValue(bounds["height"])
    )
}

func targetWindowForClick(pid: Int, point: CGPoint, requestedWindowId: Int?) throws -> (windowId: Int, bounds: CGRect) {
    let windows = listWindows(pid: pid).filter(visibleWindow)
    if let requestedWindowId,
       let window = windows.first(where: { $0["windowId"] as? Int == requestedWindowId }),
       let bounds = windowBoundsRect(window) {
        return (requestedWindowId, bounds)
    }
    if let window = windows.first(where: { window in
        guard let bounds = windowBoundsRect(window) else { return false }
        return bounds.contains(point)
    }),
       let windowId = window["windowId"] as? Int,
       let bounds = windowBoundsRect(window) {
        return (windowId, bounds)
    }
    if let window = windows.first,
       let windowId = window["windowId"] as? Int,
       let bounds = windowBoundsRect(window) {
        return (windowId, bounds)
    }
    throw NSError(domain: "PiAgentComputerUseHelper", code: 24, userInfo: [NSLocalizedDescriptionKey: "No visible target window for background click"])
}

func windowLocalPoint(screenPoint: CGPoint, bounds: CGRect) -> CGPoint {
    screenPoint.applying(CGAffineTransform(translationX: -bounds.origin.x, y: -bounds.origin.y))
}

func makeWindowClickEvent(
    button: CGMouseButton,
    down: Bool,
    clickIndex: Int,
    screenPoint: CGPoint,
    windowId: Int,
    windowBounds: CGRect,
    flags: CGEventFlags
) throws -> (event: CGEvent, windowPoint: CGPoint, setWindowLocation: Bool) {
    guard let nsEvent = NSEvent.mouseEvent(
        with: nsMouseTypes(button: button, down: down),
        location: screenPoint,
        modifierFlags: nsModifierFlags(flags),
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: windowId,
        context: nil,
        eventNumber: nextSyntheticEventNumber(),
        clickCount: clickIndex,
        pressure: down ? 1.0 : 0.0
    ), let event = nsEvent.cgEvent else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 21, userInfo: [NSLocalizedDescriptionKey: "Failed to create window mouse event"])
    }

    event.setIntegerValueField(.mouseEventButtonNumber, value: Int64(button.rawValue))
    event.setIntegerValueField(mouseEventSubtypeField, value: 3)
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowId))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowId))
    event.flags = flags
    event.location = screenPoint

    let local = windowLocalPoint(screenPoint: event.location, bounds: windowBounds)
    let wroteWindowLocation = SetWindowLocation.set(event, point: local)
    return (event, local, wroteWindowLocation)
}

func makeWindowMouseEvent(
    button: CGMouseButton,
    type: NSEvent.EventType,
    clickCount: Int,
    pressure: Float,
    screenPoint: CGPoint,
    windowId: Int,
    windowBounds: CGRect,
    flags: CGEventFlags
) throws -> (event: CGEvent, windowPoint: CGPoint, setWindowLocation: Bool) {
    guard let nsEvent = NSEvent.mouseEvent(
        with: type,
        location: screenPoint,
        modifierFlags: nsModifierFlags(flags),
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: windowId,
        context: nil,
        eventNumber: nextSyntheticEventNumber(),
        clickCount: clickCount,
        pressure: pressure
    ), let event = nsEvent.cgEvent else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 21, userInfo: [NSLocalizedDescriptionKey: "Failed to create window mouse event"])
    }

    event.setIntegerValueField(.mouseEventButtonNumber, value: Int64(button.rawValue))
    event.setIntegerValueField(mouseEventSubtypeField, value: 3)
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowId))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowId))
    event.flags = flags
    event.location = screenPoint

    let local = windowLocalPoint(screenPoint: event.location, bounds: windowBounds)
    let wroteWindowLocation = SetWindowLocation.set(event, point: local)
    return (event, local, wroteWindowLocation)
}

func axPoint(_ element: AXUIElement, _ attr: CFString) -> CGPoint? {
    var value: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, attr, &value) != .success { return nil }
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    let axValue = value as! AXValue
    var point = CGPoint.zero
    guard AXValueGetType(axValue) == .cgPoint, AXValueGetValue(axValue, .cgPoint, &point) else {
        return nil
    }
    return point
}

func axSize(_ element: AXUIElement, _ attr: CFString) -> CGSize? {
    var value: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, attr, &value) != .success { return nil }
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    let axValue = value as! AXValue
    var size = CGSize.zero
    guard AXValueGetType(axValue) == .cgSize, AXValueGetValue(axValue, .cgSize, &size) else {
        return nil
    }
    return size
}

func axElementCenter(_ element: AXUIElement) -> CGPoint? {
    guard let position = axPoint(element, kAXPositionAttribute as CFString),
          let size = axSize(element, kAXSizeAttribute as CFString) else {
        return nil
    }
    return CGPoint(x: position.x + size.width / 2, y: position.y + size.height / 2)
}

func findAXElement(
    _ element: AXUIElement,
    targetRef: String,
    depth: Int,
    maxDepth: Int,
    maxChildren: Int,
    refs: AXRefBuilder
) -> AXUIElement? {
    if refs.make() == targetRef { return element }
    if depth >= maxDepth { return nil }

    var childrenRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) != .success {
        return nil
    }
    guard let children = childrenRef as? [AXUIElement] else { return nil }
    for child in children.prefix(maxChildren) {
        if let found = findAXElement(
            child,
            targetRef: targetRef,
            depth: depth + 1,
            maxDepth: maxDepth,
            maxChildren: maxChildren,
            refs: refs
        ) {
            return found
        }
    }
    return nil
}

func resolveAXElement(params: [String: AnyCodable]?) throws -> (String, AXUIElement)? {
    guard let ref = params?["elementId"]?.string ?? params?["ref"]?.string else { return nil }
    let pid = try requirePid(params: params)
    let maxDepth = max(0, min(params?["maxDepth"]?.int ?? 8, 12))
    let maxChildren = max(1, min(params?["maxChildren"]?.int ?? 200, 500))
    let root = AXUIElementCreateApplication(pid_t(pid))
    let refs = AXRefBuilder()
    guard let element = findAXElement(root, targetRef: ref, depth: 0, maxDepth: maxDepth, maxChildren: maxChildren, refs: refs) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 22, userInfo: [NSLocalizedDescriptionKey: "No accessibility element found for ref \(ref). Refresh snapshot_window and retry."])
    }
    return (ref, element)
}

func performDefaultAXAction(_ element: AXUIElement) -> String? {
    let actions = axActionNames(element)
    for action in [kAXPressAction, kAXPickAction, kAXConfirmAction] {
        let name = action as String
        if actions.contains(name),
           AXUIElementPerformAction(element, action as CFString) == .success {
            return name
        }
    }
    return nil
}

func axAttributeSettable(_ element: AXUIElement, _ attr: CFString) -> Bool {
    var settable = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, attr, &settable) == .success && settable.boolValue
}

func axSetString(_ element: AXUIElement, _ attr: CFString, _ value: String) -> Bool {
    AXUIElementSetAttributeValue(element, attr, value as CFString) == .success
}

func insertTextWithAX(_ element: AXUIElement, text: String) -> String? {
    if axAttributeSettable(element, kAXSelectedTextAttribute as CFString),
       axSetString(element, kAXSelectedTextAttribute as CFString, text) {
        return "ax_selected_text"
    }

    if axAttributeSettable(element, kAXValueAttribute as CFString) {
        let current = axString(element, kAXValueAttribute as CFString) ?? ""
        if axSetString(element, kAXValueAttribute as CFString, current + text) {
            return "ax_value_append"
        }
    }

    return nil
}

func axCFValue(from raw: Any?) throws -> CFTypeRef {
    switch raw {
    case nil:
        return "" as CFString
    case let bool as Bool:
        return bool ? kCFBooleanTrue : kCFBooleanFalse
    case let int as Int:
        return NSNumber(value: int) as CFNumber
    case let double as Double:
        return NSNumber(value: double) as CFNumber
    case let number as NSNumber:
        return number
    case let string as String:
        return string as CFString
    default:
        throw NSError(domain: "PiAgentComputerUseHelper", code: 33, userInfo: [NSLocalizedDescriptionKey: "set_value only supports string, number, boolean, or null values"])
    }
}

func axSetCFValue(_ element: AXUIElement, _ attr: CFString, _ value: CFTypeRef) -> Bool {
    AXUIElementSetAttributeValue(element, attr, value) == .success
}

func setValue(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 32, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for set_value"])
    }
    guard let raw = params?["value"] else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 34, userInfo: [NSLocalizedDescriptionKey: "value is required"])
    }
    guard let (ref, element) = try resolveAXElement(params: params) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 35, userInfo: [NSLocalizedDescriptionKey: "set_value requires elementId or ref"])
    }

    let pid = try requirePid(params: params)
    let background = params?["background"]?.bool ?? false
    let focus = FocusPreserver(targetPid: pid, enabled: background)
    let value = try axCFValue(from: raw.value)
    let method: String

    if axAttributeSettable(element, kAXValueAttribute as CFString),
       axSetCFValue(element, kAXValueAttribute as CFString, value) {
        method = "ax_value"
    } else if axAttributeSettable(element, kAXSelectedTextAttribute as CFString) {
        let text = raw.string ?? String(describing: raw.value ?? "")
        guard axSetString(element, kAXSelectedTextAttribute as CFString, text) else {
            throw NSError(domain: "PiAgentComputerUseHelper", code: 36, userInfo: [NSLocalizedDescriptionKey: "set_value failed: AXSelectedText was settable but rejected the value"])
        }
        method = "ax_selected_text"
    } else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 37, userInfo: [NSLocalizedDescriptionKey: "set_value failed: target element has no settable AXValue or AXSelectedText attribute"])
    }

    return [
        "performed": true,
        "method": method,
        "target": ["pid": pid, "ref": ref],
        "focusPreservation": focus.finish(),
        "delivery": ["post": "AXUIElementSetAttributeValue"]
    ]
}

func postClick(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 20, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for click"])
    }
    var point = try? pointFromParams(params)
    var elementRef: String?
    let background = params?["background"]?.bool ?? false
    if let (ref, element) = try resolveAXElement(params: params) {
        elementRef = ref
        if let action = performDefaultAXAction(element) {
            let targetPid = background ? try requireExplicitPid(params: params, purpose: "background click") : nil
            let focus = FocusPreserver(targetPid: targetPid, enabled: background)
            var result: [String: Any] = [
                "performed": true,
                "method": "ax",
                "action": action,
                "target": ["ref": ref]
            ]
            if let targetPid {
                result["target"] = ["pid": targetPid, "ref": ref]
            }
            result["focusPreservation"] = focus.finish()
            return result
        }
        point = axElementCenter(element)
        if point == nil {
            throw NSError(domain: "PiAgentComputerUseHelper", code: 23, userInfo: [NSLocalizedDescriptionKey: "click: element has no AX action and no screen bounds for a physical click"])
        }
    }
    guard let point else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 10, userInfo: [NSLocalizedDescriptionKey: "x and y are required"])
    }
    let button = mouseButton(params?["button"]?.string)
    let clickCount = max(1, min(params?["clickCount"]?.int ?? params?["click_count"]?.int ?? 1, 3))
    let modifiers = flagsFromModifiers(params?["modifiers"]?.value)
    let pid: Int?
    if background {
        pid = try requireExplicitPid(params: params, purpose: "background click")
    } else {
        pid = params?["pid"]?.int ?? runningApp(params: params).map { Int($0.processIdentifier) }
    }
    let windowId = params?["windowId"]?.int
    let source = CGEventSource(stateID: .hidSystemState)

    if background {
        guard let pid else {
            throw NSError(domain: "PiAgentComputerUseHelper", code: 25, userInfo: [NSLocalizedDescriptionKey: "background click requires pid, bundle, or app"])
        }
        guard SetWindowLocation.isAvailable else {
            throw NSError(domain: "PiAgentComputerUseHelper", code: 26, userInfo: [NSLocalizedDescriptionKey: "CGEventSetWindowLocation is unavailable; deterministic window-local background click is not supported on this macOS build"])
        }
        let focus = FocusPreserver(targetPid: pid, enabled: true)
        let targetWindow = try targetWindowForClick(pid: pid, point: point, requestedWindowId: windowId)
        let targetIsActive = NSRunningApplication(processIdentifier: pid_t(pid))?.isActive ?? false
        var dispatchFlags = modifiers
        if !targetIsActive {
            dispatchFlags.insert(.maskCommand)
        }
        var lastWindowPoint = CGPoint.zero
        var wroteWindowLocation = false

        for clickIndex in 1...clickCount {
            let down = try makeWindowClickEvent(
                button: button,
                down: true,
                clickIndex: clickIndex,
                screenPoint: point,
                windowId: targetWindow.windowId,
                windowBounds: targetWindow.bounds,
                flags: dispatchFlags
            )
            lastWindowPoint = down.windowPoint
            wroteWindowLocation = wroteWindowLocation || down.setWindowLocation
            SynthPost.post(down.event, to: pid_t(pid))
            usleep(30_000)

            let up = try makeWindowClickEvent(
                button: button,
                down: false,
                clickIndex: clickIndex,
                screenPoint: point,
                windowId: targetWindow.windowId,
                windowBounds: targetWindow.bounds,
                flags: dispatchFlags
            )
            lastWindowPoint = up.windowPoint
            wroteWindowLocation = wroteWindowLocation || up.setWindowLocation
            SynthPost.post(up.event, to: pid_t(pid))
            usleep(40_000)
        }

        var target: [String: Any] = [
            "x": point.x,
            "y": point.y,
            "pid": pid,
            "windowId": targetWindow.windowId,
            "windowPoint": [
                "x": lastWindowPoint.x,
                "y": lastWindowPoint.y
            ]
        ]
        if let elementRef { target["ref"] = elementRef }

        return [
            "performed": true,
            "method": "background_cg_event",
            "button": params?["button"]?.string ?? "left",
            "clickCount": clickCount,
            "target": target,
            "focusPreservation": focus.finish(),
            "delivery": [
                "post": SynthPost.isAvailable ? "CGEventPostToPid" : "CGEvent.postToPid",
                "setWindowLocation": wroteWindowLocation,
                "targetWasActive": targetIsActive,
                "backgroundDispatchFlag": targetIsActive ? "none" : "maskCommand"
            ]
        ]
    }

    for _ in 1...clickCount {
        for down in [true, false] {
            guard let event = CGEvent(mouseEventSource: source, mouseType: mouseTypes(button: button, down: down), mouseCursorPosition: point, mouseButton: button) else {
                throw NSError(domain: "PiAgentComputerUseHelper", code: 21, userInfo: [NSLocalizedDescriptionKey: "Failed to create mouse event"])
            }
            event.setIntegerValueField(.mouseEventButtonNumber, value: Int64(button.rawValue))
            event.setIntegerValueField(mouseEventSubtypeField, value: 3)
            event.flags = modifiers
            if let windowId {
                event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowId))
                event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowId))
            }
            event.post(tap: .cghidEventTap)
            usleep(30_000)
        }
    }

    var target: [String: Any] = [
        "x": point.x,
        "y": point.y
    ]
    if let pid { target["pid"] = pid }
    if let windowId { target["windowId"] = windowId }
    if let elementRef { target["ref"] = elementRef }

    return [
        "performed": true,
        "method": "cg_event",
        "clickCount": clickCount,
        "target": target
    ]
}

func typeText(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 30, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for typing"])
    }
    guard let text = params?["text"]?.string else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 31, userInfo: [NSLocalizedDescriptionKey: "text is required"])
    }
    let background = params?["background"]?.bool ?? false

    if background {
        let pid = try requireExplicitPid(params: params, purpose: "background type_text")
        let focus = FocusPreserver(targetPid: pid, enabled: true)
        if let (ref, element) = try resolveAXElement(params: params),
           let method = insertTextWithAX(element, text: text) {
            return [
                "performed": true,
                "method": method,
                "characters": text.count,
                "target": ["pid": pid, "ref": ref],
                "focusPreservation": focus.finish(),
                "delivery": ["post": "AXUIElementSetAttributeValue"]
            ]
        }

        let source = CGEventSource(stateID: .hidSystemState)
        for scalar in text.unicodeScalars {
            var utf16 = Array(String(scalar).utf16)
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
                continue
            }
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            SynthPost.post(down, to: pid_t(pid))
            SynthPost.post(up, to: pid_t(pid))
        }
        return [
            "performed": true,
            "method": "background_keyboard",
            "characters": text.count,
            "target": ["pid": pid],
            "focusPreservation": focus.finish(),
            "delivery": ["post": SynthPost.isAvailable ? "CGEventPostToPid" : "CGEvent.postToPid"]
        ]
    }

    let source = CGEventSource(stateID: .hidSystemState)
    for scalar in text.unicodeScalars {
        var utf16 = Array(String(scalar).utf16)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
            continue
        }
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
    return ["performed": true, "method": "keyboard", "characters": text.count]
}

func drag(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 50, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for drag"])
    }
    guard let x = params?["x"]?.double, let y = params?["y"]?.double else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 51, userInfo: [NSLocalizedDescriptionKey: "x and y are required"])
    }
    let toX = params?["toX"]?.double ?? params?["endX"]?.double
    let toY = params?["toY"]?.double ?? params?["endY"]?.double
    guard let endX = toX, let endY = toY else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 52, userInfo: [NSLocalizedDescriptionKey: "toX/toY are required for drag"])
    }
    let background = params?["background"]?.bool ?? false
    let button = mouseButton(params?["button"]?.string)
    let flags = flagsFromModifiers(params?["modifiers"]?.value)
    let source = CGEventSource(stateID: .hidSystemState)
    let start = CGPoint(x: x, y: y)
    let end = CGPoint(x: endX, y: endY)

    if background {
        let pid = try requireExplicitPid(params: params, purpose: "background drag")
        guard SetWindowLocation.isAvailable else {
            throw NSError(domain: "PiAgentComputerUseHelper", code: 54, userInfo: [NSLocalizedDescriptionKey: "CGEventSetWindowLocation is unavailable; deterministic window-local background drag is not supported on this macOS build"])
        }
        let focus = FocusPreserver(targetPid: pid, enabled: true)
        let requestedWindowId = params?["windowId"]?.int
        let targetWindow = try targetWindowForClick(pid: pid, point: start, requestedWindowId: requestedWindowId)
        var lastWindowPoint = CGPoint.zero
        var wroteWindowLocation = false

        let down = try makeWindowMouseEvent(
            button: button,
            type: nsMouseTypes(button: button, down: true),
            clickCount: 1,
            pressure: 1.0,
            screenPoint: start,
            windowId: targetWindow.windowId,
            windowBounds: targetWindow.bounds,
            flags: flags
        )
        lastWindowPoint = down.windowPoint
        wroteWindowLocation = wroteWindowLocation || down.setWindowLocation
        SynthPost.post(down.event, to: pid_t(pid))
        usleep(60_000)

        let dragged = try makeWindowMouseEvent(
            button: button,
            type: nsMouseDraggedType(button: button),
            clickCount: 1,
            pressure: 1.0,
            screenPoint: end,
            windowId: targetWindow.windowId,
            windowBounds: targetWindow.bounds,
            flags: flags
        )
        lastWindowPoint = dragged.windowPoint
        wroteWindowLocation = wroteWindowLocation || dragged.setWindowLocation
        SynthPost.post(dragged.event, to: pid_t(pid))
        usleep(60_000)

        let up = try makeWindowMouseEvent(
            button: button,
            type: nsMouseTypes(button: button, down: false),
            clickCount: 1,
            pressure: 0.0,
            screenPoint: end,
            windowId: targetWindow.windowId,
            windowBounds: targetWindow.bounds,
            flags: flags
        )
        lastWindowPoint = up.windowPoint
        wroteWindowLocation = wroteWindowLocation || up.setWindowLocation
        SynthPost.post(up.event, to: pid_t(pid))

        return [
            "performed": true,
            "method": "background_cg_event",
            "from": ["x": x, "y": y],
            "to": ["x": endX, "y": endY],
            "target": [
                "pid": pid,
                "windowId": targetWindow.windowId,
                "windowPoint": ["x": lastWindowPoint.x, "y": lastWindowPoint.y]
            ],
            "focusPreservation": focus.finish(),
            "delivery": [
                "post": SynthPost.isAvailable ? "CGEventPostToPid" : "CGEvent.postToPid",
                "setWindowLocation": wroteWindowLocation
            ]
        ]
    }

    guard let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left),
          let move = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: end, mouseButton: .left),
          let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 53, userInfo: [NSLocalizedDescriptionKey: "Failed to create drag events"])
    }
    down.flags = flags
    move.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    usleep(80_000)
    move.post(tap: .cghidEventTap)
    usleep(80_000)
    up.post(tap: .cghidEventTap)
    return ["performed": true, "method": "cg_event", "from": ["x": x, "y": y], "to": ["x": endX, "y": endY]]
}

func scroll(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 60, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for scroll"])
    }
    let deltaY = Int32(params?["deltaY"]?.double ?? params?["y"]?.double ?? -5)
    let deltaX = Int32(params?["deltaX"]?.double ?? 0)
    let background = params?["background"]?.bool ?? false
    guard let event = CGEvent(scrollWheelEvent2Source: CGEventSource(stateID: .hidSystemState), units: .line, wheelCount: 2, wheel1: deltaY, wheel2: deltaX, wheel3: 0) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 61, userInfo: [NSLocalizedDescriptionKey: "Failed to create scroll event"])
    }
    if background {
        let pid = try requireExplicitPid(params: params, purpose: "background scroll")
        guard SetWindowLocation.isAvailable else {
            throw NSError(domain: "PiAgentComputerUseHelper", code: 62, userInfo: [NSLocalizedDescriptionKey: "CGEventSetWindowLocation is unavailable; deterministic window-local background scroll is not supported on this macOS build"])
        }
        let focus = FocusPreserver(targetPid: pid, enabled: true)
        let requestedWindowId = params?["windowId"]?.int
        let requestedPoint = try? pointFromParams(params)
        let targetWindow = try targetWindowForClick(
            pid: pid,
            point: requestedPoint ?? .zero,
            requestedWindowId: requestedWindowId
        )
        let point = requestedPoint ?? CGPoint(x: targetWindow.bounds.midX, y: targetWindow.bounds.midY)
        event.location = point
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(targetWindow.windowId))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(targetWindow.windowId))
        let local = windowLocalPoint(screenPoint: point, bounds: targetWindow.bounds)
        let wroteWindowLocation = SetWindowLocation.set(event, point: local)
        SynthPost.post(event, to: pid_t(pid))
        return [
            "performed": true,
            "method": "background_cg_event",
            "deltaX": deltaX,
            "deltaY": deltaY,
            "target": [
                "pid": pid,
                "windowId": targetWindow.windowId,
                "x": point.x,
                "y": point.y,
                "windowPoint": ["x": local.x, "y": local.y]
            ],
            "focusPreservation": focus.finish(),
            "delivery": [
                "post": SynthPost.isAvailable ? "CGEventPostToPid" : "CGEvent.postToPid",
                "setWindowLocation": wroteWindowLocation
            ]
        ]
    }
    event.post(tap: .cghidEventTap)
    return ["performed": true, "method": "cg_event", "deltaX": deltaX, "deltaY": deltaY]
}

func axString(_ element: AXUIElement, _ attr: CFString) -> String? {
    var value: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, attr, &value) != .success { return nil }
    return value as? String
}

func axRectValue(_ value: CFTypeRef?) -> Any? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    let axValue = value as! AXValue
    var rect = CGRect.zero
    if AXValueGetType(axValue) == .cgRect, AXValueGetValue(axValue, .cgRect, &rect) {
        return ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
    }
    var point = CGPoint.zero
    if AXValueGetType(axValue) == .cgPoint, AXValueGetValue(axValue, .cgPoint, &point) {
        return ["x": point.x, "y": point.y]
    }
    var size = CGSize.zero
    if AXValueGetType(axValue) == .cgSize, AXValueGetValue(axValue, .cgSize, &size) {
        return ["width": size.width, "height": size.height]
    }
    return nil
}

func axAny(_ element: AXUIElement, _ attr: CFString) -> Any? {
    var value: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, attr, &value) != .success { return nil }
    if let string = value as? String { return string }
    if let number = value as? NSNumber { return number }
    if let rect = axRectValue(value) { return rect }
    return nil
}

final class AXRefBuilder {
    var next = 1

    func make() -> String {
        let ref = "e\(next)"
        next += 1
        return ref
    }
}

func axBool(_ element: AXUIElement, _ attr: CFString) -> Bool? {
    var value: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, attr, &value) != .success { return nil }
    return value as? Bool
}

func axActionNames(_ element: AXUIElement) -> [String] {
    var actionsRef: CFArray?
    if AXUIElementCopyActionNames(element, &actionsRef) != .success { return [] }
    return actionsRef as? [String] ?? []
}

func axNode(_ element: AXUIElement, depth: Int, maxDepth: Int, maxChildren: Int, refs: AXRefBuilder) -> [String: Any] {
    let position = axAny(element, kAXPositionAttribute as CFString)
    let size = axAny(element, kAXSizeAttribute as CFString)
    var node: [String: Any] = [
        "ref": refs.make(),
        "role": axString(element, kAXRoleAttribute as CFString) ?? "",
        "title": axString(element, kAXTitleAttribute as CFString) ?? "",
        "description": axString(element, kAXDescriptionAttribute as CFString) ?? "",
        "actions": axActionNames(element)
    ]
    if let value = axAny(element, kAXValueAttribute as CFString) { node["value"] = value }
    if let enabled = axBool(element, kAXEnabledAttribute as CFString) { node["enabled"] = enabled }
    if let position { node["position"] = position }
    if let size { node["size"] = size }
    if let point = axPoint(element, kAXPositionAttribute as CFString),
       let size = axSize(element, kAXSizeAttribute as CFString) {
        node["bounds"] = ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
    }
    if depth >= maxDepth { return node }

    var childrenRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
       let children = childrenRef as? [AXUIElement] {
        node["children"] = children.prefix(maxChildren).map {
            axNode($0, depth: depth + 1, maxDepth: maxDepth, maxChildren: maxChildren, refs: refs)
        }
    }
    return node
}

func flattenAXTree(_ root: [String: Any]) -> [[String: Any]] {
    var elements: [[String: Any]] = []

    func visit(_ node: [String: Any]) {
        var flat = node
        let children = flat.removeValue(forKey: "children")
        elements.append(flat)

        if let childNodes = children as? [[String: Any]] {
            for child in childNodes {
                visit(child)
            }
        }
    }

    visit(root)
    return elements
}

func appState(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 70, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for app state"])
    }
    let pid = params?["pid"]?.int ?? Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0)
    if pid <= 0 {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 71, userInfo: [NSLocalizedDescriptionKey: "pid is required when there is no frontmost app"])
    }
    let maxDepth = max(0, min(params?["maxDepth"]?.int ?? 2, 5))
    let maxChildren = max(1, min(params?["maxChildren"]?.int ?? 30, 200))
    let element = AXUIElementCreateApplication(pid_t(pid))
    let refs = AXRefBuilder()
    let tree = axNode(element, depth: 0, maxDepth: maxDepth, maxChildren: maxChildren, refs: refs)
    return [
        "snapshotId": "snap-\(UUID().uuidString)",
        "pid": pid,
        "windows": listWindows(pid: pid),
        "accessibilityTree": tree,
        "elements": flattenAXTree(tree)
    ]
}

func appSummary(_ app: NSRunningApplication?) -> [String: Any] {
    guard let app else { return [:] }
    return [
        "pid": Int(app.processIdentifier),
        "name": app.localizedName ?? "",
        "bundleId": app.bundleIdentifier ?? "",
        "active": app.isActive,
        "hidden": app.isHidden,
        "terminated": app.isTerminated
    ]
}

func snapshotWindow(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 85, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for snapshot_window"])
    }
    let pid = try requirePid(params: params)
    var snapshotParams = params ?? [:]
    snapshotParams["pid"] = AnyCodable(pid)
    let window = try targetWindowInfo(params: snapshotParams)
    if let windowId = window["windowId"] as? Int {
        snapshotParams["windowId"] = AnyCodable(windowId)
    }

    let maxDepth = max(0, min(params?["maxDepth"]?.int ?? 4, 8))
    let maxChildren = max(1, min(params?["maxChildren"]?.int ?? 80, 300))
    let element = AXUIElementCreateApplication(pid_t(pid))
    let refs = AXRefBuilder()
    let tree = axNode(element, depth: 0, maxDepth: maxDepth, maxChildren: maxChildren, refs: refs)

    return [
        "snapshotId": "snap-\(UUID().uuidString)",
        "pid": pid,
        "app": appSummary(NSRunningApplication(processIdentifier: pid_t(pid))),
        "window": window,
        "screenshot": try captureWindow(params: snapshotParams),
        "accessibilityTree": tree,
        "elements": flattenAXTree(tree)
    ]
}

func urlFromRaw(_ raw: String) -> URL? {
    if raw.contains("://") {
        return URL(string: raw)
    }
    return URL(fileURLWithPath: NSString(string: raw).expandingTildeInPath)
}

func appURLFromName(_ name: String) -> URL? {
    let expanded = NSString(string: name).expandingTildeInPath
    let direct = URL(fileURLWithPath: expanded)
    if direct.pathExtension == "app", FileManager.default.fileExists(atPath: direct.path) {
        return direct
    }

    let appName = name.hasSuffix(".app") ? name : "\(name).app"
    let candidates = [
        "/Applications/\(appName)",
        "\(NSHomeDirectory())/Applications/\(appName)",
        "/System/Applications/\(appName)"
    ]
    for candidate in candidates {
        if FileManager.default.fileExists(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }
    }
    return nil
}

func backgroundApplicationURL(params: [String: AnyCodable]?) -> URL? {
    if let bundle = params?["bundle"]?.string,
       let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) {
        return url
    }
    if let app = params?["app"]?.string,
       let runningURL = explicitRunningApp(params: params)?.bundleURL ?? appURLFromName(app) {
        return runningURL
    }
    if let raw = params?["url"]?.string ?? params?["text"]?.string,
       let url = urlFromRaw(raw),
       url.pathExtension == "app" {
        return url
    }
    return nil
}

func mergeIntentArgs(params: [String: AnyCodable]?) -> [String: AnyCodable] {
    var merged = params ?? [:]
    guard let args = params?["args"]?.value as? [String: Any] else { return merged }
    for (key, value) in args where merged[key] == nil {
        merged[key] = AnyCodable(value)
    }
    return merged
}

func openApplicationInBackground(_ url: URL) throws -> [String: Any] {
    if #available(macOS 10.15, *) {
        let focus = FocusPreserver(targetPid: nil, enabled: true)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false

        let semaphore = DispatchSemaphore(value: 0)
        var openedApp: NSRunningApplication?
        var openError: Error?
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
            openedApp = app
            openError = error
            semaphore.signal()
        }
        semaphore.wait()

        if let openError {
            throw openError
        }
        var target: [String: Any] = [
            "bundleId": openedApp?.bundleIdentifier ?? "",
            "active": openedApp?.isActive ?? false
        ]
        if let openedApp {
            target["pid"] = Int(openedApp.processIdentifier)
        }
        return [
            "performed": openedApp != nil,
            "method": "background_launch_services",
            "url": url.path,
            "target": target,
            "focusPreservation": focus.finish()
        ]
    }

    throw NSError(domain: "PiAgentComputerUseHelper", code: 91, userInfo: [NSLocalizedDescriptionKey: "background app launch requires macOS 10.15 or newer"])
}

func launchApplication(params: [String: AnyCodable]?) throws -> [String: Any] {
    guard let appURL = backgroundApplicationURL(params: params) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 92, userInfo: [NSLocalizedDescriptionKey: "launch requires an app bundle target via bundle, app, url, or text"])
    }
    if params?["background"]?.bool ?? true {
        return try openApplicationInBackground(appURL)
    }

    let opened = NSWorkspace.shared.open(appURL)
    let bundleId = Bundle(url: appURL)?.bundleIdentifier ?? ""
    let running = bundleId.isEmpty ? nil : NSWorkspace.shared.runningApplications.first {
        $0.bundleIdentifier == bundleId
    }
    var target: [String: Any] = [
        "bundleId": bundleId,
        "active": running?.isActive ?? false
    ]
    if let running { target["pid"] = Int(running.processIdentifier) }
    return [
        "performed": opened,
        "method": "launch_services",
        "url": appURL.path,
        "target": target
    ]
}

func performIntent(params: [String: AnyCodable]?) throws -> [String: Any] {
    guard let rawIntent = params?["intent"]?.string ?? params?["text"]?.string else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 93, userInfo: [NSLocalizedDescriptionKey: "intent is required"])
    }
    let intentName = rawIntent.lowercased().replacingOccurrences(of: "-", with: "_")
    let merged = mergeIntentArgs(params: params)
    var result: [String: Any]

    switch intentName {
    case "launch", "open_app", "activate_app":
        result = try launchApplication(params: merged)
    case "open_url", "open":
        result = try openURL(params: merged)
    default:
        throw NSError(domain: "PiAgentComputerUseHelper", code: 94, userInfo: [NSLocalizedDescriptionKey: "Unsupported intent: \(rawIntent). Supported intents: launch, open_url"])
    }

    result["intent"] = intentName
    return result
}

func openURL(params: [String: AnyCodable]?) throws -> [String: Any] {
    if params?["background"]?.bool == true {
        guard let appURL = backgroundApplicationURL(params: params) else {
            throw NSError(domain: "PiAgentComputerUseHelper", code: 90, userInfo: [NSLocalizedDescriptionKey: "open_url with background=true requires an app bundle target via bundle, app, or a file URL ending in .app"])
        }
        return try openApplicationInBackground(appURL)
    }
    guard let raw = params?["url"]?.string ?? params?["text"]?.string,
          let url = urlFromRaw(raw) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 86, userInfo: [NSLocalizedDescriptionKey: "url is required"])
    }
    let opened = NSWorkspace.shared.open(url)
    return ["performed": opened, "method": "launch_services", "url": raw]
}

func raiseWindow(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 87, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for raise_window"])
    }
    if params?["background"]?.bool == true {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 89, userInfo: [NSLocalizedDescriptionKey: "raise_window is a foreground action and is not allowed with background=true"])
    }
    let pid = try requirePid(params: params)
    let app = NSRunningApplication(processIdentifier: pid_t(pid))
    let element = AXUIElementCreateApplication(pid_t(pid))
    var raisedByAX = false
    var focusedWindow: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXFocusedWindowAttribute as CFString, &focusedWindow) == .success,
       let window = focusedWindow {
        raisedByAX = AXUIElementPerformAction(window as! AXUIElement, kAXRaiseAction as CFString) == .success
    }
    let activated = app?.activate(options: [.activateIgnoringOtherApps]) ?? false
    return [
        "performed": raisedByAX || activated,
        "method": raisedByAX ? "ax_raise" : "activate",
        "target": ["pid": pid],
        "activated": activated
    ]
}

let keyCodes: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "escape": 53, "esc": 53,
    "left": 123, "right": 124, "down": 125, "up": 126,
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
    "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28,
    "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
    "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47
]

func flagsFromModifiers(_ values: Any?) -> CGEventFlags {
    guard let array = values as? [Any] else { return [] }
    var flags = CGEventFlags()
    for value in array {
        switch String(describing: value) {
        case "cmd": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "option": flags.insert(.maskAlternate)
        case "ctrl": flags.insert(.maskControl)
        default: break
        }
    }
    return flags
}

func pressKey(params: [String: AnyCodable]?) throws -> [String: Any] {
    if !accessibilityTrusted() {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 40, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for key presses"])
    }
    guard let key = params?["key"]?.string?.lowercased(), let code = keyCodes[key] else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 41, userInfo: [NSLocalizedDescriptionKey: "Unsupported key"])
    }
    let source = CGEventSource(stateID: .hidSystemState)
    let flags = flagsFromModifiers(params?["modifiers"]?.value)
    let background = params?["background"]?.bool ?? false
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
        throw NSError(domain: "PiAgentComputerUseHelper", code: 42, userInfo: [NSLocalizedDescriptionKey: "Failed to create keyboard event"])
    }
    down.flags = flags
    up.flags = flags
    if background {
        let pid = try requireExplicitPid(params: params, purpose: "background press_key")
        let focus = FocusPreserver(targetPid: pid, enabled: true)
        SynthPost.post(down, to: pid_t(pid))
        SynthPost.post(up, to: pid_t(pid))
        return [
            "performed": true,
            "method": "background_keyboard",
            "key": key,
            "target": ["pid": pid],
            "focusPreservation": focus.finish(),
            "delivery": ["post": SynthPost.isAvailable ? "CGEventPostToPid" : "CGEvent.postToPid"]
        ]
    }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return ["performed": true, "method": "keyboard", "key": key]
}

func handle(_ request: Request) throws -> AnyCodable {
    switch request.method {
    case "doctor":
        return AnyCodable(doctor())
    case "request_permissions":
        return AnyCodable(requestPermissions())
    case "list_apps":
        return AnyCodable(listApps())
    case "list_windows":
        return AnyCodable(listWindows(pid: request.params?["pid"]?.int))
    case "screenshot":
        let displayId = request.params?["displayId"]?.int.map { CGDirectDisplayID($0) }
        return AnyCodable(try screenshot(displayId: displayId))
    case "snapshot_window":
        return AnyCodable(try snapshotWindow(params: request.params))
    case "capture_window":
        return AnyCodable(try captureWindow(params: request.params))
    case "get_app_state":
        return AnyCodable(try appState(params: request.params))
    case "click":
        return AnyCodable(try postClick(params: request.params))
    case "double_click":
        var params = request.params ?? [:]
        params["clickCount"] = AnyCodable(2)
        return AnyCodable(try postClick(params: params))
    case "right_click":
        var params = request.params ?? [:]
        params["button"] = AnyCodable("right")
        return AnyCodable(try postClick(params: params))
    case "drag":
        return AnyCodable(try drag(params: request.params))
    case "scroll":
        return AnyCodable(try scroll(params: request.params))
    case "set_value":
        return AnyCodable(try setValue(params: request.params))
    case "type_text":
        return AnyCodable(try typeText(params: request.params))
    case "press_key":
        return AnyCodable(try pressKey(params: request.params))
    case "intent":
        return AnyCodable(try performIntent(params: request.params))
    case "open_url":
        return AnyCodable(try openURL(params: request.params))
    case "raise_window":
        return AnyCodable(try raiseWindow(params: request.params))
    case "wait":
        let timeoutMs = max(0, min(request.params?["timeoutMs"]?.int ?? 1_000, 60_000))
        usleep(useconds_t(timeoutMs * 1_000))
        return AnyCodable(["performed": true, "method": "noop", "timeoutMs": timeoutMs])
    default:
        throw NSError(domain: "PiAgentComputerUseHelper", code: 99, userInfo: [NSLocalizedDescriptionKey: "Unsupported method: \(request.method)"])
    }
}

while let line = readLine(strippingNewline: true) {
    guard let data = line.data(using: .utf8) else { continue }
    do {
        let request = try decoder.decode(Request.self, from: data)
        let result = try handle(request)
        writeResponse(Response(id: request.id, result: result, error: nil))
    } catch {
        let id = (try? decoder.decode(Request.self, from: data).id) ?? 0
        writeResponse(Response(id: id, result: nil, error: error.localizedDescription))
    }
}
