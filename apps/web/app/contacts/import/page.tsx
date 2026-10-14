"use client";
import { useState } from "react";
import { dryRunImport, commitImport } from "./actions";

interface ReportRow {
  index: number;
  action: string;
  phone?: string;
  error?: string;
}

export default function ImportPage() {
  const [csv, setCsv] = useState("Sarah M.,+10000000002,sarah2@example.com,Referral,VIP");
  const [report, setReport] = useState<ReportRow[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="main">
      <div className="card">
        <p>
          <a href="/contacts">← Contacts</a>
        </p>
        <h2>Import contacts</h2>
        <p>CSV columns: name, phone, email, source, tags (semicolon-separated). First row is data (no header).</p>
        <textarea rows={8} cols={70} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <br />
        <button
          onClick={async () => {
            setError(null);
            setResult(null);
            try {
              const r = await dryRunImport(csv);
              setReport(r.report);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Dry run failed");
            }
          }}
        >
          1. Preview (dry run)
        </button>{" "}
        <button
          onClick={async () => {
            setError(null);
            try {
              const r = await commitImport(csv);
              setResult(`Imported: ${r.created} created, ${r.updated} updated, ${r.errors} errors`);
              setReport(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Import failed");
            }
          }}
        >
          2. Commit import
        </button>
        {error && <p style={{ color: "var(--pg-overdue)" }}>{error}</p>}
        {result && <p>{result}</p>}
        {report && (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Action</th>
                <th>Phone / error</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={r.index}>
                  <td>{r.index + 1}</td>
                  <td>{r.action}</td>
                  <td>{r.phone ?? r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <h2>Export</h2>
        <p>
          <a href="/contacts/export">Download contacts.csv</a> (owners only)
        </p>
      </div>
    </main>
  );
}
