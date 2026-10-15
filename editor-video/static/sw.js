// Service worker do app CorteFácil. Não guarda nada em cache de propósito: o programa
// sempre abre na versão mais nova (atualizações chegam na hora) e os vídeos vêm do servidor.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
