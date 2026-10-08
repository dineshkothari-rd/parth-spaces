import type { AlertButton, AlertOptions } from 'react-native';

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', title);
    dialog.style.cssText = 'box-sizing:border-box;width:min(440px,90vw);padding:24px;border:1px solid #DCE0E8;border-radius:16px;background:#fff;color:#151925;font:16px system-ui;box-shadow:0 20px 60px #0003';
    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.cssText = 'margin:0 0 12px;font-size:20px';
    const body = document.createElement('p');
    body.textContent = message || '';
    body.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:12px;margin-top:24px';
    const choices = buttons?.length ? buttons : [{ text: 'OK' }];
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.text || 'OK';
      button.style.cssText = `min-height:44px;padding:10px 16px;border:1px solid #DCE0E8;border-radius:8px;cursor:pointer;font:inherit;background:${choice.style === 'cancel' ? '#EEF1F7' : '#284DE8'};color:${choice.style === 'cancel' ? '#151925' : '#fff'}`;
      button.onclick = () => { dialog.close(); dialog.remove(); choice.onPress?.(); };
      actions.append(button);
    }
    dialog.oncancel = (event) => {
      if (options?.cancelable === false) { event.preventDefault(); return; }
      dialog.remove();
      options?.onDismiss?.();
    };
    dialog.append(heading, body, actions);
    document.body.append(dialog);
    dialog.showModal();
  },
};
