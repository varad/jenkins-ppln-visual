import type { Agent, Call, Condition, KV, ParseResult, Post, SourceRange, Stage, Step, When } from '@jpv/core';

interface Props {
  result: ParseResult;
  stage?: Stage;
  onReveal: (r: SourceRange) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="d-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function AgentView({ a }: { a: Agent }) {
  return (
    <Section title="Agent">
      <code>{a.summary}</code>
    </Section>
  );
}

function KVs({ title, items }: { title: string; items?: KV[] }) {
  if (!items?.length) return null;
  return (
    <Section title={title}>
      <table className="kv">
        <tbody>
          {items.map((k, i) => (
            <tr key={i}>
              <th>{k.key}</th>
              <td>
                <code>{k.value}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Calls({ title, items, onReveal }: { title: string; items?: Call[]; onReveal: Props['onReveal'] }) {
  if (!items?.length) return null;
  return (
    <Section title={title}>
      <ul className="calls">
        {items.map((c, i) => (
          <li key={i}>
            <button className="link" onClick={() => onReveal(c.loc)}>
              <code>{c.raw}</code>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ConditionTree({ c }: { c: Condition }) {
  if (!c.children) return <li><code>{c.summary}</code></li>;
  return (
    <li>
      <span className="cond-op">{c.kind}</span>
      <ul>
        {c.children.map((x, i) => (
          <ConditionTree key={i} c={x} />
        ))}
      </ul>
    </li>
  );
}

function WhenView({ w }: { w: When }) {
  const flags = (['beforeAgent', 'beforeInput', 'beforeOptions'] as const).filter((f) => w[f]);
  return (
    <Section title="Runs only when">
      <ul className="conds">
        {w.conditions.map((c, i) => (
          <ConditionTree key={i} c={c} />
        ))}
      </ul>
      {flags.length > 0 && <p className="muted">Evaluated {flags.join(', ').replace(/before/g, 'before ').toLowerCase()}.</p>}
      <p className="muted">Conditions are evaluated by Jenkins at run time; they are shown, not evaluated, here.</p>
    </Section>
  );
}

function Steps({ steps, onReveal }: { steps: Step[]; onReveal: Props['onReveal'] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} className={s.dynamic ? 'dynamic' : undefined}>
          <button className="link" onClick={() => onReveal(s.loc)} title={s.dynamic ? 'Imperative Groovy: shown, not evaluated' : undefined}>
            <code>{s.summary}</code>
          </button>
          {s.children && s.children.length > 0 && <Steps steps={s.children} onReveal={onReveal} />}
        </li>
      ))}
    </ol>
  );
}

function PostView({ p, onReveal }: { p: Post; onReveal: Props['onReveal'] }) {
  return (
    <Section title="Post">
      {p.conditions.map((c, i) => (
        <div key={i} className="post-cond">
          <span className={`badge badge-post-${c.condition}`}>{c.condition}</span>
          <Steps steps={c.steps} onReveal={onReveal} />
        </div>
      ))}
    </Section>
  );
}

export function Details({ result, stage, onReveal }: Props) {
  if (stage) {
    const b = stage.body;
    return (
      <div className="details">
        <h2>
          <button className="link" onClick={() => onReveal(stage.headerLoc)}>
            {stage.name}
          </button>
        </h2>
        <p className="muted">
          {b.kind === 'steps' ? `${b.steps.length} step${b.steps.length === 1 ? '' : 's'}` : b.kind} · line {stage.loc.line}
          {stage.dynamicName && ' · name is interpolated at run time'}
        </p>
        {stage.when && <WhenView w={stage.when} />}
        {stage.input && (
          <Section title="Waits for input">
            <p>{stage.input.message}</p>
          </Section>
        )}
        {stage.agent && <AgentView a={stage.agent} />}
        <KVs title="Environment" items={stage.environment} />
        <Calls title="Options" items={stage.options} onReveal={onReveal} />
        <KVs title="Tools" items={stage.tools} />
        {b.kind === 'steps' && (
          <Section title="Steps">
            <Steps steps={b.steps} onReveal={onReveal} />
          </Section>
        )}
        {b.kind === 'matrix' && (
          <>
            <Section title="Matrix axes">
              <table className="kv">
                <tbody>
                  {b.matrix.axes.map((a) => (
                    <tr key={a.name}>
                      <th>{a.name}</th>
                      <td>{a.values.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {b.matrix.excludes.length > 0 && (
                <p className="muted">
                  {b.matrix.excludes.length} exclude rule{b.matrix.excludes.length === 1 ? '' : 's'} → {b.matrix.cells.length} cells run.
                </p>
              )}
            </Section>
            {b.matrix.when && <WhenView w={b.matrix.when} />}
            {b.matrix.agent && <AgentView a={b.matrix.agent} />}
            {b.matrix.post && <PostView p={b.matrix.post} onReveal={onReveal} />}
          </>
        )}
        {stage.post && <PostView p={stage.post} onReveal={onReveal} />}
      </div>
    );
  }

  const p = result.pipeline;
  return (
    <div className="details">
      <h2>Pipeline</h2>
      {!p && <p className="muted">Nothing to show yet.</p>}
      {p && (
        <>
          <p className="muted">Click a stage to see its details and jump to its source.</p>
          {p.agent && <AgentView a={p.agent} />}
          <Calls title="Parameters" items={p.parameters} onReveal={onReveal} />
          <Calls title="Triggers" items={p.triggers} onReveal={onReveal} />
          <KVs title="Environment" items={p.environment} />
          <Calls title="Options" items={p.options} onReveal={onReveal} />
          <KVs title="Tools" items={p.tools} />
          {p.post && <PostView p={p.post} onReveal={onReveal} />}
        </>
      )}
      {result.preamble.length > 0 && <Calls title="Outside the pipeline block" items={result.preamble} onReveal={onReveal} />}
    </div>
  );
}
