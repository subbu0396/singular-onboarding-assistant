export async function readUploadedFile(file) {
  const maxSizeBytes = 5 * 1024 * 1024;

  if (file.size > maxSizeBytes) {
    throw new Error('File is too large. Maximum size is 5MB.');
  }

  const ext = file.name.split('.').pop().toLowerCase();
  const supportedExts = ['txt', 'md', 'pdf', 'doc', 'docx', 'eml', 'html', 'htm', 'csv'];

  if (!supportedExts.includes(ext)) {
    throw new Error(
      `Unsupported file type .${ext}. Upload a .txt, .md, .pdf, .doc, .docx, or .eml file.`
    );
  }

  if (['txt', 'md', 'html', 'htm', 'csv', 'eml'].includes(ext)) {
    return await file.text();
  }

  if (['pdf', 'doc', 'docx'].includes(ext)) {
    try {
      const text = await file.text();
      if (text.trim().length > 100) return text;
      throw new Error(
        'Could not extract text from this file. If it is a scanned PDF, please copy-paste the text instead.'
      );
    } catch {
      throw new Error('Could not read this file. Try saving it as .txt and uploading again.');
    }
  }

  throw new Error('Unsupported file format.');
}
