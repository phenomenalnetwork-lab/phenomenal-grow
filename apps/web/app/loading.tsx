import { Shell } from "./shell";

export default function Loading() {
  return (
    <Shell>
      <div className="card">
        <div className="skeleton" style={{ height: 24, width: "40%", marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 14, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 14, width: "80%", marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 14, width: "60%" }} />
      </div>
    </Shell>
  );
}
