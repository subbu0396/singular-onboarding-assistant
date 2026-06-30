const SKILLS = [
  { id: 'client_info', name: 'Client Info' },
  { id: 'sdk_setup', name: 'Mobile SDK Setup' },
  { id: 'integration_type', name: 'Integration Type' },
  { id: 'tech_env', name: 'Technical Environment' },
  { id: 'timeline', name: 'Go-Live Timeline' },
  { id: 'review_compile', name: 'Review & Compile' },
];

const STATE_STYLES = {
  pending: 'border-slate-700 bg-slate-900/40 text-slate-500',
  active: 'border-indigo-500 bg-indigo-500/10 text-indigo-300',
  complete: 'border-emerald-700 bg-emerald-500/10 text-emerald-300',
  error: 'border-red-700 bg-red-500/10 text-red-300',
};

const TOOL_LABELS = {
  lookup_salesforce_client: 'Salesforce',
  use_form_data: 'Form data',
  mcp_tool: 'Confluence',
  searchConfluence: 'Confluence: search',
  getConfluencePage: 'Confluence: page',
  confluence_mcp_connect: 'Confluence: connecting',
  google_calendar: 'Google Calendar',
  microsoft_graph: 'Outlook Calendar',
  calendar: 'Calendar',
};

// Atlassian MCP tool names are namespaced (e.g. "atlassian.searchConfluence");
// surface a friendly label for any tool whose name hints at Confluence search
// or page-fetch operations, and fall back to the raw name otherwise.
function labelForTool(toolName) {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  const lower = toolName.toLowerCase();
  if (lower.includes('search') && lower.includes('confluence')) return 'Confluence: search';
  if (lower.includes('page') && lower.includes('confluence')) return 'Confluence: page';
  if (lower.includes('confluence')) return 'Confluence';
  if (lower.includes('atlassian')) return 'Atlassian';
  return toolName;
}

function StateIndicator({ state, index }) {
  if (state === 'complete') return <span>✓</span>;
  if (state === 'error') return <span>✕</span>;
  if (state === 'active') {
    return (
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
    );
  }
  return <span className="text-[10px] text-slate-600">{index + 1}</span>;
}

function ToolBadge({ call }) {
  const label = labelForTool(call.toolName);
  if (call.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
        {label}
      </span>
    );
  }
  const ok = call.ok !== false;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
        ok
          ? 'bg-emerald-900/40 text-emerald-300'
          : 'bg-slate-800 text-slate-400'
      }`}
    >
      {ok ? '✓' : '·'} {label}
    </span>
  );
}

export default function SkillProgress({ skillStatus = {}, toolCalls = {}, visible = true }) {
  if (!visible) return null;
  return (
    <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">
          Agent Orchestration
        </p>
        <p className="text-[11px] text-slate-500">6 skills</p>
      </div>
      <ol className="flex flex-wrap gap-2">
        {SKILLS.map((skill, idx) => {
          const state = skillStatus[skill.id] || 'pending';
          const calls = toolCalls[skill.id] || [];
          return (
            <li
              key={skill.id}
              className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${STATE_STYLES[state]}`}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-4 w-4 items-center justify-center">
                  <StateIndicator state={state} index={idx} />
                </span>
                <span>{skill.name}</span>
              </div>
              {calls.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-6">
                  {calls.map((call) => (
                    <ToolBadge key={call.toolName} call={call} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
