import { useEffect, useState } from 'react';

interface FileLocation {
  sessionId: string;
  filePath: string;
}

export function FilePreviewNotice({ sessionId, filePath, message }: FileLocation & { message: string }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const act = async (action: 'open' | 'reveal') => {
    try {
      await window.electronAPI.invoke('file:preview-action', { sessionId, filePath }, action);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to open file');
    }
  };
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-6 bg-surface-primary text-text-secondary">
      <p role="status">{message}</p>
      <div className="flex flex-wrap gap-3">
        <button className="px-3 py-2 rounded bg-surface-secondary text-text-primary hover:bg-surface-tertiary" onClick={() => void act('open')}>Open with system app</button>
        <button className="px-3 py-2 rounded bg-surface-secondary text-text-primary hover:bg-surface-tertiary" onClick={() => void act('reveal')}>Reveal in folder</button>
      </div>
      {actionError && <p role="alert" className="text-status-error">{actionError}</p>}
    </div>
  );
}

export function MediaFilePreview({ sessionId, filePath, kind, fileName }: FileLocation & { kind: 'video' | 'audio'; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loop, setLoop] = useState(false);
  const [resolution, setResolution] = useState('');
  useEffect(() => {
    let disposed = false;
    let source: string | null = null;
    const release = (value: string) => {
      void window.electronAPI.invoke('file:release-media-preview', value).catch(() => {});
    };
    void window.electronAPI.invoke('file:media-preview', { sessionId, filePath }).then((value: string) => {
      if (disposed) release(value);
      else { source = value; setUrl(value); }
    }).catch((reason: Error) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : 'Unable to load media');
    });
    return () => { disposed = true; if (source) release(source); };
  }, [sessionId, filePath]);

  if (error) return <FilePreviewNotice sessionId={sessionId} filePath={filePath} message={error} />;
  if (!url) return <div role="status" className="p-6 text-text-secondary">Loading media…</div>;
  const properties = {
    src: url, controls: true, loop, preload: 'metadata',
    onError: () => setError("Can't preview this codec or media file. Try opening it with a system app."),
    'aria-label': fileName,
  };
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-4 bg-surface-primary text-text-primary">
      {kind === 'video' ? (
        <video {...properties} className="w-full min-h-0 flex-1 object-contain" onLoadedMetadata={event => {
          const video = event.currentTarget;
          if (video.videoWidth) setResolution(`${video.videoWidth} × ${video.videoHeight}`);
        }} />
      ) : <audio {...properties} className="w-full max-w-xl" />}
      <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
        <span className="break-all">{fileName}</span>
        {resolution && <span className="text-text-secondary">{resolution}</span>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />Loop</label>
      </div>
    </div>
  );
}
