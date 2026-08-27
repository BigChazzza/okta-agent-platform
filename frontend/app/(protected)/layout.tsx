import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Nav from '@/components/Nav';
import EventLog from '@/components/EventLog';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  return (
    <div className="flex h-screen bg-[#0a0f1e] overflow-hidden">
      <Nav user={session.user as any} />
      <main className="flex-1 overflow-y-auto min-w-0">
        <div className="p-8">{children}</div>
      </main>
      <EventLog />
    </div>
  );
}
