'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Bot, Users, Puzzle, LayoutDashboard, LogOut } from 'lucide-react';
import clsx from 'clsx';

const links = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agents', label: 'AI Agents', icon: Bot },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/resources', label: 'Resources', icon: Puzzle },
];

interface Props {
  user: { name?: string; email?: string; image?: string };
}

export default function Nav({ user }: Props) {
  const pathname = usePathname();
  return (
    <div className="w-60 flex flex-col bg-[#0d1525] border-r border-[#1e293b] flex-shrink-0">
      <div className="px-5 py-5 border-b border-[#1e293b]">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-[#1662dd]" />
          <span className="font-bold text-white text-sm">AI Agent Console</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">Powered by Okta O4AA</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-[#1662dd]/15 text-[#60a5fa] border border-[#1662dd]/25'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-[#1e293b]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-[#1662dd]/20 flex items-center justify-center text-xs font-bold text-[#60a5fa]">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-white truncate">{user?.name || 'User'}</div>
            <div className="text-xs text-slate-500 truncate">{user?.email}</div>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
    </div>
  );
}
