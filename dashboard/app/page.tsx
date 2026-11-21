'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { EngineeringTask, Incident } from '../../src/core/contracts.ts';

type Status = 'queued' | 'running' | 'succeeded' | 'failed';
type Job = {
  id: string;
  status: Status;
  repository: string;
  target: string;
  source: Incident['source']['kind'];
  observedAt: string;
  category?: Incident['category'];
  taskState?: EngineeringTask['state'];
  result?: { incident: Incident; task: EngineeringTask };
  failure?: string;
};

const categories: Record<Incident['category'], string> = {
  frontend: 'Frontend', 'api-contract': 'API contract', worker: 'Worker', test: 'Test',
  configuration: 'Configuration', flaky: 'Flaky test', unknown: 'Unclassified',
};
const sources = { fixture: 'Local fixture', application: 'Application', 'github-actions': 'GitHub Actions' };
const filters = ['All incidents', 'Needs approval', 'Blocked', 'Processing'] as const;
type Filter = (typeof filters)[number];
const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const pending = (job: Job) => job.status === 'queued' || job.status === 'running';

const icons: Record<string, ReactNode> = {
  inbox: <><path d="M4 4h16l2 11v5H2v-5L4 4Z"/><path d="M2 14h6l2 3h4l2-3h6"/></>,
  file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h4M9 12h6m-6 4h6"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6.7M20 5v6h-6"/></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
};

function Icon({ name }: { name: keyof typeof icons }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

function badge(job: Job) {
  if (pending(job)) return 'Processing';
  if (job.status === 'failed') return 'Worker failed';
  return job.taskState === 'approval-required' ? 'Needs approval' : 'Blocked';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...init, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body;
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<Job>();
  const [tab, setTab] = useState<'evidence' | 'task'>('evidence');
  const [filter, setFilter] = useState<Filter>('All incidents');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'incidents' | 'guide'>('incidents');
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [detailError, setDetailError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [importError, setImportError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const { jobs } = await requestJson<{ jobs: Job[] }>('jobs', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setJobs(jobs);
        setConnection('connected');
      } catch {
        if (!controller.signal.aborted) setConnection('offline');
      }
      if (!controller.signal.aborted) timer = setTimeout(load, 1_500);
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);

  const needle = query.trim().toLowerCase();
  const visible = jobs.filter((job) => (filter === 'All incidents' || badge(job) === filter) &&
    [job.repository, job.target, job.category && categories[job.category], job.source]
      .some((value) => value?.toLowerCase().includes(needle)));
  const current = visible.find((job) => job.id === selected) ?? visible[0];
  const currentId = current?.id;
  const currentStatus = current?.status;
  const matchingDetail = detail?.id === currentId && detail?.status === currentStatus ? detail : undefined;

  useEffect(() => {
    if (!currentId || connection !== 'connected') return;
    const controller = new AbortController();
    setDetailError('');
    requestJson<Job>(`jobs/${currentId}`, { signal: controller.signal })
      .then((job) => { if (!controller.signal.aborted) setDetail(job); })
      .catch(() => { if (!controller.signal.aborted) setDetailError('Could not load job details. Refresh to retry.'); });
    return () => controller.abort();
  }, [currentId, currentStatus, connection, refresh]);

  function showImport() {
    setImportError('');
    if (file.current) file.current.value = '';
    dialog.current?.showModal();
  }

  async function importEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const upload = file.current?.files?.[0];
    if (!upload) return;
    setImportError('');
    setUploading(true);
    try {
      if (upload.size > 192 * 1024) throw new Error('Choose an evidence file under 192 KiB.');
      const parsed = JSON.parse(await upload.text());
      const evidence = parsed?.evidence ?? parsed;
      const { jobId } = await requestJson<{ jobId: string }>('evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evidence),
      });
      setSelected(jobId);
      setFilter('All incidents');
      setQuery('');
      setView('incidents');
      setTab('evidence');
      setRefresh((value) => value + 1);
      dialog.current?.close();
    } catch (error) {
      setImportError(error instanceof SyntaxError ? 'Choose a valid JSON evidence file.'
        : error instanceof Error ? error.message : 'Could not import evidence.');
    } finally {
      setUploading(false);
    }
  }

  function downloadTask(task: EngineeringTask) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(task, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${task.incidentId}-task.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const result = matchingDetail?.result;
  const statusLabel = { connecting: 'Connecting', connected: 'API connected', offline: 'API unavailable' }[connection];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><img src="/mark.svg" width="35" height="35" alt=""/><span>ReleaseGuard<small>Engineering workspace</small></span></div>
        <nav aria-label="Workspace">
          <button className={view === 'incidents' ? 'nav-link active' : 'nav-link'} aria-current={view === 'incidents' ? 'page' : undefined} onClick={() => setView('incidents')}><Icon name="inbox"/> Incidents</button>
          <button className={view === 'guide' ? 'nav-link active' : 'nav-link'} aria-current={view === 'guide' ? 'page' : undefined} onClick={() => setView('guide')}><Icon name="file"/> Collection guide</button>
        </nav>
        <div className="sidebar-footer"><span className="dot"/> Local workspace</div>
      </aside>
      <div className="workspace">
        <header className="topbar"><span>Workspace <span className="separator">/</span> <strong>{view === 'incidents' ? 'Incidents' : 'Collection guide'}</strong></span><span className={`connection ${connection}`} role="status"><span className="dot"/>{statusLabel}</span></header>
        <main>
          {view === 'guide' ? <>
            <div className="intro"><div><h1>Collection guide</h1><p>Import CI failures and application errors for review.</p></div><button className="primary" onClick={showImport}><Icon name="plus"/> Import evidence</button></div>
            <div className="guide">
              <section><h2>Local failure lab</h2><p>Run a controlled defect and its repair. Import the evidence JSON from the resulting artifact directory.</p><pre>npm run demo -- --scenario api-contract</pre></section>
              <section><h2>GitHub Actions</h2><p>Collect a completed, failed run. Set a read-only Actions token in your environment if job logs require authentication.</p><pre>npm run collect -- github OWNER/REPO RUN_ID --submit</pre></section>
              <section><h2>Application errors</h2><p>Submit version 1 evidence JSON with a repository, full commit SHA, failing target, sanitized logs, and an application source.</p><pre>npm run collect -- fixture application-error.json --submit</pre></section>
            </div>
          </> : <>
            <div className="intro"><div><h1>Incidents</h1><p>Review failure evidence and prepare scoped engineering tasks.</p></div><button className="primary" onClick={showImport}><Icon name="plus"/> Import evidence</button></div>
            <div className="metrics">
              <div><span>Collected</span><strong>{jobs.filter((job) => job.status === 'succeeded').length}</strong></div>
              <div><span>Needs approval</span><strong>{jobs.filter((job) => job.taskState === 'approval-required').length}</strong></div>
              <div><span>Blocked</span><strong>{jobs.filter((job) => job.taskState === 'blocked').length}</strong></div>
              <div><span>Processing</span><strong>{jobs.filter(pending).length}</strong></div>
            </div>
            <section className="inbox" aria-label="Incident inbox">
              <div className="toolbar">
                <div className="filters" aria-label="Filter incidents">{filters.map((item) => <button key={item} aria-pressed={filter === item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
                <div className="tools"><label className="search"><Icon name="search"/><input placeholder="Search incidents" aria-label="Search incidents" value={query} onChange={(event) => setQuery(event.target.value)}/></label><button className="icon-button" aria-label="Refresh incidents" onClick={() => setRefresh((value) => value + 1)}><Icon name="refresh"/></button></div>
              </div>
              {connection === 'offline' && <p className="notice" role="alert">The local API is unavailable. Start it with <code>npm run api</code> or check your configured port.</p>}
              {visible.length === 0 ? <div className="empty">
                <span className="empty-icon"><Icon name="inbox"/></span>
                <h2>{jobs.length ? 'No matching incidents' : 'No incidents yet'}</h2>
                <p>{jobs.length ? 'Change your search or filter to see more results.' : 'Import a local fixture, application error, or GitHub Actions failure to get started.'}</p>
                {jobs.length ? <button className="secondary" onClick={() => { setFilter('All incidents'); setQuery(''); }}>Clear filters</button>
                  : <button className="secondary" onClick={() => setView('guide')}>View collection guide <Icon name="arrow"/></button>}
              </div> : <div className="columns">
                <ul className="job-list" aria-label="Incidents">
                  {visible.map((job) => <li key={job.id}><button aria-pressed={currentId === job.id} className={currentId === job.id ? 'job current' : 'job'}
                    onClick={() => { setSelected(job.id); setTab('evidence'); setCopyStatus(''); }}>
                    <span className="job-meta"><span>{job.category ? categories[job.category] : sources[job.source]}</span><time dateTime={job.observedAt}>{dateFormat.format(new Date(job.observedAt))}</time></span>
                    <strong>{job.target}</strong><span className="repo">{job.repository}</span>
                    <span className={`badge ${job.taskState ?? job.status}`}>{badge(job)}</span>
                  </button></li>)}
                </ul>
                {current && <article className="detail" aria-label="Incident detail">
                  <div className="detail-head"><div><span className="eyebrow">{sources[current.source]}</span><h2>{current.target}</h2><span className="repo">{current.repository}</span></div><span className={`badge ${current.taskState ?? current.status}`}>{badge(current)}</span></div>
                  {detailError && <p className="notice" role="alert">{detailError}</p>}
                  {pending(current) && <p className="subtle">The local worker is processing this import.</p>}
                  {matchingDetail?.failure && <p className="notice" role="alert">{matchingDetail.failure}</p>}
                  {result && <>
                    <div className="tabs" aria-label="Incident views"><button aria-pressed={tab === 'evidence'} onClick={() => setTab('evidence')}>Evidence</button><button aria-pressed={tab === 'task'} onClick={() => setTab('task')}>Engineering task</button></div>
                    {tab === 'evidence' ? <div className="detail-content">
                      <dl className="definition"><div><dt>Incident ID</dt><dd><code>{result.incident.id}</code></dd></div><div><dt>Pinned commit</dt><dd><code>{result.incident.commit}</code></dd></div></dl>
                      {result.incident.source.kind === 'github-actions' && <p className="subtle">Run {result.incident.source.runId}, attempt {result.incident.source.runAttempt}, job {result.incident.source.jobId}</p>}
                      <h3>Log excerpts</h3><pre className="logs">{result.incident.logExcerpts.join('\n')}</pre>
                      {result.incident.attempts.length > 0 && <><h3>Recorded attempts</h3><ul className="text-list">{result.incident.attempts.map((attempt, index) => <li key={index}><strong>{attempt.label} · {attempt.result}</strong> · {attempt.detail}</li>)}</ul></>}
                      <h3>Suspected scope <span className="badge">Hypothesis</span></h3><p className="subtle">{result.incident.suspectedScope.explanation}</p>
                      {result.incident.suspectedScope.paths.length > 0 && <ul className="text-list">{result.incident.suspectedScope.paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>}
                      <h3>Reproduction</h3><ol className="text-list">{result.incident.reproduction.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                      <h3>Verification requirements</h3><ul className="text-list">{result.incident.verificationRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div> : <div className="detail-content">
                      <div className="task-actions"><button className="secondary" onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(JSON.stringify(result.task, null, 2));
                          setCopyStatus('Task JSON copied.');
                        } catch { setCopyStatus('Clipboard unavailable. Download the JSON instead.'); }
                      }}><Icon name="copy"/> Copy JSON</button><button className="secondary" onClick={() => downloadTask(result.task)}><Icon name="download"/> Download JSON</button></div>
                      {copyStatus && <p role="status" className="subtle">{copyStatus}</p>}
                      {result.task.state === 'blocked' && <p className="notice">Add a repository policy for this failure category before requesting approval.</p>}
                      <h3>Human review</h3><ul className="text-list">{result.task.humanReview.map((item) => <li key={item}>{item}</li>)}</ul>
                      <h3>Task contract</h3><pre className="logs">{JSON.stringify(result.task, null, 2)}</pre>
                    </div>}
                  </>}
                </article>}
              </div>}
            </section>
          </>}
        </main>
      </div>
      <dialog ref={dialog} aria-labelledby="import-title">
        <form onSubmit={importEvidence}>
          <div className="dialog-title"><h2 id="import-title">Import evidence</h2><button type="button" className="icon-button" aria-label="Close import" onClick={() => dialog.current?.close()}><Icon name="close"/></button></div>
          <p>Choose a version 1 evidence JSON file or an exported ReleaseGuard record.</p>
          <label className="upload">Evidence JSON <input type="file" accept=".json,application/json" required ref={file}/></label>
          {importError && <p role="alert" className="notice">{importError}</p>}
          <div className="dialog-actions"><button type="button" className="secondary" onClick={() => dialog.current?.close()}>Cancel</button><button className="primary" disabled={uploading}>{uploading ? 'Importing…' : 'Queue evidence'}</button></div>
        </form>
      </dialog>
    </div>
  );
}
