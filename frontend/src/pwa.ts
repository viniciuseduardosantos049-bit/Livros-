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

/** O navegador tem tudo que a inscrição de push precisa (Safari no iPhone não tem, por exemplo). */
export function suportaPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** A VAPID key vem em base64url; a Push API exige um Uint8Array. */
function paraUint8Array(base64url: string): Uint8Array {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = window.atob(base64);
  return Uint8Array.from([...bruto].map((c) => c.charCodeAt(0)));
}

export interface StatusPush {
  suportado: boolean;
  /** Permissão do navegador: 'granted' | 'denied' | 'default'. */
  permissao: NotificationPermission;
  inscrito: boolean;
}

/**
 * `serviceWorker.ready` só resolve quando existe um worker ativo — se o registro
 * falhou ou ainda não aconteceu, a promessa nunca resolve. Sem um prazo aqui,
 * qualquer tela que consulte o status do push trava em "carregando" para sempre.
 */
function prontoComPrazo(prazoMs: number): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), prazoMs)),
  ]);
}

export async function statusPush(): Promise<StatusPush> {
  if (!suportaPush()) return { suportado: false, permissao: 'denied', inscrito: false };
  const registro = await prontoComPrazo(1500);
  if (!registro) return { suportado: true, permissao: Notification.permission, inscrito: false };
  const inscricao = await registro.pushManager.getSubscription();
  return { suportado: true, permissao: Notification.permission, inscrito: inscricao !== null };
}

/** Pede permissão, assina o push no navegador e manda a inscrição para o backend salvar. */
export async function ativarLembretes(chavePublica: string): Promise<boolean> {
  if (!suportaPush()) return false;

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return false;

  const registro = await prontoComPrazo(8000);
  if (!registro) throw new Error('O service worker não respondeu a tempo.');
  const inscricao = await registro.pushManager.subscribe({
    userVisibleOnly: true,
    // TS tipa applicationServerKey como BufferSource<ArrayBuffer>, mais estrito
    // que o Uint8Array<ArrayBufferLike> que o helper devolve; o valor é válido.
    applicationServerKey: paraUint8Array(chavePublica) as BufferSource,
  });

  const json = inscricao.toJSON() as { endpoint: string; keys?: { p256dh: string; auth: string } };
  if (!json.keys) throw new Error('Inscrição de push sem chaves — navegador incompatível.');

  await fetch('/api/push/inscrever', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });

  return true;
}

/** Cancela no navegador e avisa o backend, para não guardar uma inscrição morta. */
export async function desativarLembretes(): Promise<void> {
  if (!suportaPush()) return;
  const registro = await prontoComPrazo(3000);
  if (!registro) return;
  const inscricao = await registro.pushManager.getSubscription();
  if (!inscricao) return;

  await fetch('/api/push/cancelar', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: inscricao.endpoint }),
  }).catch(() => {});

  await inscricao.unsubscribe();
}

