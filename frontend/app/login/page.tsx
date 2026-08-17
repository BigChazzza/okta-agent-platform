'use client';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1e]">
      <div className="w-full max-w-md px-8 py-10 bg-[#0d1525] border border-[#1e293b] rounded-2xl shadow-2xl text-center">
        <div className="mb-6">
          <span className="text-4xl font-black tracking-wider text-[#1662dd]">OKTA</span>
          <div className="mt-1 text-xs font-semibold tracking-widest text-slate-500 uppercase">Identity Platform</div>
        </div>
        <div className="mb-2 text-2xl font-bold text-white">AI Agent Console</div>
        <p className="text-slate-400 text-sm mb-8">Sign in with your Okta account to manage AI agents</p>
        <button
          onClick={() => signIn('okta', { callbackUrl: '/' })}
          className="w-full py-3 px-6 bg-[#1662dd] hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          Sign in with Okta
        </button>
        <p className="mt-6 text-xs text-slate-600">Powered by Okta for AI Agents (O4AA)</p>
      </div>
    </div>
  );
}
