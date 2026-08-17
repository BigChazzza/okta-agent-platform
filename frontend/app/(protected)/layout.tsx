import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Nav from '@/components/Nav';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  return (
    <div className="flex h-screen bg-[#0a0f1e]">
      <Nav user={session.user as any} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
