import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useWorkbench } from './useWorkbench';
import './styles.css';

function Root() {
  const workbench = useWorkbench();

  return (
    <App
      snapshot={workbench.snapshot}
      sessions={workbench.sessions}
      activeSessionId={workbench.activeSessionId}
      queuedAttachmentIds={workbench.queuedAttachmentIds}
      uploadItems={workbench.uploadItems}
      health={workbench.health}
      onPromptSubmit={workbench.onPromptSubmit}
      onApprove={workbench.onApprove}
      onAttachFiles={workbench.onAttachFiles}
      onRemoveAttachment={workbench.onRemoveAttachment}
      onQueueAttachment={workbench.onQueueAttachment}
      onUnqueueAttachment={workbench.onUnqueueAttachment}
      onNewSession={workbench.onNewSession}
      onSelectSession={workbench.onSelectSession}
      onDeleteSession={workbench.onDeleteSession}
      onCancelTurn={workbench.onCancelTurn}
      isBooting={workbench.isBooting}
      error={workbench.error}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
