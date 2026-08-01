/** Image MIME types accepted from the browser (aligns with Anthropic media_type). */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

/**
 * Validate an uploaded image. Returns an error message for the 400 response, or
 * null when it's fine. Providers cast the mimetype to their own media-type union
 * on the strength of this check, so every image route must run it.
 */
export function imageProblem(
  image: { mimetype: string; size: number },
  maxBytes: number,
): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(image.mimetype)) {
    return `unsupported image type: ${image.mimetype}`;
  }
  if (image.size > maxBytes) {
    return `image too large (max ${Math.round(maxBytes / (1024 * 1024))}MB)`;
  }
  return null;
}
