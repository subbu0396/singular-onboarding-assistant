const MAX_SIZE_BYTES = 5 * 1024 * 1024;

const TEXT_EXTS = ['txt', 'md', 'html', 'htm', 'csv', 'eml'];
const PDF_EXTS = ['pdf'];
const UNSUPPORTED_BINARY_EXTS = ['doc', 'docx'];

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize)
    );
  }
  return btoa(binary);
}

export async function readUploadedFile(file) {
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error('File is too large. Maximum size is 5MB.');
  }

  const ext = file.name.split('.').pop().toLowerCase();

  if (TEXT_EXTS.includes(ext)) {
    const text = await file.text();
    if (text.trim().length < 50) {
      throw new Error('Document is too short or empty.');
    }
    return { kind: 'text', text };
  }

  if (PDF_EXTS.includes(ext)) {
    const base64 = await fileToBase64(file);
    return { kind: 'base64', base64, mediaType: 'application/pdf' };
  }

  if (UNSUPPORTED_BINARY_EXTS.includes(ext)) {
    throw new Error(
      `${ext.toUpperCase()} files are not supported directly. Please save the document as PDF and re-upload.`
    );
  }

  throw new Error(
    `Unsupported file type .${ext}. Upload a .txt, .md, .pdf, .html, .csv, or .eml file.`
  );
}
