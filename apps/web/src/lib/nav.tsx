import { Link, useNavigate, type LinkProps } from 'react-router-dom';

// Atalhos de navegação. Na demo havia um "?demo=" para preservar; aqui os links são os do próprio react-router.
export const DLink = (p: LinkProps) => <Link {...p} />;
export const useDemoPath = () => (path: string) => path;
export const useDemoNavigate = () => { const nav = useNavigate(); return (path: string) => nav(path); };
