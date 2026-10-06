import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const KEY = 'pediu-ui-theme';
const saved = () => localStorage.getItem(KEY) === 'dark';

/** Aplica o modo claro/escuro salvo na página da plataforma (painel, seletor, guia). As lojas não são afetadas. */
export function useApplyPlatformTheme() {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', saved());
    return () => document.documentElement.classList.remove('dark');
  }, []);
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState(saved);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem(KEY, next ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', next);
  };
  return (
    <button onClick={toggle} aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'} title={dark ? 'Tema claro' : 'Tema escuro'}
      className={`inline-flex items-center justify-center rounded-ui-sm p-2 transition hover:bg-muted print:hidden ${className}`}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
