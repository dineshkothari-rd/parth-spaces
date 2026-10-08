import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export async function shareCsv({ fileName, csv, title }: { fileName: string; csv: string; title: string }) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('CSV sharing requires a supported Android or iOS device.');
  }
  const report = new File(Paths.cache, fileName);
  if (report.exists) report.delete();
  report.create();
  report.write(csv);
  await Sharing.shareAsync(report.uri, { dialogTitle: title, mimeType: 'text/csv' });
}

export async function downloadPdf({ fileName, html, title }: { fileName: string; html: string; title: string }) {
  const { uri } = await Print.printToFileAsync({ base64: false, html });
  const generatedFile = new File(uri);
  const namedFile = new File(Paths.cache, fileName);

  if (namedFile.exists) namedFile.delete();
  generatedFile.copy(namedFile);

  if (!(await Sharing.isAvailableAsync())) {
    await Print.printAsync({ uri: namedFile.uri });
    return;
  }

  await Sharing.shareAsync(namedFile.uri, {
    dialogTitle: title,
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  });
}
