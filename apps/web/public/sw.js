// Service worker mínimo: só torna o app instalável. NÃO guarda nada em cache: cada loja pode estar numa versão diferente
// e um cache aqui poderia servir a versão errada ou dados velhos (cardápio, pedidos).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* repassa para a rede */ });
