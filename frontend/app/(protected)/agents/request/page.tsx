import AgentRequestWizard from './AgentRequestWizard';

export default function AgentRequestPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Agent Request</h1>
        <p className="text-slate-400 text-sm mt-1">
          Onboard a new agent identity, secured by Okta, in a few steps — no manual
          authentication code or static service accounts required.
        </p>
      </div>

      <AgentRequestWizard />
    </div>
  );
}
