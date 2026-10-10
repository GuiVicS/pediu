import { useEffect, useState } from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { DAY_LABELS, STORE_DEFAULTS, type DeliveryZone, type Store } from '@/lib/types';
import { useCollection, useKV } from '@/lib/data';
import { brl } from '@/lib/format';
import { Field, Modal, Toggle } from '@/ui/kit';
import { PageHeader, useToast } from './AdminUI';
import { PaymentMethodsSection } from './PaymentMethods';
import { TotemsSection } from './TotemsSection';
import { McpPanel } from './McpPanel';

type ZDraft = Omit<DeliveryZone, 'id'> & { id?: string };

/** Os 7 dias da semana, completando com o padrão os que a loja ainda não configurou. */
const weekHours = (hours: Store['hours'] | undefined): Store['hours'] => Array.from({ length: 7 }, (_, day) => hours?.find((h) => h.day === day) ?? { day, closed: day === 0, open: '18:00', close: '23:00' });
const hoursKey = (hours: Store['hours']) => JSON.stringify(hours.map((h) => [h.day, h.closed, h.open, h.close]));

export default function StoreAdmin() {
  const [saved, saveStore] = useKV<Store>('store');
  const zones = useCollection<DeliveryZone>('deliveryZones');
  const toast = useToast();
  const [form, setForm] = useState<Store | null>(null);
  const [zone, setZone] = useState<ZDraft | null>(null);
  useEffect(() => {
    if (saved && !form) setForm({ ...STORE_DEFAULTS, ...saved, hours: weekHours(saved.hours) });
  }, [saved, form]);
  if (!form) return null;
  const set = <K extends keyof Store>(k: K, v: Store[K]) => setForm({ ...form, [k]: v });
  // os horários são comparados à parte: o banco devolve as chaves em outra ordem, então o JSON inteiro não serve para eles
  const dirty = !!saved && (JSON.stringify(form) !== JSON.stringify({ ...STORE_DEFAULTS, ...saved, hours: form.hours }) || hoursKey(form.hours) !== hoursKey(weekHours(saved.hours)));

  return (
    <>
      <PageHeader title="Loja e entrega" subtitle="Dados do estabelecimento, horários, regiões de entrega e formas de pagamento" actions={
        <button className="btn" disabled={!dirty} onClick={async () => { await saveStore({ ...Object.fromEntries([...Object.keys(STORE_DEFAULTS), 'timezone'].filter((k) => k in form).map((k) => [k, (form as unknown as Record<string, unknown>)[k]])), hours: form.hours.map(({ day, closed, open, close }) => ({ day, closed, open, close })) } as Store); toast('Dados da loja salvos'); }}><Save size={14} /> Salvar alterações</button>
      } />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Dados da loja</h2>
          <Field label="Nome"><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Slogan"><input className="input" value={form.slogan} onChange={(e) => set('slogan', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone"><input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Pedido mínimo (R$)"><input type="number" min={0} className="input" value={form.minOrder} onChange={(e) => set('minOrder', Number(e.target.value))} /></Field>
          </div>
          <Field label="Endereço"><input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Field label="Cidade"><input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} /></Field></div>
            <Field label="UF"><input className="input" maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} /></Field>
          </div>
          <Field label="Tempo médio de preparo (min)"><input type="number" min={0} className="input" value={form.prepTime} onChange={(e) => set('prepTime', Number(e.target.value))} /></Field>
          <Field label="Mesas no salão" hint="Quantas mesas aparecem no app do garçom (0 = sem atendimento em mesa)."><input type="number" min={0} max={300} className="input" value={form.tables ?? 20} onChange={(e) => set('tables', Math.max(0, Math.min(300, Number(e.target.value) || 0)))} /></Field>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Funcionamento</h2>
          <Field label="Modo" hint="“Seguir horário” abre e fecha sozinho. Os modos manuais sobrepõem o horário."><select className="input" value={form.mode} onChange={(e) => set('mode', e.target.value as Store['mode'])}><option value="open">Aberta (manual)</option><option value="closed">Fechada (manual)</option><option value="auto">Seguir horário da semana</option></select></Field>
          <Field label="Mensagem quando fechada"><textarea className="input" rows={2} value={form.closedMessage} onChange={(e) => set('closedMessage', e.target.value)} /></Field>
          <div className="space-y-1.5 pt-1">
            {form.hours.map((h, i) => (
              <div key={h.day} className="flex items-center gap-2 text-sm">
                <span className="w-20">{DAY_LABELS[h.day]}</span>
                <input type="time" className="input !w-28" disabled={h.closed} value={h.open} onChange={(e) => set('hours', form.hours.map((x, k) => (k === i ? { ...x, open: e.target.value } : x)))} />
                <span>–</span>
                <input type="time" className="input !w-28" disabled={h.closed} value={h.close} onChange={(e) => set('hours', form.hours.map((x, k) => (k === i ? { ...x, close: e.target.value } : x)))} />
                <Toggle checked={!h.closed} onChange={(v) => set('hours', form.hours.map((x, k) => (k === i ? { ...x, closed: !v } : x)))} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card mt-5 p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Regiões de entrega</h2><button className="btn" onClick={() => setZone({ name: '', fee: 0, eta: 30, active: true })}><Plus size={16} /> Nova região</button></div>
        <div className="divide-y divide-border">
          {zones.items.map((z) => (
            <div key={z.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="flex-1"><b>{z.name}</b><div className="text-xs text-muted-foreground">~{z.eta} min</div></div>
              <span className="font-medium">{brl(z.fee)}</span>
              <Toggle checked={z.active} onChange={(v) => zones.save({ ...z, active: v })} />
              <button className="btn-ghost !px-2" onClick={() => setZone({ ...z })}><Pencil size={14} /></button>
              <button className="btn-danger !px-2" onClick={() => confirm(`Excluir "${z.name}"?`) && zones.remove(z.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </section>

      <PaymentMethodsSection />
      <TotemsSection />

      <details className="card mt-5 p-4">
        <summary className="cursor-pointer font-semibold">Avançado</summary>
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <h2 className="font-semibold">MCP da loja <span className="badge ml-1 bg-muted text-muted-foreground">cardápio: leitura · pedidos: escrita</span></h2>
          <McpPanel />
        </div>
      </details>

      <Modal open={!!zone} onClose={() => setZone(null)} title={zone?.id ? 'Editar região' : 'Nova região'}
        footer={<><button className="btn-ghost" onClick={() => setZone(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!zone?.name.trim()} onClick={async () => { if (zone) { await zones.save(zone); setZone(null); } }}><Save size={14} /> Salvar</button></>}>
        {zone && (
          <div className="space-y-4">
            <Field label="Nome (bairro ou faixa)"><input className="input" value={zone.name} onChange={(e) => setZone({ ...zone, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Taxa (R$)"><input type="number" min={0} step="0.5" className="input" value={zone.fee} onChange={(e) => setZone({ ...zone, fee: Number(e.target.value) })} /></Field>
              <Field label="Tempo estimado (min)"><input type="number" min={0} className="input" value={zone.eta} onChange={(e) => setZone({ ...zone, eta: Number(e.target.value) })} /></Field>
            </div>
            <Toggle checked={zone.active} onChange={(v) => setZone({ ...zone, active: v })} label="Ativa" />
          </div>
        )}
      </Modal>
    </>
  );
}
