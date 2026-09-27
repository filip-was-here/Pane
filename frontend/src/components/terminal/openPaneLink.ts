import { parsePaneLink } from './paneLink';

export async function openPaneLink(uri: string): Promise<void> {
  if (!parsePaneLink(uri)) return;
  const result: { success: boolean; error?: string } = await window.electronAPI.invoke('runpane:links:open', uri);
  if (!result.success) throw new Error(result.error ?? 'Failed to open Pane link');
}
