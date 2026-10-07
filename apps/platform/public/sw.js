// Service worker mínimo: só torna o super admin instalável. NÃO guarda nada em cache (dados sensíveis e sempre atuais).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* repassa para a rede */ });
