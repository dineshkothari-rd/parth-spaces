export async function shareCsv({ fileName, csv }: { fileName: string; csv: string; title: string }) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to consume the download before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadPdf({ fileName, html }: { fileName: string; html: string; title: string }) {
  const preview = window.open('', '_blank');
  if (!preview) throw new Error('Allow pop-ups to print or save this document as PDF.');
  preview.opener = null;
  preview.document.write(html);
  preview.document.title = fileName.replace(/\.pdf$/i, '');
  preview.onload = () => { preview.focus(); preview.print(); };
  preview.document.close();
}
