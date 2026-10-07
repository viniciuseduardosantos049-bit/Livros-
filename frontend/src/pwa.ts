/**
 * Registro do service worker e os sinais que a interface precisa: atualização
 * disponível, aparelho offline e convite de instalação.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const EVENTO_ATUALIZACAO = 'pwa:atualizacao';
export const EVENTO_INSTALAVEL = 'pwa:instalavel';

let registro: ServiceWorkerRegistration | null = null;
let promptInstalacao: BeforeInstallPromptEvent | null = null;

export function registrarServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        registro = reg;

        // Versão nova baixada enquanto o app está aberto.
        reg.addEventListener('updatefound', () => {
          const novo = reg.installing;
          if (!novo) return;
          novo.addEventListener('statechange', () => {
            if (novo.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent(EVENTO_ATUALIZACAO));
            }
          });
        });
      })
      .catch((erro) => console.warn('[pwa] service worker não registrado:', erro));
  });

  // Recarrega uma única vez quando o worker novo assume.
  let recarregando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregando) return;
    recarregando = true;
    window.location.reload();
  });
}

export function aplicarAtualizacao(): void {
  registro?.waiting?.postMessage('ATUALIZAR_AGORA');
}

/** Chamado no logout: as respostas da API não podem sobreviver à troca de usuário. */
export function limparDadosOffline(): void {
  navigator.serviceWorker?.controller?.postMessage('LIMPAR_DADOS');
}

export function capturarConviteDeInstalacao(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptInstalacao = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent(EVENTO_INSTALAVEL));
  });

  window.addEventListener('appinstalled', () => {
    promptInstalacao = null;
    window.dispatchEvent(new CustomEvent(EVENTO_INSTALAVEL));
  });
}

export function podeInstalar(): boolean {
  return promptInstalacao !== null;
}

export async function instalar(): Promise<boolean> {
  if (!promptInstalacao) return false;
  await promptInstalacao.prompt();
  const { outcome } = await promptInstalacao.userChoice;
  promptInstalacao = null;
  window.dispatchEvent(new CustomEvent(EVENTO_INSTALAVEL));
  return outcome === 'accepted';
}

/** true quando o app está rodando instalado (fora da aba do navegador). */
export function rodandoInstalado(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS não implementa display-mode: standalone em versões antigas
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function ehIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function ehAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

