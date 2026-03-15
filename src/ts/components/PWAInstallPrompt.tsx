import React, { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallButton, setShowInstallButton] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowInstallButton(true);
    };

    const handleAppInstalled = () => {
      setShowInstallButton(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setShowInstallButton(false);
    }
    setDeferredPrompt(null);
  };

  if (!showInstallButton) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      backgroundColor: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '8px',
      padding: '16px',
      color: '#fff',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '14px',
      zIndex: 1000,
      maxWidth: '300px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
    }}>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
        🚀 Install N-APT
      </div>
      <div style={{ marginBottom: '12px', opacity: 0.8 }}>
        Add N-APT to your dock for quick access!
      </div>
      <button
        onClick={handleInstallClick}
        style={{
          backgroundColor: '#00d4ff',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 16px',
          color: '#000',
          fontFamily: 'inherit',
          fontSize: '12px',
          fontWeight: 'bold',
          cursor: 'pointer',
          width: '100%'
        }}
      >
        Add to Dock
      </button>
      <button
        onClick={() => setShowInstallButton(false)}
        style={{
          backgroundColor: 'transparent',
          border: 'none',
          color: '#666',
          fontFamily: 'inherit',
          fontSize: '11px',
          cursor: 'pointer',
          marginTop: '8px',
          width: '100%'
        }}
      >
        Dismiss
      </button>
    </div>
  );
};

export default PWAInstallPrompt;
