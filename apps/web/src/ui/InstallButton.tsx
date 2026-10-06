import { useState } from 'react';
import { Download, Share, SquarePlus } from 'lucide-react';
import { useInstall } from '@/lib/pwa';
import { Modal } from './kit';

/** "Instalar app": prompt nativo quando disponível; no iOS mostra o passo a passo. */
export function InstallButton({ className = '', label = 'Instalar app' }: { className?: string; label?: string }) {
  const { canPrompt, showIOSHelp, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (!canPrompt && !showIOSHelp) return null;
  return (
    <>
      <button className={className} onClick={() => (canPrompt ? install() : setHelp(true))}><Download size={14} /> {label}</button>
      <Modal open={help} onClose={() => setHelp(false)} title="Instalar no iPhone / iPad">
        <ol className="space-y-3 text-sm">
          <li className="flex items-center gap-2">1. Toque em <Share size={16} /> <b>Compartilhar</b> na barra do Safari.</li>
          <li className="flex items-center gap-2">2. Escolha <SquarePlus size={16} /> <b>Adicionar à Tela de Início</b>.</li>
          <li>3. Confirme em <b>Adicionar</b>. O app abre em tela cheia e funciona offline.</li>
        </ol>
      </Modal>
    </>
  );
}
