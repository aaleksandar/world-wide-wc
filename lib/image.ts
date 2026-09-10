/**
 * Shrinks a photo in the browser before it is uploaded.
 *
 * Phone photos are 2–12MB, and a toilet card does not need more than about a thousand
 * pixels across. Downscaling first makes the upload quick on the mobile connection people
 * will actually be standing on, keeps the IPFS object small enough to fetch instantly, and
 * strips EXIF as a side effect — which matters here, because EXIF carries the GPS location
 * of whoever took the picture.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

export async function shrinkImage(file: File): Promise<File> {
  // HEIC and anything the canvas cannot decode goes through untouched.
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    // Already small and already compressed: leave it alone.
    if (scale === 1 && file.size < 600_000) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    // Any decode failure just means we upload the original.
    return file;
  }
}
