import { LogoMark } from "../logo";

export const metadata = {
  title: "Download for Android — Phenomenal Grow",
  description: "Install the Phenomenal Grow CRM Android app.",
};

/** Public Android download page. No account needed to read this page. */
export default function DownloadPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-brand">
          <LogoMark size={30} />
          <strong>Phenomenal Grow</strong>
        </span>
        <span>
          <a href="/">Home</a> <a href="/login">Sign in</a>
        </span>
      </header>
      <main>
        <section className="hero">
          <p className="kicker">Android app</p>
          <h1>Phenomenal Grow for Android</h1>
          <p className="lede">
            Install the CRM on your phone for the full experience, including push notifications for replies and
            assignments.
          </p>
          <p>
            <a href="/downloads/phenomenal-grow.apk" className="cta big" download>
              Download for Android
            </a>
          </p>
          <p className="promise">
            <strong>Not yet on Google Play</strong> — this direct download is the only distribution channel for now.
          </p>
        </section>
        <section className="strip">
          <h2>How to install</h2>
          <ol className="questions">
            <li>Tap Download for Android above and wait for the file to finish.</li>
            <li>Open the downloaded file from your browser or file manager.</li>
            <li>
              Android may ask you to allow installation from your browser or file manager — approve it once when
              prompted.
            </li>
            <li>Tap Install, then Open, and sign in with your CRM account.</li>
          </ol>
        </section>
        <section className="strip">
          <h2>Good to know</h2>
          <ul className="questions">
            <li>Requires Android 7.0 or newer and an internet connection.</li>
            <li>After signing in, enable push notifications under Notifications.</li>
            <li>Your conversations stay in your organisation account — signing in on a new device changes nothing.</li>
          </ul>
        </section>
      </main>
      <footer>
        <small>Phenomenal Grow — Turn Conversations Into Growth.</small>
      </footer>
    </div>
  );
}
