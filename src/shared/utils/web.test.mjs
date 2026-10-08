import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, globals) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const context = { exports: {}, ...globals };
  vm.runInNewContext(outputText, context);
  return context.exports;
}

function documentFixture() {
  const elements = [];
  const document = {
    createElement(tag) {
      const element = {
        tag, children: [], style: {}, attributes: {}, removed: false,
        append(...children) { this.children.push(...children); },
        setAttribute(key, value) { this.attributes[key] = value; },
        remove() { this.removed = true; },
        close() { this.closed = true; },
        showModal() { this.opened = true; },
        click() { this.clicked = true; this.onclick?.(); },
      };
      elements.push(element);
      return element;
    },
    body: { append() {} },
  };
  return { document, elements };
}

test('web dialogs preserve multi-action choices, cancellation and safe text', () => {
  const fixture = documentFixture();
  const { Alert } = load('./alert.web.ts', fixture);
  let selected = '';
  const title = '<img src=x onerror=alert(1)>';
  Alert.alert(title, 'Choose a photo', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Camera', onPress: () => { selected = 'camera'; } },
    { text: 'Library', onPress: () => { selected = 'library'; } },
  ]);
  const dialog = fixture.elements[0];
  assert.equal(dialog.attributes['aria-label'], title);
  assert.equal(dialog.children[0].textContent, title);
  assert.equal(dialog.opened, true);
  const buttons = dialog.children[2].children;
  buttons[0].click();
  assert.equal(selected, '');
  Alert.alert('Photo', '', [{ text: 'Library', onPress: () => { selected = 'library'; } }]);
  fixture.elements.at(-1).click();
  assert.equal(selected, 'library');
  let dismissed = false;
  Alert.alert('Confirm', '', undefined, { cancelable: false, onDismiss: () => { dismissed = true; } });
  let prevented = false;
  fixture.elements.filter((element) => element.tag === 'dialog').at(-1).oncancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(dismissed, false);
});

test('CSV downloads preserve content and release the temporary URL after the click', async () => {
  const fixture = documentFixture();
  let blob;
  let revoke;
  let timeout;
  const { shareCsv } = load('./exportFile.web.ts', {
    ...fixture, Blob,
    URL: { createObjectURL(value) { blob = value; return 'blob:report'; }, revokeObjectURL(value) { revoke = value; } },
    setTimeout(callback) { timeout = callback; },
  });
  await shareCsv({ fileName: 'dues.csv', csv: 'name,amount\nDemo,100', title: 'Dues' });
  const link = fixture.elements[0];
  assert.equal(link.download, 'dues.csv');
  assert.equal(link.clicked, true);
  assert.equal(link.removed, true);
  assert.equal(await blob.text(), 'name,amount\nDemo,100');
  assert.equal(revoke, undefined);
  timeout();
  assert.equal(revoke, 'blob:report');
});

test('PDF prints the supplied document separately and reports blocked popups', async () => {
  const popup = { opener: {}, focus() {}, print() { this.printed = true; } };
  popup.document = { write(html) { this.html = html; popup.onload = undefined; }, close() { popup.onload?.(); } };
  let blocked = false;
  const { downloadPdf } = load('./exportFile.web.ts', { window: { open() { return blocked ? null : popup; } } });
  await downloadPdf({ fileName: 'receipt.pdf', html: '<h1>Receipt 100</h1>', title: 'Receipt' });
  assert.equal(popup.opener, null);
  assert.equal(popup.document.html, '<h1>Receipt 100</h1>');
  assert.equal(popup.document.title, 'receipt');
  assert.equal(popup.printed, true);
  blocked = true;
  await assert.rejects(downloadPdf({ fileName: 'receipt.pdf', html: '', title: 'Receipt' }), /Allow pop-ups/);
});
