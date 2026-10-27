const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 6000;
const MIN_DIMENSION = 16;

function readJpegDimensions(data: Buffer) {
  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) throw new Error("Invalid JPEG data.");
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5), extension: "jpg", mimeType: "image/jpeg" };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions could not be read.");
}

export function validateLogoUpload(data: Buffer, declaredMimeType: string) {
  if (!data.length || data.length > MAX_LOGO_BYTES) throw new Error("Logo files must be between 1 byte and 5 MB.");
  let info: { width: number; height: number; extension: string; mimeType: string };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    info = { width: data.readUInt32BE(16), height: data.readUInt32BE(20), extension: "png", mimeType: "image/png" };
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    info = readJpegDimensions(data);
  } else {
    throw new Error("Only PNG and JPEG company logos are accepted for secure PDF rendering.");
  }
  if (declaredMimeType && declaredMimeType !== info.mimeType) throw new Error("The logo MIME type does not match its file content.");
  if (info.width < MIN_DIMENSION || info.height < MIN_DIMENSION || info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    throw new Error(`Logo dimensions must be between ${MIN_DIMENSION}px and ${MAX_DIMENSION}px.`);
  }
  return info;
}
