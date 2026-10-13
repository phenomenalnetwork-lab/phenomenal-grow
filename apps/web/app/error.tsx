"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="main">
      <div className="card">
        <h2>Something went wrong</h2>
        <div className="alert alert-error">{error.message || "Please try again."}</div>
        <button onClick={() => reset()}>Try again</button>{" "}
        <a href="/">Back to Home</a>
      </div>
    </main>
  );
}
