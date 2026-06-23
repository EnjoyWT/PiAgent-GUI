import AppKit
import Foundation

final class EchoView: NSView {
    private var clickCount = 0
    private let formatter = ISO8601DateFormatter()

    override var acceptsFirstResponder: Bool {
        true
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        writeState()
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func mouseDown(with event: NSEvent) {
        clickCount += 1
        window?.title = "PiAgent EchoApp - clicks \(clickCount)"
        writeState()
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedRed: 0.08, green: 0.09, blue: 0.10, alpha: 1).setFill()
        bounds.fill()

        let targetRect = bounds.insetBy(dx: 42, dy: 42)
        let path = NSBezierPath(roundedRect: targetRect, xRadius: 8, yRadius: 8)
        NSColor(calibratedRed: 0.16, green: 0.44, blue: 0.80, alpha: 1).setFill()
        path.fill()

        let text = "Clicks: \(clickCount)\nPiAgent Echo Target"
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 28, weight: .semibold),
            .foregroundColor: NSColor.white,
            .paragraphStyle: paragraph
        ]
        let attributed = NSAttributedString(string: text, attributes: attributes)
        let size = attributed.size()
        attributed.draw(
            at: CGPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2)
        )
    }

    private func writeState() {
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("PiAgent")
            .appendingPathComponent("ComputerUseEcho")
        let url = directory.appendingPathComponent("state.json")
        let payload: [String: Any] = [
            "pid": Int(ProcessInfo.processInfo.processIdentifier),
            "clicks": clickCount,
            "updatedAt": formatter.string(from: Date())
        ]

        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(
                withJSONObject: payload,
                options: [.prettyPrinted, .sortedKeys]
            )
            try data.write(to: url, options: [.atomic])
        } catch {
            NSLog("PiAgent EchoApp failed to write state: \(error.localizedDescription)")
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSRect(x: 0, y: 0, width: 520, height: 320)
        let view = EchoView(frame: frame)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "PiAgent EchoApp - clicks 0"
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
