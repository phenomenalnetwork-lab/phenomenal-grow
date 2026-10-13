import { redirect } from "next/navigation";
import { getSession } from "@/lib/orgs";
import { LogoMark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const JOURNEY = ["Capture", "Understand", "Act", "Follow Up", "Convert", "Retain", "Re-engage"];

const AREAS = [
  { name: "Inbox", text: "Every WhatsApp conversation in one working view — reply without leaving the app." },
  { name: "Contacts", text: "One record per relationship, with full history, notes, tags and timeline." },
  { name: "Pipelines", text: "Church, business or coaching journeys with custom stages and outcomes." },
  { name: "Follow-ups", text: "Manual nudges plus guided sequences that pause when people reply." },
  { name: "Appointments", text: "Lightweight scheduling with confirmations and reminders." },
  { name: "Reports", text: "Sources, conversions, agents — what happened and what needs attention." },
  { name: "Home", text: "An action dashboard that answers: who needs me right now?" },
  { name: "Settings", text: "Team, numbers, forms and preferences per organisation." },
];

const AUDIENCES = [
  { name: "Businesses", text: "Capture enquiries, follow up consistently and convert without admin overhead." },
  { name: "Churches", text: "Welcome visitors, organise relationships and walk people into community." },
  { name: "Coaches & solo pros", text: "Never lose an enquiry — from first message to paying client." },
];

export default async function Landing() {
  const session = await getSession();
  if (session) redirect("/home");

  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-brand">
          <LogoMark size={30} />
          <strong>Phenomenal Grow</strong>
        </span>
        <span>
          <a href="/login">Sign in</a>{" "}
          <a href="/login" className="cta">
            Get started
          </a>{" "}
          <ThemeToggle />
        </span>
      </header>

      <main>
        <section className="hero">
          <p className="kicker">WhatsApp Conversation & Relationship CRM</p>
          <h1>
            Turn Conversations
            <br />
            Into Growth.
          </h1>
          <p className="lede">
            People start conversations — organisations lose opportunities by failing to capture, organise and follow up.
            Phenomenal Grow makes sure important conversations never disappear into WhatsApp.
          </p>
          <p>
            <a href="/login" className="cta big">
              Start free
            </a>{" "}
            <a href="/login?mode=up" className="ghost">
              Create account
            </a>
          </p>
          <p className="promise">
            <strong>Never lose the conversation.</strong>
          </p>
        </section>

        <section className="strip">
          <h2>The journey</h2>
          <ol className="journey">
            {JOURNEY.map((s, i) => (
              <li key={s}>
                <span className="step-n">{i + 1}</span> {s}
              </li>
            ))}
          </ol>
        </section>

        <section className="strip">
          <h2>Always know</h2>
          <ul className="questions">
            <li>Who is this person?</li>
            <li>Where did they come from?</li>
            <li>What is happening with them?</li>
            <li>What should happen next?</li>
            <li>Did the relationship produce an outcome?</li>
          </ul>
        </section>

        <section className="strip">
          <h2>Everything in one place</h2>
          <div className="cards">
            {AREAS.map((a) => (
              <div className="mini-card" key={a.name}>
                <h3>{a.name}</h3>
                <p>{a.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="strip">
          <h2>Built for relationships, not databases</h2>
          <div className="cards">
            {AUDIENCES.map((a) => (
              <div className="mini-card" key={a.name}>
                <h3>{a.name}</h3>
                <p>{a.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="hero foot">
          <h2>Open it in the morning. Know exactly what needs doing.</h2>
          <p>
            <a href="/login" className="cta big">
              Get started
            </a>
          </p>
        </section>
      </main>

      <footer>
        <small>Phenomenal Grow — Turn Conversations Into Growth.</small>
      </footer>
    </div>
  );
}
