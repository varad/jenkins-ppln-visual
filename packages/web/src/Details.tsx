import type { Agent, Call, Condition, KV, ParseResult, Post, SourceRange, Stage, Step, When } from '@jpv/core';
import { useT } from './i18n';

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
  const tr = useT();
  return (
    <Section title={tr('details.agent')}>
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
  const tr = useT();
  const flags = (['beforeAgent', 'beforeInput', 'beforeOptions'] as const).filter((f) => w[f]);
  return (
    <Section title={tr('details.when')}>
      <ul className="conds">
        {w.conditions.map((c, i) => (
          <ConditionTree key={i} c={c} />
        ))}
      </ul>
      {flags.length > 0 && <p className="muted">{tr('details.evaluated', { flags: flags.map((f) => tr(`details.${f}`)).join(', ') })}</p>}
      <p className="muted">{tr('details.whenNote')}</p>
    </Section>
  );
}

function Steps({ steps, onReveal }: { steps: Step[]; onReveal: Props['onReveal'] }) {
  const tr = useT();
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} className={s.dynamic ? 'dynamic' : undefined}>
          <button className="link" onClick={() => onReveal(s.loc)} title={s.dynamic ? tr('details.dynamicStep') : undefined}>
            <code>{s.summary}</code>
          </button>
          {s.children && s.children.length > 0 && <Steps steps={s.children} onReveal={onReveal} />}
        </li>
      ))}
    </ol>
  );
}

function PostView({ p, onReveal }: { p: Post; onReveal: Props['onReveal'] }) {
  const tr = useT();
  return (
    <Section title={tr('details.post')}>
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
  const tr = useT();
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
          {b.kind === 'steps' ? tr('graph.steps', { n: b.steps.length }) : b.kind} · {tr('details.line', { line: stage.loc.line })}
          {stage.dynamicName && ` · ${tr('details.dynamicName')}`}
        </p>
        {stage.when && <WhenView w={stage.when} />}
        {stage.input && (
          <Section title={tr('details.input')}>
            <p>{stage.input.message ?? tr('graph.inputDefault')}</p>
          </Section>
        )}
        {stage.agent && <AgentView a={stage.agent} />}
        <KVs title={tr('details.environment')} items={stage.environment} />
        <Calls title={tr('details.options')} items={stage.options} onReveal={onReveal} />
        <KVs title={tr('details.tools')} items={stage.tools} />
        {b.kind === 'steps' && (
          <Section title={tr('details.steps')}>
            <Steps steps={b.steps} onReveal={onReveal} />
          </Section>
        )}
        {b.kind === 'matrix' && (
          <>
            <Section title={tr('details.matrixAxes')}>
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
                  {tr('details.excludes', { n: b.matrix.excludes.length })} → {tr('details.cellsRun', { n: b.matrix.cells.length })}
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
      <h2>{tr('details.pipeline')}</h2>
      {!p && <p className="muted">{tr('details.nothing')}</p>}
      {p && (
        <>
          <p className="muted">{tr('details.hint')}</p>
          {p.agent && <AgentView a={p.agent} />}
          <Calls title={tr('details.parameters')} items={p.parameters} onReveal={onReveal} />
          <Calls title={tr('details.triggers')} items={p.triggers} onReveal={onReveal} />
          <KVs title={tr('details.environment')} items={p.environment} />
          <Calls title={tr('details.options')} items={p.options} onReveal={onReveal} />
          <KVs title={tr('details.tools')} items={p.tools} />
          {p.post && <PostView p={p.post} onReveal={onReveal} />}
        </>
      )}
      {result.preamble.length > 0 && <Calls title={tr('details.preamble')} items={result.preamble} onReveal={onReveal} />}
    </div>
  );
}
