import { useCallback, useEffect, useState } from 'react';
import { Check, Minus, Pencil, Plus, Save, X } from 'lucide-react';
import { ROLES, ROLE_PERMS, type Perm, type Role } from '@pediu/shared/browser';
import { get, post, put } from '@/lib/api';
import { ROLE_DESC, ROLE_LABEL } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { Field, Modal, Toggle, cx } from '@/ui/kit';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { PageHeader, StatusBadge, useToast } from './AdminUI';

interface User { id: string; name: string; email: string; role: Role; active: boolean; last_login_at: string | null; has_pin: boolean; has_password: boolean }
interface Draft { id?: string; name: string; email: string; role: Role; active: boolean; password: string; pin: string }
const PERM_LABEL: Record<Perm, string> = {
  pdv: 'PDV (caixa, receber e fechar pedidos)', garcom: 'App do garçom (mesas)', motoboy: 'App do entregador', 'orders.cancel': 'Cancelar pedidos', 'pagamentos.estornar': 'Estornar pagamentos',
  'admin.dashboard': 'Painel: dashboard', 'admin.pedidos': 'Painel: pedidos', 'admin.cardapio': 'Painel: cardápio', 'admin.loja': 'Painel: loja, pagamentos e impressão', 'admin.usuarios': 'Painel: usuários',
};
const blank = (): Draft => ({ name: '', email: '', role: 'balcao', active: true, password: '', pin: '' });

export default function UsersAdmin() {
  const { me } = useSession();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const act = useAction();
  const load = useCallback(async () => setUsers((await get<{ users: User[] }>('/v1/staff/users')).users), []);
  useEffect(() => { void load(); }, [load]);
  if (!users) return <Spinner />;

  const valid = !!draft && draft.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(draft.email) && (!draft.password || draft.password.length >= 10) && (draft.id || draft.password.length >= 10) && (!draft.pin || /^\d{4,6}$/.test(draft.pin));
  const save = () => act.run(async () => {
    const body = { name: draft!.name.trim(), email: draft!.email.trim(), role: draft!.role, active: draft!.active, ...(draft!.password ? { password: draft!.password } : {}), ...(draft!.pin ? { pin: draft!.pin } : {}) };
    if (draft!.id) await put(`/v1/staff/users/${draft!.id}`, body); else await post('/v1/staff/users', body);
    toast(`Usuário ${draft!.name.trim()} salvo`); setDraft(null); await load();
  });

  return (
    <>
      <PageHeader title="Usuários" subtitle="Cada perfil libera só as telas e funções que a pessoa precisa" actions={<button className="btn" onClick={() => setDraft(blank())}><Plus size={14} /> Novo usuário</button>} />
      <div className="grid gap-2 md:grid-cols-2">
        {users.map((u) => (
          <div key={u.id} className={cx('card flex items-center gap-3 p-3', !u.active && 'opacity-60')}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><b className="truncate">{u.name}</b>{u.email === me?.name && <span className="badge bg-muted text-muted-foreground">você</span>}</div>
              <div className="truncate text-xs text-muted-foreground">{u.email} · {ROLE_LABEL[u.role]}</div>
              <div className="text-[11px] text-muted-foreground">{u.last_login_at ? `Último acesso: ${new Date(u.last_login_at).toLocaleString('pt-BR')}` : 'Nunca entrou'}</div>
            </div>
            <StatusBadge on={u.active} />
            <button className="btn-ghost !p-2" aria-label="Editar" onClick={() => setDraft({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, password: '', pin: '' })}><Pencil size={14} /></button>
          </div>
        ))}
      </div>

      <section className="card mt-6 overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">O que cada perfil acessa</h2>
        <table className="w-full min-w-[600px] text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Função</th>{ROLES.map((r) => <th key={r} className="px-2 text-center font-medium">{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">{(Object.keys(PERM_LABEL) as Perm[]).map((p) => (
            <tr key={p}><td className="py-2 pr-3">{PERM_LABEL[p]}</td>{ROLES.map((r) => <td key={r} className="px-2 text-center">{ROLE_PERMS[r].includes(p) ? <Check size={16} className="mx-auto text-green-600" /> : <Minus size={16} className="mx-auto text-muted-foreground/40" />}</td>)}</tr>
          ))}</tbody>
        </table>
      </section>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar usuário' : 'Novo usuário'}
        footer={<><button className="btn-ghost" onClick={() => setDraft(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!valid || act.busy} onClick={save}><Save size={14} /> Salvar</button></>}>
        {draft && (
          <div className="space-y-3">
            <ErrorBox>{act.error}</ErrorBox>
            <Field label="Nome"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="E-mail (é o login)"><input className="input" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            <Field label="Perfil" hint={ROLE_DESC[draft.role]}>
              <select className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>{ROLES.filter((r) => r !== 'admin' || me?.role === 'admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            </Field>
            <Field label={draft.id ? 'Nova senha (deixe vazio para manter)' : 'Senha (mín. 10 caracteres)'}><input className="input" type="password" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></Field>
            <Field label="PIN rápido de 4 a 6 dígitos (opcional)" hint="Guardado em segredo. Será usado no login por PIN em dispositivo pareado."><input className="input" inputMode="numeric" maxLength={6} value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '') })} /></Field>
            <Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Usuário ativo" />
          </div>
        )}
      </Modal>
    </>
  );
}
