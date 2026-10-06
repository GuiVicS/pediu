import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Copy, Monitor, Pencil, Plug, Plus, Printer, RefreshCw, Save, Trash2, Unplug, X } from 'lucide-react';
import { del, get, post, put } from '@/lib/api';
import type { PrintZone } from '@/lib/types';
import { useCollection } from '@/lib/data';
import { useStream } from '@/lib/realtime';
import { timeAgo } from '@/lib/orders';
import { Field, Modal, Toggle, cx } from '@/ui/kit';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { PageHeader, useToast } from './AdminUI';

interface Agent { id: string; name: string; platform: string | null; version: string | null; last_seen_at: string | null; online: boolean; discovered: { name: string; kind?: string; detail?: string }[] }
interface PrinterRow { id: string; agent_id: string | null; name: string; connection: 'rede' | 'windows' | 'cups'; address: string; paper: '58mm' | '80mm'; columns: number; codepage: 'cp860' | 'cp850' | 'cp437'; cut: boolean; drawer: boolean; active: boolean }
interface ZP { zone_id: string; printer_id: string; priority: number; copies: number }
interface Job { id: string; order_id: string | null; zone_id: string | null; printer_id: string | null; kind: string; status: 'pendente' | 'enviado' | 'impresso' | 'falhou'; attempts: number; last_error: string | null; created_at: string; printed_at: string | null; preview: string }
interface Overview { agents: Agent[]; printers: PrinterRow[]; zonePrinters: ZP[]; jobs: Job[] }

const EVENTS: [string, string][] = [['novo', 'Pedido novo'], ['preparo', 'Pedido aceito'], ['items_added', 'Itens adicionados à mesa'], ['pronto', 'Pedido pronto'], ['cancelado', 'Cancelamento']];
const CONN: Record<string, string> = { rede: 'Rede (IP:9100)', windows: 'Windows (compartilhada)', cups: 'CUPS (Linux/Mac)' };
const JOB_STYLE = { pendente: 'bg-amber-100 text-amber-700', enviado: 'bg-blue-100 text-blue-700', impresso: 'bg-green-100 text-green-700', falhou: 'bg-red-100 text-red-700' } as const;
const blankPrinter = (): Omit<PrinterRow, 'id'> & { id?: string } => ({ name: '', agent_id: null, connection: 'rede', address: '', paper: '80mm', columns: 48, codepage: 'cp860', cut: true, drawer: false, active: true });

export default function PrintAdmin() {
  const zones = useCollection<PrintZone>('printZones');
  const [ov, setOv] = useState<Overview | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [printer, setPrinter] = useState<ReturnType<typeof blankPrinter> | null>(null);
  const [zone, setZone] = useState<(Omit<PrintZone, 'id'> & { id?: string }) | null>(null);
  const [assign, setAssign] = useState<{ zone: PrintZone; rows: { printerId: string; priority: number; copies: number }[] } | null>(null);
  const [preview, setPreview] = useState<Job | null>(null);
  const toast = useToast();
  const act = useAction();

  const load = useCallback(async () => setOv(await get<Overview>('/v1/staff/print/overview')), []);
  useEffect(() => { void load(); }, [load]);
  useStream((e) => { if (e.type === 'print' || e.type === 'agent') void load(); }, load, 10_000);
  if (!ov || !zones.ready) return <Spinner />;

  const printerName = (id: string | null) => ov.printers.find((p) => p.id === id)?.name ?? '—';
  const zoneName = (id: string | null) => zones.items.find((z) => z.id === id)?.name ?? '—';
  const online = ov.agents.some((a) => a.online);
  const failed = ov.jobs.filter((j) => j.status === 'falhou');
  const noPrinter = zones.items.filter((z) => z.active && !ov.zonePrinters.some((x) => x.zone_id === z.id));

  return (
    <>
      <PageHeader title="Impressão por zonas" subtitle="Cada zona (cozinha, bar, expedição…) imprime só os seus itens na impressora certa" actions={<button className="btn-ghost" onClick={load}><RefreshCw size={14} /> Atualizar</button>} />
      <ErrorBox>{act.error}</ErrorBox>

      {(failed.length > 0 || !online || noPrinter.length > 0) && (
        <div className="mb-4 space-y-2">
          {!online && <div className="flex items-start gap-2 rounded-ui-sm bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"><Unplug size={16} className="mt-0.5 shrink-0" /> Nenhum agente de impressão conectado. Os cupons ficam na fila e saem quando o agente voltar; depois de alguns minutos sem agente, vão para a impressora reserva ou falham.</div>}
          {failed.length > 0 && <div className="flex items-start gap-2 rounded-ui-sm bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {failed.length} cupom(ns) <b>não saíram</b>. Confira a impressora e use "Reenviar" na fila abaixo.</div>}
          {noPrinter.length > 0 && <div className="flex items-start gap-2 rounded-ui-sm bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> Zona(s) sem impressora: <b>{noPrinter.map((z) => z.name).join(', ')}</b> — os pedidos dela não imprimem.</div>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Monitor size={16} /> Agentes de impressão</h2>
            <button className="btn" onClick={() => act.run(async () => setPairing(await post('/v1/staff/print/pairing')))}><Plug size={14} /> Parear agente</button></div>
          {ov.agents.length === 0 && <p className="text-sm text-muted-foreground">Nenhum agente pareado. Instale o <b>Pediu Agente</b> no computador onde ficam as impressoras e pareie com o código.</p>}
          {ov.agents.map((a) => (
            <div key={a.id} className="rounded-ui-sm border border-border p-3 text-sm">
              <div className="flex items-center gap-2"><span className={cx('h-2.5 w-2.5 rounded-full', a.online ? 'bg-green-500' : 'bg-slate-400')} /><b className="flex-1">{a.name}</b>
                <span className="text-xs text-muted-foreground">{a.online ? 'conectado' : a.last_seen_at ? `visto há ${timeAgo(a.last_seen_at)}` : 'nunca conectou'}</span>
                <button className="btn-danger !p-1.5" aria-label="Remover agente" onClick={() => confirm(`Remover o agente ${a.name}? Ele será desconectado.`) && act.run(async () => { await del(`/v1/staff/print/agents/${a.id}`); await load(); })}><Trash2 size={13} /></button></div>
              <div className="text-xs text-muted-foreground">{a.platform} · v{a.version}</div>
              {a.discovered.length > 0 && <div className="mt-1.5 text-xs text-muted-foreground">Impressoras vistas por ele: {a.discovered.map((d) => d.name).join(', ')}</div>}
            </div>
          ))}
        </section>

        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Printer size={16} /> Impressoras</h2><button className="btn" onClick={() => setPrinter(blankPrinter())}><Plus size={14} /> Nova impressora</button></div>
          {ov.printers.length === 0 && <p className="text-sm text-muted-foreground">Cadastre cada impressora (térmica de cozinha, bar, caixa…).</p>}
          {ov.printers.map((p) => (
            <div key={p.id} className={cx('rounded-ui-sm border border-border p-3 text-sm', !p.active && 'opacity-60')}>
              <div className="flex items-center gap-2"><b className="flex-1">{p.name}</b>
                <button className="btn-ghost !px-2 !py-1 text-xs" disabled={act.busy} onClick={() => act.run(async () => { await post(`/v1/staff/print/printers/${p.id}/test`); toast(`Teste enviado para ${p.name}`); })}>Imprimir teste</button>
                <button className="btn-ghost !p-1.5" aria-label="Editar" onClick={() => setPrinter(p)}><Pencil size={13} /></button>
                <button className="btn-danger !p-1.5" aria-label="Excluir" onClick={() => confirm(`Excluir a impressora ${p.name}?`) && act.run(async () => { await del(`/v1/staff/print/printers/${p.id}`); await load(); })}><Trash2 size={13} /></button></div>
              <div className="text-xs text-muted-foreground">{CONN[p.connection]} · {p.address} · {p.paper} · {p.columns} col · {p.codepage.toUpperCase()}{p.cut ? ' · corta' : ''}{p.drawer ? ' · gaveta' : ''}</div>
              <div className="text-xs text-muted-foreground">Agente: {ov.agents.find((a) => a.id === p.agent_id)?.name ?? <span className="text-amber-600">nenhum</span>}</div>
            </div>
          ))}
        </section>
      </div>

      <section className="card mt-5 space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Zonas de impressão</h2>
          <button className="btn" onClick={() => setZone({ name: '', description: '', paper: '80mm', copies: 1, autoPrint: true, showPrices: false, active: true, isDefault: false, events: ['novo', 'items_added', 'cancelado'] })}><Plus size={14} /> Nova zona</button></div>
        <p className="text-xs text-muted-foreground">Cada categoria do cardápio aponta para uma zona (em Categorias). Itens de categoria sem zona saem na zona <b>padrão</b>. Zonas que mostram preços (caixa, expedição) imprimem o pedido inteiro; as de produção imprimem só os próprios itens, sem preço.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {zones.items.map((z) => {
            const links = ov.zonePrinters.filter((x) => x.zone_id === z.id).sort((a, b) => a.priority - b.priority);
            return (
              <div key={z.id} className={cx('rounded-ui-sm border border-border p-3 text-sm', !z.active && 'opacity-60')}>
                <div className="flex items-center gap-2"><b className="flex-1">{z.name}{z.isDefault && <span className="ml-2 badge bg-primary/10 text-primary">padrão</span>}</b>
                  <button className="btn-ghost !p-1.5" aria-label="Editar zona" onClick={() => setZone(z)}><Pencil size={13} /></button>
                  <button className="btn-danger !p-1.5" aria-label="Excluir zona" onClick={() => confirm(`Excluir a zona ${z.name}?`) && act.run(async () => { await zones.remove(z.id); await load(); })}><Trash2 size={13} /></button></div>
                <div className="text-xs text-muted-foreground">{z.description || '—'}</div>
                <div className="mt-1 text-xs text-muted-foreground">{z.showPrices ? 'Mostra preços e total' : 'Só itens (sem preço)'} · {z.autoPrint ? 'imprime sozinha' : 'só manual'} · {z.events.map((e) => EVENTS.find((x) => x[0] === e)?.[1] ?? e).join(', ') || 'nenhum evento'}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {links.length === 0 ? <span className="text-xs text-amber-600">Sem impressora</span> : links.map((l) => <span key={l.printer_id} className="badge bg-muted text-foreground">{l.priority === 0 ? 'Principal' : `Reserva ${l.priority}`}: {printerName(l.printer_id)}{l.copies > 1 ? ` ×${l.copies}` : ''}</span>)}
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setAssign({ zone: z, rows: links.map((l) => ({ printerId: l.printer_id, priority: l.priority, copies: l.copies })) })}>Escolher impressoras</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card mt-5 p-4">
        <h2 className="mb-3 font-semibold">Fila de impressão (últimos cupons)</h2>
        {ov.jobs.length === 0 ? <p className="text-sm text-muted-foreground">Nada impresso ainda.</p> : (
          <div className="divide-y divide-border">
            {ov.jobs.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className={cx('badge', JOB_STYLE[j.status])}>{j.status === 'impresso' ? <CheckCircle2 size={11} className="mr-1" /> : j.status === 'falhou' ? <AlertTriangle size={11} className="mr-1" /> : <Clock size={11} className="mr-1" />}{j.status}</span>
                <span className="font-medium">{j.kind}</span><span className="text-muted-foreground">{j.zone_id ? zoneName(j.zone_id) : 'teste'} → {printerName(j.printer_id)}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(j.created_at)}{j.attempts > 1 ? ` · ${j.attempts} tentativas` : ''}</span>
                {j.last_error && <span className="text-xs text-destructive">{j.last_error}</span>}
                <span className="ml-auto flex gap-1.5">
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setPreview(j)}>Ver cupom</button>
                  {j.status !== 'impresso' && <button className="btn-ghost !px-2 !py-1 text-xs" disabled={act.busy} onClick={() => act.run(async () => { await post(`/v1/staff/print/jobs/${j.id}/retry`); toast('Reenviado'); await load(); })}>Reenviar</button>}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal open={!!pairing} onClose={() => setPairing(null)} title="Parear agente de impressão">
        {pairing && <div className="space-y-3 text-sm">
          <p>No computador das impressoras, abra o terminal e rode:</p>
          <pre className="overflow-x-auto rounded-ui-xs bg-slate-900 p-3 text-xs text-slate-100">pediu-agent pair --url {location.origin} --code {pairing.code}</pre>
          <div className="flex items-center justify-center gap-3 rounded-ui bg-muted p-4"><span className="text-3xl font-extrabold tracking-[0.3em]">{pairing.code}</span><button className="btn-ghost" onClick={() => navigator.clipboard.writeText(pairing.code)}><Copy size={14} /> Copiar</button></div>
          <p className="text-xs text-muted-foreground">O código vale por 10 minutos e só pode ser usado uma vez. Depois do pareamento, rode <code>pediu-agent run</code> e deixe aberto.</p>
        </div>}
      </Modal>

      <Modal open={!!printer} onClose={() => setPrinter(null)} title={printer?.id ? 'Editar impressora' : 'Nova impressora'}
        footer={<><button className="btn-ghost" onClick={() => setPrinter(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!printer?.name.trim() || !printer?.address.trim() || act.busy} onClick={() => act.run(async () => { await put('/v1/staff/print/printers', printer); setPrinter(null); await load(); })}><Save size={14} /> Salvar</button></>}>
        {printer && <div className="space-y-3">
          <Field label="Nome (ex.: Cozinha, Bar, Caixa)"><input className="input" value={printer.name} onChange={(e) => setPrinter({ ...printer, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conexão"><select className="input" value={printer.connection} onChange={(e) => setPrinter({ ...printer, connection: e.target.value as PrinterRow['connection'] })}>{Object.entries(CONN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Agente (computador)"><select className="input" value={printer.agent_id ?? ''} onChange={(e) => setPrinter({ ...printer, agent_id: e.target.value || null })}><option value="">— escolha —</option>{ov.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          </div>
          <Field label={printer.connection === 'rede' ? 'Endereço (IP:porta)' : printer.connection === 'windows' ? 'Nome do compartilhamento no Windows' : 'Nome da fila no CUPS'} hint={printer.connection === 'rede' ? 'Ex.: 192.168.0.50:9100 (a porta padrão é 9100)' : printer.connection === 'windows' ? 'A impressora precisa estar compartilhada. O agente lista as impressoras que ele vê.' : undefined}>
            <input className="input" value={printer.address} onChange={(e) => setPrinter({ ...printer, address: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Papel"><select className="input" value={printer.paper} onChange={(e) => setPrinter({ ...printer, paper: e.target.value as '58mm' | '80mm', columns: e.target.value === '58mm' ? 32 : 48 })}><option>58mm</option><option>80mm</option></select></Field>
            <Field label="Colunas"><input className="input" type="number" min={20} max={80} value={printer.columns} onChange={(e) => setPrinter({ ...printer, columns: Number(e.target.value) })} /></Field>
            <Field label="Acentos"><select className="input" value={printer.codepage} onChange={(e) => setPrinter({ ...printer, codepage: e.target.value as PrinterRow['codepage'] })}><option value="cp860">CP860 (padrão)</option><option value="cp850">CP850</option><option value="cp437">CP437 (sem acento)</option></select></Field>
          </div>
          <div className="flex flex-wrap gap-5"><Toggle checked={printer.cut} onChange={(v) => setPrinter({ ...printer, cut: v })} label="Cortar o papel" /><Toggle checked={printer.drawer} onChange={(v) => setPrinter({ ...printer, drawer: v })} label="Abrir gaveta (pagamento em dinheiro)" /><Toggle checked={printer.active} onChange={(v) => setPrinter({ ...printer, active: v })} label="Ativa" /></div>
          <p className="text-xs text-muted-foreground">Dica: se os acentos saírem trocados no papel, tente CP850 ou CP437 e use "Imprimir teste".</p>
        </div>}
      </Modal>

      <Modal open={!!zone} onClose={() => setZone(null)} title={zone?.id ? 'Editar zona' : 'Nova zona'}
        footer={<><button className="btn-ghost" onClick={() => setZone(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!zone?.name.trim() || act.busy} onClick={() => act.run(async () => { await zones.save(zone!); setZone(null); await load(); })}><Save size={14} /> Salvar</button></>}>
        {zone && <div className="space-y-3">
          <Field label="Nome"><input className="input" value={zone.name} onChange={(e) => setZone({ ...zone, name: e.target.value })} /></Field>
          <Field label="Descrição"><input className="input" value={zone.description} onChange={(e) => setZone({ ...zone, description: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-5"><Toggle checked={zone.showPrices} onChange={(v) => setZone({ ...zone, showPrices: v })} label="Mostrar preços e total (pedido inteiro)" /><Toggle checked={zone.autoPrint} onChange={(v) => setZone({ ...zone, autoPrint: v })} label="Imprimir sozinha" /><Toggle checked={zone.isDefault} onChange={(v) => setZone({ ...zone, isDefault: v })} label="Zona padrão (itens sem zona)" /><Toggle checked={zone.active} onChange={(v) => setZone({ ...zone, active: v })} label="Ativa" /></div>
          <div><div className="mb-1 text-xs font-medium text-muted-foreground">Imprime quando</div>
            <div className="grid gap-1 sm:grid-cols-2">{EVENTS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={zone.events.includes(k)} onChange={(e) => setZone({ ...zone, events: e.target.checked ? [...zone.events, k] : zone.events.filter((x) => x !== k) })} /> {label}</label>
            ))}</div></div>
        </div>}
      </Modal>

      <Modal open={!!assign} onClose={() => setAssign(null)} title={`Impressoras da zona ${assign?.zone.name ?? ''}`}
        footer={<><button className="btn-ghost" onClick={() => setAssign(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={act.busy} onClick={() => act.run(async () => { await put(`/v1/staff/print/zones/${assign!.zone.id}/printers`, { printers: assign!.rows }); setAssign(null); await load(); })}><Save size={14} /> Salvar</button></>}>
        {assign && <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">A <b>principal</b> imprime sempre. As <b>reservas</b> entram sozinhas se a principal falhar 3 vezes ou o agente ficar offline.</p>
          {ov.printers.length === 0 && <p className="text-destructive">Cadastre uma impressora primeiro.</p>}
          {ov.printers.map((p) => {
            const row = assign.rows.find((r) => r.printerId === p.id);
            const toggle = (on: boolean) => setAssign({ ...assign, rows: on ? [...assign.rows, { printerId: p.id, priority: assign.rows.length, copies: 1 }] : assign.rows.filter((r) => r.printerId !== p.id) });
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-ui-sm border border-border p-2.5">
                <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={!!row} onChange={(e) => toggle(e.target.checked)} /> <b>{p.name}</b></label>
                {row && <>
                  <select className="input !w-auto" value={row.priority} onChange={(e) => setAssign({ ...assign, rows: assign.rows.map((r) => (r.printerId === p.id ? { ...r, priority: Number(e.target.value) } : r)) })}><option value={0}>Principal</option>{[1, 2, 3].map((n) => <option key={n} value={n}>Reserva {n}</option>)}</select>
                  <label className="flex items-center gap-1 text-xs">Cópias <input type="number" min={1} max={5} className="input !w-16" value={row.copies} onChange={(e) => setAssign({ ...assign, rows: assign.rows.map((r) => (r.printerId === p.id ? { ...r, copies: Number(e.target.value) } : r)) })} /></label>
                </>}
              </div>
            );
          })}
        </div>}
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Cupom">
        {preview && <pre className="overflow-x-auto rounded-ui-xs bg-amber-50 p-3 font-mono text-[11px] leading-tight text-slate-900 shadow-inner">{preview.preview || '(sem texto)'}</pre>}
      </Modal>
    </>
  );
}
