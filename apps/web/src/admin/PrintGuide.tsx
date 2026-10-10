import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Download, ExternalLink, Plug, Printer, Route } from 'lucide-react';
import { get } from '@/lib/api';
import { cx } from '@/ui/kit';

interface Info { available: boolean; sizeBytes: number; updatedAt: string | null; exe?: boolean }
export interface GuideData { agents: number; agentsOnline: number; printers: number; zonesTotal: number; zonesWithoutPrinter: number }

const FILES = [
  { file: 'pediu-agent.mjs', label: 'O agente', hint: 'o programa em si' },
  { file: 'iniciar-agente-windows.bat', label: 'Iniciar no Windows', hint: 'dois cliques para abrir' },
  { file: 'iniciar-agente-linux-mac.sh', label: 'Iniciar no Linux/Mac', hint: 'se não for Windows' },
];

/** Zona de download do agente. Windows: um .exe (traz tudo dentro). Outros sistemas: o agente + um script de início (pede o Node.js). */
export function AgentDownload({ compact }: { compact?: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => { void get<Info>('/v1/downloads/agent.json').then(setInfo).catch(() => setInfo({ available: false, sizeBytes: 0, updatedAt: null })); }, []);
  const manual = (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
        <li>Instale o <b className="text-foreground">Node.js</b> (versão LTS) no computador das impressoras: <a className="font-medium text-primary hover:underline" href="https://nodejs.org" target="_blank" rel="noopener noreferrer">nodejs.org <ExternalLink size={11} className="inline" /></a></li>
        <li>Baixe os arquivos abaixo e coloque os dois juntos em uma pasta, por exemplo <code>C:\PediuAgente</code>.</li>
        <li>Dê dois cliques em <b className="text-foreground">iniciar-agente-windows.bat</b> (ou o <code>.sh</code> no Linux/Mac). A tela do agente abre no navegador.</li>
      </ol>
      <div className="grid gap-2 sm:grid-cols-3">
        {FILES.map((f) => (
          <a key={f.file} href={info?.available ? `/v1/downloads/${f.file}` : undefined} download={f.file} aria-disabled={!info?.available}
            className={cx('flex items-center gap-2.5 rounded-ui-sm border border-border p-3 transition', info?.available ? 'hover:bg-muted' : 'pointer-events-none opacity-50')}>
            <Download size={18} className="shrink-0 text-primary" aria-hidden />
            <span className="min-w-0"><b className="block truncate">{f.label}</b><span className="block truncate text-xs text-muted-foreground">{f.hint}</span></span>
          </a>
        ))}
      </div>
    </div>
  );
  return (
    <div className="space-y-3 text-sm">
      {!compact && <p>O <b>Pediu Agente</b> é um programinha que fica ligado no computador onde as impressoras estão. Ele recebe os pedidos da loja e manda para a impressora certa.</p>}
      {info?.exe && (
        <div className="space-y-2">
          <a href="/v1/downloads/pediu-agente.exe" download="pediu-agente.exe" className="flex items-center gap-3 rounded-ui border-2 border-primary bg-primary/5 p-3.5 transition hover:bg-primary/10">
            <Download size={22} className="shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1"><b className="block">Baixar para Windows (pediu-agente.exe)</b><span className="block text-xs text-muted-foreground">Recomendado · não precisa instalar mais nada · cerca de 90 MB</span></span>
          </a>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Copie o <b className="text-foreground">pediu-agente.exe</b> para o computador das impressoras (ex.: <code>C:\PediuAgente</code>).</li>
            <li>Dê dois cliques. A tela do agente abre no navegador.</li>
            <li>Se o Windows avisar “protegeu o computador”, clique em <b className="text-foreground">Mais informações › Executar assim mesmo</b> (o arquivo ainda não tem assinatura digital).</li>
          </ol>
        </div>
      )}
      {info && !info.available && !info.exe && <p className="rounded-ui-sm bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">O agente ainda não foi preparado neste servidor. Fale com o suporte da PediuLanchou.</p>}
      {info?.exe ? <details className="rounded-ui-sm border border-border p-3"><summary className="cursor-pointer font-medium">Outro jeito: Linux, Mac ou com o Node.js</summary><div className="mt-3">{manual}</div></details> : manual}
    </div>
  );
}

/** Passo a passo da impressão: mostra onde a loja está e o que falta, sem jargão. */
export function PrintGuide({ d, onPair }: { d: GuideData; onPair: () => void }) {
  const steps = [
    { id: 1, icon: Download, title: 'Instalar o agente no computador das impressoras', done: d.agents > 0, help: 'Baixe e abra o agente. Ele é quem conversa com as impressoras.' },
    { id: 2, icon: Plug, title: 'Conectar o agente à sua loja', done: d.agents > 0, help: 'Um código de 6 dígitos liga o computador à loja. Só precisa fazer uma vez: depois fica sempre conectado.' },
    { id: 3, icon: Printer, title: 'Puxar as impressoras do computador', done: d.printers > 0, help: 'O agente mostra as impressoras que o computador enxerga e você cadastra com um clique.' },
    { id: 4, icon: Route, title: 'Dizer qual zona imprime em qual impressora', done: d.zonesTotal > 0 && d.zonesWithoutPrinter === 0 && d.printers > 0, help: 'Zona é um setor (cozinha, bar, caixa). Cada categoria do cardápio vai para uma zona, e cada zona para uma impressora.' },
  ];
  const current = steps.find((s) => !s.done)?.id ?? 0;
  const finished = current === 0;
  return (
    <section className="card mb-5 p-4" aria-labelledby="guide-title">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="guide-title" className="font-semibold">{finished ? 'Impressão configurada' : 'Configure a impressão em 4 passos'}</h2>
        <span className="badge bg-muted text-muted-foreground">{steps.filter((s) => s.done).length} de {steps.length}</span>
        {d.agents > 0 && <span className={cx('badge', d.agentsOnline > 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>{d.agentsOnline > 0 ? 'agente conectado' : 'agente desconectado'}</span>}
      </div>
      <ol className="space-y-2">
        {steps.map((s) => {
          const open = s.id === current;
          return (
            <li key={s.id} className={cx('rounded-ui-sm border p-3', open ? 'border-primary/50 bg-primary/5' : 'border-border')}>
              <div className="flex items-start gap-2.5">
                {s.done ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-green-600" aria-label="feito" /> : <Circle size={20} className={cx('mt-0.5 shrink-0', open ? 'text-primary' : 'text-muted-foreground')} aria-label="a fazer" />}
                <div className="min-w-0 flex-1">
                  <div className={cx('font-medium', s.done && 'text-muted-foreground')}>{s.id}. {s.title}</div>
                  {(open || !s.done) && <p className="mt-0.5 text-sm text-muted-foreground">{s.help}</p>}
                  {open && s.id === 1 && (
                    <div className="mt-3 space-y-3">
                      <AgentDownload compact />
                      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                        <button className="btn" onClick={onPair}><Plug size={14} /> Já abri o agente: gerar código de pareamento</button>
                        <span className="text-xs text-muted-foreground">Você digita o código na tela do agente (passo 2).</span>
                      </div>
                    </div>
                  )}
                  {open && s.id === 3 && <p className="mt-2 text-sm">Na lista <b>Agentes de impressão</b> abaixo, clique em <b>Puxar impressoras</b>.</p>}
                  {open && s.id === 4 && <p className="mt-2 text-sm">Na seção <b>Zonas de impressão</b> abaixo, clique em <b>Escolher impressoras</b> em cada zona{d.zonesWithoutPrinter > 0 ? ` (faltam ${d.zonesWithoutPrinter})` : ''}.</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {d.agents > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Baixar o agente de novo (outro computador)</summary><div className="mt-3"><AgentDownload compact /></div></details>}
    </section>
  );
}
