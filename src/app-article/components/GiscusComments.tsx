import React, { useEffect, useRef } from 'react';

interface GiscusCommentsProps {
  pageId: string;
}

const GiscusComments: React.FC<GiscusCommentsProps> = ({ pageId }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Remove existing giscus script if any
    const existingScript = document.querySelector('script[src*="giscus"]');
    if (existingScript) {
      existingScript.remove();
    }

    // Clear existing comments
    if (ref.current) {
      ref.current.innerHTML = '';
    }

    // Create and append new giscus script
    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.setAttribute('data-repo', 'ceane/n-apt');
    script.setAttribute('data-repo-id', 'R_kgDOGL4q9A');
    script.setAttribute('data-category', 'General');
    script.setAttribute('data-category-id', 'DIC_kwDOGL4q9M4CZ_6f');
    script.setAttribute('data-mapping', 'specific');
    script.setAttribute('data-term', pageId);
    script.setAttribute('data-strict', '0');
    script.setAttribute('data-reactions-enabled', '1');
    script.setAttribute('data-emit-metadata', '0');
    script.setAttribute('data-input-position', 'bottom');
    script.setAttribute('data-theme', 'preferred_color_scheme');
    script.setAttribute('data-lang', 'en');
    script.setAttribute('data-loading', 'lazy');
    script.setAttribute('crossorigin', 'anonymous');
    script.async = true;

    if (ref.current) {
      ref.current.appendChild(script);
    }

    return () => {
      // Cleanup on unmount
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [pageId]);

  return (
    <div 
      ref={ref} 
      style={{ 
        marginTop: '3rem', 
        paddingTop: '2rem', 
        borderTop: '1px solid #374151' 
      }}
    />
  );
};

export default GiscusComments;
