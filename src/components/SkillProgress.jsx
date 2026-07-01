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

// Risk-based card colors override the normal "complete" green for skills
// whose context emits a riskLevel — currently just the Go-Live Timeline.
const RISK_STYLES = {
  green: 'border-emerald-700 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-600 bg-amber-500/10 text-amber-300',
  red: 'border-red-700 bg-red-500/15 text-red-300',
};

const RISK_LABELS = {
  green: 'on track',
  amber: 'at risk',
  red: 'go-live at risk',
};

const TOOL_LABELS = {
  lookup_salesforce_client: 'Salesforce',
  use_form_data: 'Form data',
  mcp_tool: 'Confluence',
  searchConfluence: 'Confluence: search',
  getConfluencePage: 'Confluence: page',
  search_confluence: 'Confluence: search',
  get_confluence_page: 'Confluence: page',
  confluence_mcp_connect: 'Confluence: connecting',
  google_calendar: 'Google Calendar',
  microsoft_graph: 'Outlook Calendar',
  calendar: 'Calendar',
  search_github_repos: 'GitHub: search',
  fetch_repo_manifests: 'GitHub: manifests',
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

// Bring the specific query / repo / page into the badge label itself so a
// row of "Confluence: search" chips doesn't look like duplicates when Claude
// runs three different queries. Kept short so the pill doesn't wrap.
function detailForCall(call) {
  const input = call?.input || {};
  if (call.toolName === 'search_confluence' && input.query) {
    const q = String(input.query);
    return q.length > 28 ? `${q.slice(0, 26)}…` : q;
  }
  if (call.toolName === 'get_confluence_page' && (input.title || input.pageId)) {
    const t = input.title || input.pageId;
    return String(t).length > 28 ? `${String(t).slice(0, 26)}…` : String(t);
  }
  if (call.toolName === 'fetch_repo_manifests' && input.fullName) {
    return input.fullName;
  }
  return null;
}

function truncateTitle(t) {
  const s = String(t || '');
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
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

// Compact preview of the tool's input, used as the badge tooltip so the SE
// can hover to see what Claude actually searched for or which page it
// opened. Handles the two shapes we emit today; unknown keys fall back to
// a JSON stringify so a new tool never leaves an empty tooltip.
function summarizeInput(toolName, input) {
  if (!input || typeof input !== 'object') return null;
  if (input.query) return `query: "${input.query}"`;
  if (input.title) return `page: ${truncateTitle(input.title)}`;
  if (input.pageId) return `pageId: ${input.pageId}`;
  if (input.clientName) return `client: ${input.clientName}`;
  if (input.fullName) return `repo: ${input.fullName}`;
  if (input.window?.start && input.window?.end) {
    return `window: ${input.window.start.slice(0, 10)} → ${input.window.end.slice(0, 10)}`;
  }
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return null;
  }
}

// Three-tier badge state:
//   running  → indigo pulse
//   ok+content → emerald green with count (green = "found something useful")
//   ok+empty  → amber ("call worked but returned nothing on-point")
//   failed   → grey with error message in tooltip
function ToolBadge({ call }) {
  const baseLabel = labelForTool(call.toolName);
  const detail = detailForCall(call);
  const label = detail ? `${baseLabel}: ${detail}` : baseLabel;
  const inputSummary = summarizeInput(call.toolName, call.input);
  const runningTooltip = inputSummary || label;

  if (call.status === 'running') {
    return (
      <span
        title={runningTooltip}
        className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300"
      >
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
        {label}
      </span>
    );
  }

  const ok = call.ok !== false;
  const hasCount = typeof call.count === 'number';
  // Retrieval-shaped tools (use_form_data, get_confluence_page) don't have
  // a meaningful "hit count" concept, so absent count is treated as OK.
  const empty = ok && hasCount && call.count === 0;

  const tone = !ok
    ? 'bg-slate-800 text-slate-400'
    : empty
      ? 'bg-amber-900/30 text-amber-300 ring-1 ring-amber-800/60'
      : 'bg-emerald-900/40 text-emerald-300';
  const icon = !ok ? '·' : empty ? '⚠' : '✓';
  const countSuffix = ok && hasCount && call.count > 0 ? ` · ${call.count}` : '';
  // Server attaches input.url on completion for search / page tools so the
  // badge becomes a real link into Confluence for that specific result.
  const url = ok ? call.input?.url : null;

  const tooltipParts = [];
  if (inputSummary) tooltipParts.push(inputSummary);
  if (!ok && call.message) tooltipParts.push(`error: ${call.message}`);
  else if (empty) tooltipParts.push('call succeeded but returned no results');
  else if (ok && hasCount) tooltipParts.push(`${call.count} result${call.count === 1 ? '' : 's'}`);
  if (url) tooltipParts.push('click to open in Confluence');
  const tooltip = tooltipParts.length ? tooltipParts.join(' — ') : label;

  const inner = (
    <>
      {icon} {label}
      {countSuffix}
      {url && <span className="ml-0.5 opacity-70">↗</span>}
    </>
  );
  const className = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${tone}${url ? ' underline-offset-2 hover:underline hover:brightness-125' : ''}`;

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltip}
        className={className}
      >
        {inner}
      </a>
    );
  }
  return (
    <span title={tooltip} className={className}>
      {inner}
    </span>
  );
}

function ContextStat({ label, value }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function SkillContextPanel({ context }) {
  if (!context) return null;
  const eng = context.engineering;
  const se = context.se;
  const goLive = context.targetGoLiveDate;
  const risk = context.riskLevel;
  return (
    <div className="mt-1 flex flex-col gap-1 rounded bg-slate-950/40 px-2 py-1.5 text-[10px]">
      {(goLive || risk) && (
        <div className="flex items-center gap-2">
          {goLive && (
            <span className="text-slate-500">
              Go-live: <span className="text-slate-300">{goLive}</span>
            </span>
          )}
          {risk && (
            <span
              className="font-medium uppercase tracking-wider"
              title={context.riskRationale || RISK_LABELS[risk] || risk}
            >
              {RISK_LABELS[risk] || risk}
            </span>
          )}
        </div>
      )}
      {(eng || se) && (
        <div className="flex flex-wrap gap-1">
          {eng && (
            <ContextStat
              label="Eng busy:"
              value={`${eng.total_busy_minutes ?? 0}m`}
            />
          )}
          {se && (
            <ContextStat
              label="SE busy:"
              value={`${se.total_busy_minutes ?? 0}m`}
            />
          )}
        </div>
      )}
      {context.seNotes && (
        <p
          className="line-clamp-2 italic text-slate-400"
          title={context.seNotes}
        >
          <span className="not-italic text-slate-500">SE: </span>“{context.seNotes}”
        </p>
      )}
      {context.engNotes && (
        <p
          className="line-clamp-2 italic text-slate-400"
          title={context.engNotes}
        >
          <span className="not-italic text-slate-500">Eng: </span>“{context.engNotes}”
        </p>
      )}
      {context.riskRationale && (
        <p
          className="line-clamp-2 text-slate-400"
          title={context.riskRationale}
        >
          <span className="text-slate-500">Why: </span>
          {context.riskRationale}
        </p>
      )}
    </div>
  );
}

export default function SkillProgress({
  skillStatus = {},
  toolCalls = {},
  skillContexts = {},
  visible = true,
}) {
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
          const context = skillContexts[skill.id];
          // Risk-based color overrides the default state color once a
          // riskLevel has been emitted — keeps the card amber/red even
          // after the skill completes, which is the whole point.
          const cardClass =
            context?.riskLevel && state !== 'pending' && state !== 'error'
              ? RISK_STYLES[context.riskLevel] || STATE_STYLES[state]
              : STATE_STYLES[state];
          return (
            <li
              key={skill.id}
              className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${cardClass}`}
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
              {context && (
                <div className="pl-6">
                  <SkillContextPanel context={context} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
