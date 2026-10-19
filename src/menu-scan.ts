import type { PriceEntry } from './community';
import { t } from './i18n';
export type MenuScanResult = { entries: PriceEntry[]; added: number; unchanged: number; conflicts: number; skipped: number };

// Decode and re-encode locally: normalises phone orientation, removes EXIF/GPS,
// bounds upload size and retains enough resolution for menu columns.
export async function prepareMenuPhoto(file: File): Promise<{ data: string; mediaType: 'image/jpeg' }> {
  if (!file.type.startsWith('image/') || file.size > 30_000_000) throw new Error(t('Bitte ein Foto bis 30 MB auswählen.'));
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error(t('Dieses Bildformat kann der Browser nicht lesen. Bitte ein JPG-Foto auswählen oder direkt fotografieren.')); }
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(t('Das Foto konnte nicht gelesen werden.'));
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(2_000_000 / (image.naturalWidth * image.naturalHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t('Der Browser kann das Foto nicht vorbereiten.'));
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.9, .8, .7]) {
      const encoded = canvas.toDataURL('image/jpeg', quality);
      if (!encoded.startsWith('data:image/jpeg;base64,')) throw new Error(t('Der Browser kann das Foto nicht vorbereiten.'));
      const data = encoded.split(',')[1];
      if (data.length <= 2_600_000) return { data, mediaType: 'image/jpeg' };
    }
    throw new Error(t('Das Foto ist zu gross. Bitte einen kleineren Ausschnitt fotografieren.'));
  } finally { URL.revokeObjectURL(url); }
}
export function scanSummary(result: MenuScanResult): string {
  const parts = [result.added === 1 ? t('1 Preis gespeichert.') : result.added ? t('{count} Preise gespeichert.', { count: result.added }) : t('Keine neuen Preise gespeichert.')];
  if (result.unchanged) parts.push(t('{count} bereits vorhanden.', { count: result.unchanged }));
  if (result.conflicts) parts.push(t('{count} abweichende Preise ausgelassen; bestehende Preise kannst du unter «Ändern» korrigieren.', { count: result.conflicts }));
  if (result.skipped) parts.push(t('{count} unklare Zeilen ausgelassen.', { count: result.skipped }));
  return parts.join(' ');
}
