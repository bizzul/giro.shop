/** Notifiche brevi in basso (toast), dal browser: toast('Salvato · Titolo') o toast('Non salvato', 'error'). */
export type ToastTone = 'ok' | 'error' | 'info';

export function toast(text: string, tone: ToastTone = 'ok'): void {
  window.dispatchEvent(new CustomEvent('giro:toast', { detail: { text, tone } }));
}
