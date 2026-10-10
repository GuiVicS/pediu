import { Bike, Loader2, MapPin, Pencil, Plus, Store as StoreIcon, Trash2 } from 'lucide-react';
import { brl } from '@/lib/format';
import { cx } from '@/ui/kit';
import { maskCep } from './format';
import { BigButton, ErrorLine, Input, Label } from './parts';
import type { Checkout } from './useCheckout';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const Choice = ({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label: string }) => (
  <button type="button" role="radio" aria-checked={on} aria-label={label} onClick={onClick}
    className={cx('flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition', on ? 'border-2 border-t-fg bg-t-card' : 'border-t-border hover:bg-t-muted/50')}>
    <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-t-fg' : 'border-t-border')}>{on && <span className="h-2.5 w-2.5 rounded-full bg-t-fg" />}</span>
    <span className="min-w-0 flex-1">{children}</span>
  </button>
);

function AddressForm({ c }: { c: Checkout }) {
  const d = c.del;
  const set = (k: 'cep' | 'street' | 'number' | 'complement' | 'district' | 'city' | 'uf' | 'label') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => d.setField(k, e.target.value);
  return (
    <div className="space-y-3 rounded-2xl border border-t-border p-4">
      <div>
        <Label htmlFor="ad-cep">CEP</Label>
        <div className="relative max-w-[200px]">
          <Input id="ad-cep" inputMode="numeric" autoComplete="postal-code" value={d.form.cep} onChange={(e) => void d.onCep(e.target.value)} placeholder="00000-000" />
          {d.cep === 'loading' && <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-t-muted-fg" aria-label="Buscando CEP" />}
        </div>
        {d.cep === 'ok' && <p className="mt-1 text-xs text-t-accent">Endereço encontrado. Confira e informe o número.</p>}
        {d.cep === 'not_found' && <p className="mt-1 text-xs text-t-danger">CEP não encontrado. Preencha o endereço manualmente.</p>}
        {d.cep === 'unavailable' && <p className="mt-1 text-xs text-t-muted-fg">Não conseguimos buscar o CEP agora. Preencha o endereço manualmente.</p>}
      </div>
      <div><Label htmlFor="ad-street">Rua / Avenida</Label><Input id="ad-street" autoComplete="address-line1" value={d.form.street} onChange={set('street')} /></div>
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <div><Label htmlFor="ad-number">Número</Label><Input id="ad-number" inputMode="numeric" autoComplete="off" value={d.form.number} onChange={set('number')} placeholder="125 ou s/n" /></div>
        <div><Label htmlFor="ad-comp">Complemento</Label><Input id="ad-comp" autoComplete="address-line2" value={d.form.complement} onChange={set('complement')} placeholder="Apto, bloco, referência" /></div>
      </div>
      <div><Label htmlFor="ad-district">Bairro</Label><Input id="ad-district" value={d.form.district} onChange={set('district')} /></div>
      <div className="grid grid-cols-[1fr_90px] gap-3">
        <div><Label htmlFor="ad-city">Cidade</Label><Input id="ad-city" autoComplete="address-level2" value={d.form.city} onChange={set('city')} /></div>
        <div><Label htmlFor="ad-uf">UF</Label>
          <select id="ad-uf" className="t-input !rounded-full !px-3 !py-3" value={d.form.uf} onChange={set('uf')}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></div>
      </div>
      <div><Label htmlFor="ad-label">Apelido do endereço <span className="font-normal text-t-muted-fg">(opcional)</span></Label><Input id="ad-label" value={d.form.label} onChange={set('label')} placeholder="Casa, trabalho…" maxLength={40} /></div>
      {d.editing === 'new' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.form.save} onChange={(e) => d.setSave(e.target.checked)} /> Salvar para os próximos pedidos</label>}
      <ErrorLine>{d.addrError}</ErrorLine>
      {d.addresses.length > 0 && <button type="button" className="text-sm font-semibold text-t-primary hover:underline" onClick={() => d.setEditing(null)}>Cancelar e usar um endereço salvo</button>}
    </div>
  );
}

export function DeliveryForm({ c }: { c: Checkout }) {
  const d = c.del;
  const showForm = d.type === 'delivery' && d.editing !== null;
  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void d.submit(); }}>
      <div role="radiogroup" aria-label="Como você quer receber" className="grid grid-cols-2 gap-2">
        {(['delivery', 'retirada'] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={d.type === t} onClick={() => d.setType(t)}
            className={cx('flex items-center justify-center gap-2 rounded-full border px-3 py-3 text-sm font-semibold transition', d.type === t ? 'border-t-primary bg-t-primary text-t-primary-fg' : 'border-t-border hover:bg-t-muted')}>
            {t === 'delivery' ? <><Bike size={16} /> Entrega</> : <><StoreIcon size={16} /> Retirar na loja</>}
          </button>
        ))}
      </div>

      {d.type === 'retirada' && (
        <div className="flex items-start gap-3 rounded-2xl bg-t-muted/60 p-4 text-sm"><MapPin size={18} className="mt-0.5 shrink-0 text-t-primary" aria-hidden />
          <div><div className="font-semibold">Retire em {c.store.name}</div><div className="text-t-muted-fg">{[c.store.address, c.store.city && `${c.store.city}/${c.store.state}`].filter(Boolean).join(' · ') || 'O endereço da loja aparece no acompanhamento do pedido.'}</div>
            <div className="mt-1 text-t-muted-fg">Preparo em cerca de {c.store.prepTime} min.</div></div></div>
      )}

      {d.type === 'delivery' && (
        <>
          {!d.addrLoaded && <div className="flex items-center gap-2 py-4 text-sm text-t-muted-fg"><Loader2 size={16} className="animate-spin" /> Carregando seus endereços…</div>}
          {d.addrLoaded && !showForm && (
            <>
              <p className="text-sm text-t-muted-fg">Selecione um endereço ou cadastre um novo.</p>
              <button type="button" onClick={d.openNew} className="flex items-center gap-1.5 text-sm font-bold text-t-primary hover:underline"><Plus size={16} /> Novo endereço</button>
              <div role="radiogroup" aria-label="Endereços salvos" className="space-y-2">
                {d.addresses.map((a) => (
                  <div key={a.id} className={cx('rounded-2xl border p-4', d.selectedId === a.id ? 'border-2 border-t-fg' : 'border-t-border')}>
                    <div className="flex items-start gap-3">
                      <button type="button" role="radio" aria-checked={d.selectedId === a.id} aria-label={`Usar ${a.label || a.street}`} onClick={() => d.setSelectedId(a.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                        <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', d.selectedId === a.id ? 'border-t-fg' : 'border-t-border')}>{d.selectedId === a.id && <span className="h-2.5 w-2.5 rounded-full bg-t-fg" />}</span>
                        <span className="min-w-0 text-sm"><b className="block">{a.label || `${a.street}, ${a.number}`}</b>{a.label && <span className="block">{a.street}, {a.number}{a.complement ? ` - ${a.complement}` : ''}</span>}
                          <span className="block text-t-muted-fg">{[a.district, [a.city, a.uf].filter(Boolean).join('-')].filter(Boolean).join(' · ')}{a.cep ? ` | CEP ${maskCep(a.cep)}` : ''}</span></span>
                      </button>
                      <div className="flex shrink-0 gap-3 text-xs text-t-muted-fg">
                        <button type="button" onClick={() => d.openEdit(a)} className="flex flex-col items-center gap-0.5 hover:text-t-fg" aria-label={`Editar ${a.label || a.street}`}><Pencil size={15} />Editar</button>
                        <button type="button" disabled={d.addrBusy} onClick={() => confirm('Excluir este endereço?') && void d.removeAddress(a.id)} className="flex flex-col items-center gap-0.5 hover:text-t-danger" aria-label={`Excluir ${a.label || a.street}`}><Trash2 size={15} />Excluir</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <ErrorLine>{d.addrError}</ErrorLine>
            </>
          )}
          {d.addrLoaded && showForm && <AddressForm c={c} />}

          {(d.selected || showForm) && d.zones.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Escolha a região de entrega:</p>
              <div role="radiogroup" aria-label="Região de entrega" className="space-y-2">
                {d.zones.map((z) => (
                  <Choice key={z.id} on={d.zoneId === z.id} onClick={() => d.setZoneId(z.id)} label={`${z.name}, ${brl(z.fee)}`}>
                    <span className="flex items-start justify-between gap-3"><span><b className="block text-sm">{z.name}</b><span className="text-sm text-t-muted-fg">Chega em cerca de {z.eta} min</span></span><b className="shrink-0 text-sm">{z.fee > 0 ? brl(z.fee) : 'Grátis'}</b></span>
                  </Choice>
                ))}
              </div>
            </div>
          )}
          {d.addrLoaded && d.zones.length === 0 && <ErrorLine>Esta loja ainda não tem regiões de entrega. Escolha “Retirar na loja”.</ErrorLine>}
        </>
      )}
      <BigButton type="submit" busy={d.addrBusy} disabled={!d.ok}>Ir para Pagamento</BigButton>
      {d.type === 'delivery' && d.addrLoaded && !d.ok && <p className="text-center text-xs text-t-muted-fg">{showForm ? 'Preencha rua e número e escolha a região de entrega.' : 'Escolha um endereço e a região de entrega.'}</p>}
    </form>
  );
}
