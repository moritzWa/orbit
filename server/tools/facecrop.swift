// Crops an image to a square avatar centred on the largest detected face.
//
//   swiftc -O -o facecrop facecrop.swift
//   ./facecrop in.jpg out.jpg [size]
//
// Wikipedia lead images are mostly conference and red-carpet shots where the
// subject is small and off-centre. A plain centre crop puts a shoulder in the
// avatar, so find the face with Vision and frame it the way a profile picture
// would be. Exits 1 when no face is found, leaving the caller to fall back.

import CoreImage
import Foundation
import Vision

/// How much of the crop's height the face box should take up. Portraits look
/// right at roughly a third; tighter than that reads as a mugshot.
let faceHeightRatio: CGFloat = 0.38
/// Shift the crop up so the eyeline sits above centre, leaving room for chin
/// and shoulders rather than empty space overhead.
let verticalBias: CGFloat = 0.14

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: facecrop <in> <out> [size]\n".data(using: .utf8)!)
    exit(2)
}
let inputPath = args[1]
let outputPath = args[2]
let size = args.count > 3 ? (Int(args[3]) ?? 512) : 512

guard let image = CIImage(contentsOf: URL(fileURLWithPath: inputPath)) else {
    FileHandle.standardError.write("cannot read \(inputPath)\n".data(using: .utf8)!)
    exit(1)
}

let extent = image.extent
let request = VNDetectFaceRectanglesRequest()
let handler = VNImageRequestHandler(ciImage: image, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}

guard let faces = request.results, !faces.isEmpty else { exit(1) }

// Largest face wins: in a group shot that is nearly always the subject.
let face = faces.max { a, b in
    (a.boundingBox.width * a.boundingBox.height) < (b.boundingBox.width * b.boundingBox.height)
}!

// Vision normalises to the unit square with the origin at bottom-left, which
// matches CoreImage, so only scaling is needed.
let box = CGRect(
    x: extent.origin.x + face.boundingBox.origin.x * extent.width,
    y: extent.origin.y + face.boundingBox.origin.y * extent.height,
    width: face.boundingBox.width * extent.width,
    height: face.boundingBox.height * extent.height
)

var side = box.height / faceHeightRatio
side = min(side, min(extent.width, extent.height))

let faceCenterX = box.midX
let faceCenterY = box.midY
var originX = faceCenterX - side / 2
var originY = faceCenterY - side / 2 - side * verticalBias

// Keep the square inside the source rather than letting it hang off an edge.
originX = min(max(originX, extent.minX), extent.maxX - side)
originY = min(max(originY, extent.minY), extent.maxY - side)

let cropped = image.cropped(to: CGRect(x: originX, y: originY, width: side, height: side))
let scale = CGFloat(size) / side
let scaled = cropped
    .transformed(by: CGAffineTransform(translationX: -originX, y: -originY))
    .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    .cropped(to: CGRect(x: 0, y: 0, width: CGFloat(size), height: CGFloat(size)))

let context = CIContext()
guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { exit(1) }
do {
    try context.writeJPEGRepresentation(
        of: scaled,
        to: URL(fileURLWithPath: outputPath),
        colorSpace: colorSpace,
        options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92]
    )
} catch {
    FileHandle.standardError.write("write failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}
