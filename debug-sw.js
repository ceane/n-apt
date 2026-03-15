// Service Worker Debug Script
// Run this in the browser console to debug service worker issues

function debugServiceWorker() {
  console.log('=== Service Worker Debug ===');
  
  // Check support
  if (!('serviceWorker' in navigator)) {
    console.error('❌ Service Worker not supported');
    return;
  }
  console.log('✅ Service Worker supported');
  
  // Check registration
  navigator.serviceWorker.getRegistration().then(registration => {
    if (registration) {
      console.log('✅ Service Worker registered:', registration.scope);
      console.log('Active:', registration.active);
      console.log('Installing:', registration.installing);
      console.log('Waiting:', registration.waiting);
      
      // Check if service worker is controlling the page
      if (navigator.serviceWorker.controller) {
        console.log('✅ Service Worker is controlling the page');
      } else {
        console.log('⚠️ Service Worker is not controlling the page');
      }
    } else {
      console.log('⚠️ No Service Worker registration found');
    }
  }).catch(error => {
    console.error('❌ Error getting registration:', error);
  });
  
  // Check caches
  if ('caches' in window) {
    caches.keys().then(cacheNames => {
      console.log('📦 Available caches:', cacheNames);
      cacheNames.forEach(cacheName => {
        caches.open(cacheName).then(cache => {
          cache.keys().then(requests => {
            console.log(`📄 Cache "${cacheName}" contains ${requests.length} items:`, requests.map(r => r.url));
          });
        });
      });
    }).catch(error => {
      console.error('❌ Error checking caches:', error);
    });
  }
  
  console.log('=== End Debug ===');
}

// Auto-run debug
debugServiceWorker();

// Also run when service worker state changes
navigator.serviceWorker.addEventListener('controllerchange', debugServiceWorker);
