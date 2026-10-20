// US-M06-06 — photo de travaux compressée avant stockage local : 1600 px maximum, WebP.
const MAX_SIDE = 1600;

export async function compressPhoto(
  file: Blob,
): Promise<{ mimeType: "image/webp" | "image/jpeg"; dataBase64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let dataUrl = canvas.toDataURL("image/webp", 0.8);
  let mimeType: "image/webp" | "image/jpeg" = "image/webp";
  // Navigateur sans encodeur WebP : repli JPEG.
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    mimeType = "image/jpeg";
  }
  return { mimeType, dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}
