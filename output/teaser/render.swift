import AppKit

let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let source = NSImage(contentsOf: folder.appendingPathComponent("wobillig-screenshot.png"))!
var sourceRect = CGRect(origin: .zero, size: source.size)
// Source is the product-only screenshot, without browser chrome.
let crop = source.cgImage(forProposedRect: &sourceRect, context: nil, hints: nil)!

let canvas = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2400, pixelsHigh: 1680, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: canvas)
let context = NSGraphicsContext.current!.cgContext
context.setFillColor(CGColor(red: 0.96, green: 0.957, blue: 0.945, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 2400, height: 1680))
let x: CGFloat = 130, width: CGFloat = 2140
let height = width * 1532 / 2204
let imageRect = CGRect(x: x, y: 40, width: width, height: height)
context.setShadow(offset: CGSize(width: 0, height: -5), blur: 18, color: CGColor(gray: 0, alpha: 0.10))
context.draw(crop, in: imageRect)
context.setShadow(offset: .zero, blur: 0, color: nil)
context.setStrokeColor(CGColor(gray: 0.8, alpha: 1))
context.setLineWidth(1)
context.stroke(imageRect)
let ink = NSColor(calibratedWhite: 0.13, alpha: 1)
("wobillig.ch" as NSString).draw(at: NSPoint(x: 130, y: 1570), withAttributes: [.font: NSFont.systemFont(ofSize:  64, weight: .bold), .foregroundColor: ink])
let subtitle = "Zürich · Bern · Basel" as NSString
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 29, weight: .regular), .foregroundColor: NSColor(calibratedWhite: 0.4, alpha: 1)]
subtitle.draw(at: NSPoint(x: 2270 - subtitle.size(withAttributes: attrs).width, y: 1588), withAttributes: attrs)
NSGraphicsContext.restoreGraphicsState()
try canvas.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent("wobillig-teaser.png"))
try canvas.representation(using: .jpeg, properties: [.compressionFactor: 0.92])!.write(to: folder.appendingPathComponent("wobillig-teaser.jpg"))

