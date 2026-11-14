import { useEffect, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import {
  BellRing, Check, FileCheck2, FileSignature, History, Link2, Mail, MousePointerClick, Pause, PenLine, Play, ShieldCheck, Smartphone,
  Sparkles, Upload, UserCheck,
} from 'lucide-react';
import { EVENT_LABELS } from './files';
import './landing.css';

type Status = 'draft' | 'sent' | 'viewed' | 'signed';
type DemoEvent = keyof typeof EVENT_LABELS;

/** One file's real timeline, from draft to signed. Labels are the app's own, so the demo shows exactly what staff see. */
export const DEMO_STEPS: { event: DemoEvent; detail: string; time: string; status: Status }[] = [
  { event: 'created', detail: 'From the Master Services template', time: '9:02 AM', status: 'draft' },
  { event: 'sent', detail: 'To maya@harborpine.example', time: '9:04 AM', status: 'sent' },
  { event: 'email_sent', detail: 'Delivered, with your personal note', time: '9:04 AM', status: 'sent' },
  { event: 'reminder_sent', detail: 'Automatic reminder, day 2', time: '9:00 AM', status: 'sent' },
  { event: 'viewed', detail: 'On an iPhone, in Safari', time: '11:37 AM', status: 'viewed' },
  { event: 'signed', detail: 'Drawn signature, certificate attached', time: '11:41 AM', status: 'signed' },
  { event: 'signed_notice_sent', detail: 'Email to the staff member who sent it', time: '11:41 AM', status: 'signed' },
];
const STEP_MS = 1800;
const END_HOLD_MS = 3200;
const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', signed: 'Signed' };
const EVENT_ICON: Partial<Record<DemoEvent, ReactNode>> = {
  created: <FileSignature size={14} />, sent: <Mail size={14} />, email_sent: <Check size={14} />, reminder_sent: <BellRing size={14} />,
  viewed: <MousePointerClick size={14} />, signed: <PenLine size={14} />, signed_notice_sent: <UserCheck size={14} />,
};
const SECTIONS = [['features', 'Features'], ['how', 'How it works'], ['security', 'Security']] as const;
const SIGNATURE_PATH = 'M8 42c14-30 26-34 22-12-3 16-12 18-6 2 6-14 18-20 20-6 1 9 6 9 12-2 5-10 10-9 9 1-1 9 4 10 10 1s10-9 10 0c0 7 6 7 12-1 4-6 9-8 10-2 1 5 6 6 12 0M118 36c20-6 48-10 94-14';

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scroll to a section without touching the address: a changed #fragment reloads the page (see main.tsx). */
function scrollToSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

/** The public front page for visitors who aren't logged in. */
export default function Landing() {
  return <div className="lp">
    <header className="lp-nav">
      <div className="lp-wrap lp-nav-row">
        <a className="lp-brand" href="/"><span className="lp-brand-icon"><Sparkles size={18} strokeWidth={1.7} /></span>Astra Sign</a>
        <nav aria-label="Sections">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} onClick={event => scrollToSection(event, id)}>{label}</a>)}
        </nav>
        <div className="lp-nav-actions">
          <a className="lp-link" href="/login">Log in</a>
          <a className="lp-button" href="/login?signup">Start free</a>
        </div>
      </div>
    </header>

    <main>
      <section className="lp-wrap lp-hero">
        <div className="lp-hero-copy">
          <h1>Send the agreement.{' '}<br />Watch it get <span className="lp-signed-line">signed.
            <svg className="lp-flourish" viewBox="0 0 320 40" preserveAspectRatio="none" aria-hidden="true"><path d="M4 30c40-6 90-14 150-16 60-2 110 4 162-10" /></svg>
          </span></h1>
          <p className="lp-lede">Upload your agreement once, mark where clients sign, and send it in minutes. Every open, reminder and signature lands on one live timeline, and you get a signed PDF with a certificate at the end.</p>
          <div className="lp-cta-row">
            <a className="lp-button lp-button-lg" href="/login?signup">Start free</a>
          </div>
          <ul className="lp-proof">
            <li><Check size={15} />Clients never need an account</li>
            <li><Check size={15} />Signs on any phone or laptop</li>
            <li><Check size={15} />No AI reads your agreements</li>
          </ul>
        </div>
        <TimelineDemo />
      </section>

      <section className="lp-wrap lp-features" id="features">
        <div className="lp-section-head">
          <h2>Everything between “please sign” and “signed”.</h2>
          <p>Built for firms that send one agreement to many clients. Only the client’s details change each time.</p>
        </div>
        <ul className="lp-feature-list">
          <Feature icon={<FileSignature size={20} />} title="Reusable templates" text="Upload a PDF once and drag signature, initials, date, name and tick boxes onto any page." />
          <Feature icon={<History size={20} />} title="A live timeline" text="Created, sent, delivered, opened, reminded, signed. The server records each step as it happens, so the history can’t be edited." />
          <Feature icon={<BellRing size={20} />} title="Reminders that stop themselves" text="Optional daily email reminders until the client signs, never more than seven." />
          <Feature icon={<FileCheck2 size={20} />} title="Signed PDF with a certificate" text="The signature is stamped into the exact document you sent, followed by a certificate of every event." />
          <Feature icon={<Smartphone size={20} />} title="Sign anywhere" text="Clients draw with a finger, mouse or stylus, or type their name in a handwritten style." />
          <Feature icon={<UserCheck size={20} />} title="Returning clients in one click" text="Start typing a client’s name and their earlier details fill themselves in." />
        </ul>
      </section>

      <section className="lp-wrap lp-how" id="how">
        <div className="lp-section-head"><h2>Three steps, no training.</h2></div>
        <ol className="lp-steps">
          <Step n={1} icon={<Upload size={18} />} title="Upload once" text="Add your agreement PDF, place the boxes your client fills in, and save it as a template." />
          <Step n={2} icon={<Link2 size={18} />} title="Send to a client" text="Fill in the client’s details and send. We email a private link, or you copy it and share it yourself." />
          <Step n={3} icon={<PenLine size={18} />} title="Get it signed" text="Follow progress live. When they sign, you’re emailed and the signed PDF is ready to download." />
        </ol>
      </section>

      <section className="lp-wrap lp-security" id="security">
        <div className="lp-section-head">
          <h2>Your agreements stay yours.</h2>
          <p>Contracts carry names, prices and terms. Every signed file ends with a certificate like this one, and the app is built so nothing leaks along the way.</p>
        </div>
        <div className="lp-certificate">
          <div className="lp-cert-head">
            <span className="lp-cert-seal"><ShieldCheck size={22} /></span>
            <div><b>Certificate of completion</b><span>Master Services Agreement, Harbor &amp; Pine Studio</span></div>
            <code>sha256 9f2c4e…41ab</code>
          </div>
          <dl className="lp-cert-rows">
            <CertRow term="Signing link" text="A 256-bit secret that can’t be guessed. Only its fingerprint is stored, and it never appears in server logs." />
            <CertRow term="Document" text="The certificate carries the SHA-256 of the PDF that was sent, so any later change is detectable." />
            <CertRow term="Timeline" text="Every event is recorded by the server, in UTC, with the signer’s IP address and browser." />
            <CertRow term="Your data" text="Agreements are never sent to an AI provider. What you upload stays in the app." />
            <CertRow term="Your account" text="Memory-hard password hashing, email confirmation and automatic log-out when idle." />
          </dl>
          <div className="lp-cert-sign" aria-hidden="true">
            <svg viewBox="0 0 220 60"><path d={SIGNATURE_PATH} /></svg>
            <span>Maya Chen, signed 19:41 UTC</span>
          </div>
        </div>
      </section>

      <section className="lp-wrap lp-final">
        <h2>Send your next agreement today.</h2>
        <p>Create your company account, upload a PDF and send it in minutes.</p>
        <div className="lp-cta-row">
          <a className="lp-button lp-button-lg" href="/login?signup">Start free</a>
          <a className="lp-link lp-link-lg" href="/login">Log in</a>
        </div>
      </section>
    </main>

    <footer className="lp-wrap lp-footer">
      <span className="lp-brand small"><span className="lp-brand-icon"><Sparkles size={14} strokeWidth={1.7} /></span>Astra Sign</span>
      <span>© {new Date().getFullYear()} Astra Sign</span>
    </footer>
  </div>;
}

/** A product window that plays one file's timeline like a short clip, with play/pause and a progress bar.
 * It tilts toward the mouse, with a soft light under the pointer. */
function TimelineDemo() {
  const [reduced] = useState(prefersReducedMotion);
  const [step, setStep] = useState(reduced ? DEMO_STEPS.length - 1 : 0);
  const [playing, setPlaying] = useState(!reduced);

  useEffect(() => {
    if (!playing) return;
    const last = step === DEMO_STEPS.length - 1;
    const timer = window.setTimeout(() => setStep(last ? 0 : step + 1), last ? END_HOLD_MS : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  function tilt(event: PointerEvent<HTMLElement>) {
    if (reduced) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
    const style = event.currentTarget.style;
    style.setProperty('--tilt-y', `${+((x - .5) * 12).toFixed(2)}deg`);
    style.setProperty('--tilt-x', `${+((.5 - y) * 8).toFixed(2)}deg`);
    style.setProperty('--glow-x', `${Math.round(x * 100)}%`);
    style.setProperty('--glow-y', `${Math.round(y * 100)}%`);
  }
  function settle(event: PointerEvent<HTMLElement>) {
    event.currentTarget.style.setProperty('--tilt-y', '0deg');
    event.currentTarget.style.setProperty('--tilt-x', '0deg');
  }

  const current = DEMO_STEPS[step];
  const signed = current.status === 'signed';
  return <div className="lp-stage">
    <section className="lp-window" aria-label="Product demo: one file from draft to signed" onPointerMove={tilt} onPointerLeave={settle}>
      <div className="lp-window-bar">
        <span className="lp-traffic" aria-hidden="true"><i /><i /><i /></span>
        <span className="lp-window-url">app.signwithastra.com/files</span>
      </div>
      <div className="lp-window-body">
        <div className="lp-doc" aria-hidden="true">
          <div className="lp-doc-head"><b>Master Services Agreement</b><span>Harbor &amp; Pine Studio</span></div>
          <i /><i /><i className="short" /><i /><i /><i className="short" />
          <div className={`lp-sign-box ${signed ? 'is-signed' : ''}`}>
            {signed ? <svg viewBox="0 0 220 60" className="lp-signature"><path d={SIGNATURE_PATH} /></svg> : <span>Sign here</span>}
          </div>
        </div>
        <div className="lp-panel">
          <div className="lp-panel-head">
            <div><b>Maya Chen</b><small>Harbor &amp; Pine Studio</small></div>
            <span className={`lp-status ${current.status}`} data-testid="demo-status">{STATUS_LABEL[current.status]}</span>
          </div>
          <p className="lp-panel-label">History</p>
          <ol className="lp-timeline">
            {DEMO_STEPS.slice(0, step + 1).map(item => <li key={item.event} data-event={item.event} className={`lp-event ${item.status}`}>
              <span className="lp-event-icon">{EVENT_ICON[item.event]}</span>
              <span className="lp-event-text"><b>{EVENT_LABELS[item.event]}</b><small>{item.detail}</small></span>
              <time>{item.time}</time>
            </li>)}
          </ol>
        </div>
      </div>
      <div className="lp-player">
        <button type="button" className="lp-play" onClick={() => { if (!playing && step === DEMO_STEPS.length - 1) setStep(0); setPlaying(p => !p); }}
          aria-label={playing ? 'Pause demo' : 'Play demo'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
        <span className="lp-progress" aria-hidden="true"><span style={{ width: `${((step + 1) / DEMO_STEPS.length) * 100}%` }} /></span>
        <span className="lp-player-step">{step + 1}/{DEMO_STEPS.length}</span>
      </div>
    </section>
  </div>;
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <li className="lp-feature"><span className="lp-feature-icon">{icon}</span><div><h3>{title}</h3><p>{text}</p></div></li>;
}

function Step({ n, icon, title, text }: { n: number; icon: ReactNode; title: string; text: string }) {
  return <li className="lp-step"><span className="lp-step-node" aria-hidden="true">{n}</span><h3>{icon}{title}</h3><p>{text}</p></li>;
}

const CertRow = ({ term, text }: { term: string; text: string }) => <div className="lp-cert-row"><dt>{term}</dt><dd>{text}</dd></div>;
