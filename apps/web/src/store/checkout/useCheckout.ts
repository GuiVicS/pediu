import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, del, get, post, put } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { useCustomer, type Customer } from '@/lib/customer';
import { useStore } from '../StoreContext';
import { loadMyOrders, rememberOrder, type Created } from '../PaymentModals';
import { blankAddress, composeAddress, lookupCep, maskCep, maskPhone, onlyDigits, validCep, validCpf, validEmail, validPhone, type AddressFields } from './format';

export type Step = 1 | 2 | 3;
export interface SavedAddress extends AddressFields { id: string; label: string; zoneId: string | null; isDefault: boolean }
export type AuthMode = 'unknown' | 'checking' | 'login' | 'register' | 'recover';
export type CepState = 'idle' | 'loading' | 'ok' | 'not_found' | 'unavailable';

const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Todo o estado e as chamadas do checkout de 3 etapas (Identificação · Entrega · Pagamento). A tela só desenha. */
export function useCheckout() {
  const cart = useCart();
  const { slug, menu, store } = useStore();
  const { customer, ready, setCustomer, logout } = useCustomer();
  const base = `/v1/store/${slug}/customer`;
  const orderTokens = () => loadMyOrders(slug).map((o) => o.token);

  const [step, setStep] = useState<Step>(1);
  const [maxStep, setMaxStep] = useState<Step>(1);   // etapas já liberadas (dá para voltar e editar; adiante só depois de concluir)
  const go = (s: Step) => { setStep(s); setMaxStep((m) => (s > m ? s : m)); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  // ---------- 1. identificação ----------
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<AuthMode>('unknown');
  const [authBusy, setAuthBusy] = useState(false); const [authError, setAuthError] = useState<string | null>(null);
  const [recover, setRecover] = useState({ sent: false, code: '', password: '' });
  const checked = useRef('');

  // conta já logada: nome, telefone e e-mail vêm da conta; sem precisar digitar tudo de novo
  useEffect(() => {
    if (!customer) return;
    setName((n) => n || customer.name); setEmail(customer.email); setPhone((p) => p || maskPhone(customer.phone));
  }, [customer]);
  // já logada e com nome e telefone na conta: a identificação está resolvida e a pessoa começa direto na Entrega
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    if (customer && customer.name.trim().length >= 2 && validPhone(customer.phone)) { setStep(2); setMaxStep(2); }
  }, [ready, customer]);

  /** O e-mail já tem conta? Define se pedimos a senha, uma senha nova, ou o código por e-mail. */
  const checkEmail = useCallback(async () => {
    const mail = email.trim().toLowerCase();
    if (customer || !validEmail(mail) || checked.current === mail) return;
    checked.current = mail; setMode('checking'); setAuthError(null);
    try {
      const r = await post<{ exists: boolean; hasPassword: boolean }>(`${base}/exists`, { email: mail });
      setMode(!r.exists ? 'register' : r.hasPassword ? 'login' : 'recover');
    } catch (e) { checked.current = ''; setMode('unknown'); setAuthError(msg(e, 'Não foi possível verificar o e-mail agora.')); }
  }, [email, customer, base]);
  const changeEmail = (v: string) => { setEmail(v); if (checked.current && v.trim().toLowerCase() !== checked.current) { checked.current = ''; setMode('unknown'); setPassword(''); setRecover({ sent: false, code: '', password: '' }); } };

  const identityFieldsOk = name.trim().length >= 2 && validEmail(email) && validPhone(phone);
  const canContinue1 = !authBusy && identityFieldsOk && (!!customer
    || (mode === 'login' && password.length >= 1) || (mode === 'register' && password.length >= 8)
    || (mode === 'recover' && recover.sent && /^\d{6}$/.test(recover.code) && recover.password.length >= 8));

  const sendCode = async () => {
    setAuthBusy(true); setAuthError(null);
    try { await post(`${base}/code`, { email: email.trim().toLowerCase(), name: name.trim(), phone: onlyDigits(phone) }); setMode('recover'); setRecover((r) => ({ ...r, sent: true })); }
    catch (e) { setAuthError(msg(e, 'Não foi possível enviar o e-mail agora.')); } finally { setAuthBusy(false); }
  };

  const submitIdentity = async () => {
    if (!canContinue1) return;
    setAuthBusy(true); setAuthError(null);
    const mail = email.trim().toLowerCase();
    try {
      if (!customer) {
        let c: Customer;
        if (mode === 'login') c = (await post<{ customer: Customer }>(`${base}/login`, { email: mail, password, orderTokens: orderTokens() })).customer;
        else if (mode === 'register') c = (await post<{ customer: Customer }>(`${base}/register`, { name: name.trim(), email: mail, phone: onlyDigits(phone), password, orderTokens: orderTokens() })).customer;
        else {
          c = (await post<{ customer: Customer }>(`${base}/verify`, { email: mail, code: recover.code, orderTokens: orderTokens() })).customer;
          await put(`${base}/password`, { password: recover.password });
          c = { ...c, hasPassword: true };
        }
        setCustomer(c); setPassword(''); setRecover({ sent: false, code: '', password: '' });
      } else if (orderTokens().length) {
        void post(`${base}/link-orders`, { orderTokens: orderTokens() }).catch(() => undefined);   // pedidos antigos deste navegador passam para a conta
      }
      void loadAddresses();
      go(2);
    } catch (e) { setAuthError(msg(e, 'Não foi possível continuar. Tente de novo.')); } finally { setAuthBusy(false); }
  };

  const notMe = async () => { await logout(); setPassword(''); setMode('unknown'); checked.current = ''; setAuthError(null); setName(''); setPhone(''); setEmail(''); setStep(1); setMaxStep(1); setAddresses([]); setSelectedId(null); };

  // ---------- 2. entrega ----------
  const zones = menu.zones.filter((z) => z.active);
  const [type, setType] = useState<'delivery' | 'retirada'>('delivery');
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addrLoaded, setAddrLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);   // id do endereço em edição, 'new' ou fechado
  const [form, setForm] = useState<AddressFields & { label: string; save: boolean }>({ ...blankAddress(), label: '', save: true });
  const [zoneId, setZoneId] = useState('');
  const [cep, setCep] = useState<CepState>('idle');
  const [addrBusy, setAddrBusy] = useState(false); const [addrError, setAddrError] = useState<string | null>(null);
  const cepAbort = useRef<AbortController | null>(null);

  const loadAddresses = useCallback(async () => {
    try {
      const r = await get<{ addresses: SavedAddress[] }>(`${base}/addresses`);
      setAddresses(r.addresses);
      setSelectedId((cur) => (cur && r.addresses.some((a) => a.id === cur) ? cur : r.addresses.find((a) => a.isDefault)?.id ?? r.addresses[0]?.id ?? null));
      setEditing((cur) => (cur ?? (r.addresses.length === 0 ? 'new' : null)));
    } catch { setEditing((cur) => cur ?? 'new'); } finally { setAddrLoaded(true); }
  }, [base]);
  useEffect(() => { if (customer && !addrLoaded) void loadAddresses(); }, [customer, addrLoaded, loadAddresses]);

  const selected = addresses.find((a) => a.id === selectedId) ?? null;
  // a região (e a taxa) vem do endereço salvo; sem ela, o cliente escolhe; com uma só região, já vem marcada
  useEffect(() => { if (selected?.zoneId && zones.some((z) => z.id === selected.zoneId)) setZoneId(selected.zoneId); }, [selected?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!zoneId && zones.length === 1) setZoneId(zones[0]!.id); }, [zones.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  const zone = zones.find((z) => z.id === zoneId) ?? null;

  const setSave = (v: boolean) => setForm((f) => ({ ...f, save: v }));
  const setField = (k: keyof AddressFields | 'label', v: string) => setForm((f) => ({ ...f, [k]: k === 'cep' ? maskCep(v) : v }));
  const onCep = async (v: string) => {
    setField('cep', v); cepAbort.current?.abort();
    if (!validCep(v)) { setCep('idle'); return; }
    const ctl = new AbortController(); cepAbort.current = ctl; setCep('loading');
    const r = await lookupCep(v, ctl.signal);
    if (ctl.signal.aborted) return;
    if (r.ok) { setForm((f) => ({ ...f, street: r.street || f.street, district: r.district || f.district, city: r.city || f.city, uf: r.uf || f.uf })); setCep('ok'); }
    else setCep(r.reason);
  };

  const openNew = () => { setForm({ ...blankAddress(), label: '', save: true }); setCep('idle'); setAddrError(null); setEditing('new'); };
  const openEdit = (a: SavedAddress) => { setForm({ cep: a.cep ? maskCep(a.cep) : '', street: a.street, number: a.number, complement: a.complement, district: a.district, city: a.city, uf: a.uf, label: a.label, save: true }); setCep('idle'); setAddrError(null); setEditing(a.id); if (a.zoneId) setZoneId(a.zoneId); };
  const formOk = form.street.trim().length >= 2 && form.number.trim().length >= 1 && (form.cep === '' || validCep(form.cep));
  const payload = () => ({ label: form.label.trim(), cep: onlyDigits(form.cep), street: form.street.trim(), number: form.number.trim(), complement: form.complement.trim(), district: form.district.trim(), city: form.city.trim(), uf: form.uf.trim().toUpperCase(), zoneId: zoneId || null });

  const saveAddress = async (): Promise<SavedAddress | null> => {
    if (!formOk) return null;
    setAddrBusy(true); setAddrError(null);
    try {
      const r = editing && editing !== 'new'
        ? await put<{ address: SavedAddress }>(`${base}/addresses/${editing}`, { ...payload(), isDefault: addresses.find((a) => a.id === editing)?.isDefault ?? false })
        : await post<{ address: SavedAddress }>(`${base}/addresses`, payload());
      await loadAddresses(); setSelectedId(r.address.id); setEditing(null);
      return r.address;
    } catch (e) { setAddrError(msg(e, 'Não foi possível salvar o endereço.')); return null; } finally { setAddrBusy(false); }
  };
  const removeAddress = async (id: string) => {
    setAddrBusy(true); setAddrError(null);
    try { await del(`${base}/addresses/${id}`); if (selectedId === id) setSelectedId(null); await loadAddresses(); if (editing === id) setEditing(null); }
    catch (e) { setAddrError(msg(e, 'Não foi possível excluir o endereço.')); } finally { setAddrBusy(false); }
  };

  /** Endereço que vai no pedido: o salvo escolhido ou o que está no formulário. */
  const chosenFields = (): AddressFields | null => (editing ? (formOk ? form : null) : selected);
  const deliveryOk = type === 'retirada' || (!!chosenFields() && !!zone);
  const submitDelivery = async () => {
    if (!deliveryOk) return;
    if (type === 'delivery' && editing && form.save) { if (!(await saveAddress())) return; }   // formulário: salva (se marcado) e segue com ele
    else if (type === 'delivery' && editing) { /* sem salvar: usa só neste pedido */ }
    go(3);
  };
  const deliveryAddress = type === 'delivery' ? chosenFields() : null;

  // ---------- 3. pagamento ----------
  const pays = menu.payments.filter((p) => p.active);
  const [payId, setPayId] = useState('');
  const pay = pays.find((p) => p.id === payId) ?? pays[0] ?? null;   // já vem a primeira marcada: menos um toque
  const [changeFor, setChangeFor] = useState(''); const [document, setDocument] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Created | null>(null);
  const needsDoc = !!pay?.online && pay.gateway === 'sicoob';

  // ---------- cupom e totais ----------
  const [couponInput, setCouponInput] = useState(''); const [applied, setApplied] = useState<{ code: string; discountCents: number; description: string } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null); const [couponBusy, setCouponBusy] = useState(false);
  useEffect(() => { setApplied(null); setCouponMsg(null); }, [cart.subtotal]);
  const fee = type === 'delivery' ? zone?.fee ?? 0 : 0;
  const discount = applied ? applied.discountCents / 100 : 0;
  const total = cart.subtotal + fee - discount;

  const orderLines = useMemo(() => cart.lines.map((l) => ({ productId: l.productId, qty: l.qty, note: l.note, addons: Object.values(l.addons.reduce<Record<string, { groupId: string; addonIds: string[] }>>((acc, a) => { (acc[a.groupId] ??= { groupId: a.groupId, addonIds: [] }).addonIds.push(a.addonId); return acc; }, {})) })), [cart.lines]);
  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    setCouponBusy(true); setCouponMsg(null);
    try { setApplied(await post(`/v1/store/${slug}/coupons/validate`, { code: couponInput.trim(), phone: onlyDigits(phone), lines: orderLines })); setCouponInput(''); }
    catch (e) { setApplied(null); setCouponMsg(msg(e, 'Não foi possível validar o cupom.')); } finally { setCouponBusy(false); }
  };

  const payOk = !!pay && (!needsDoc || validCpf(document));
  const submit = async () => {
    if (!pay || !payOk || busy) return;
    const addr = deliveryAddress;
    setBusy(true); setError(null);
    try {
      const r = await post<Created>(`/v1/store/${slug}/orders`, {
        type, customerName: name.trim(), phone: onlyDigits(phone), address: addr ? composeAddress(addr) : '', zoneId: type === 'delivery' ? zone?.id : undefined,
        paymentId: pay.id, note: note.trim(), changeFor: pay.type === 'cash' && changeFor ? Number(changeFor.replace(',', '.')) : undefined,
        email: email.trim().toLowerCase(), document: needsDoc ? onlyDigits(document) : undefined, lines: orderLines, couponCode: applied?.code,
      });
      rememberOrder(slug, { token: r.trackingToken, number: r.number });
      cart.clear(); setDone(r);
    } catch (e) { setError(msg(e, 'Não foi possível enviar o pedido.')); } finally { setBusy(false); }
  };

  return {
    slug, store, cart, step, maxStep, go, customer, ready,
    id: { name, setName, email, changeEmail, phone, setPhone, password, setPassword, mode, authBusy, authError, recover, setRecover, checkEmail, sendCode, submit: submitIdentity, can: canContinue1, notMe, fieldsOk: identityFieldsOk },
    del: { type, setType, zones, zone, zoneId, setZoneId, addresses, addrLoaded, selected, selectedId, setSelectedId, editing, setEditing, form, setField, setSave, onCep, cep, openNew, openEdit, formOk, saveAddress, removeAddress, addrBusy, addrError, ok: deliveryOk, submit: submitDelivery },
    pay: { pays, pay, setPayId, changeFor, setChangeFor, document, setDocument, needsDoc, note, setNote, busy, error, ok: payOk, submit, done },
    sum: { fee, discount, total, applied, setApplied, couponInput, setCouponInput, couponMsg, setCouponMsg, couponBusy, applyCoupon },
  };
}
export type Checkout = ReturnType<typeof useCheckout>;
